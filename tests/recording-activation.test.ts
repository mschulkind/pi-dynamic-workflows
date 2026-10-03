import assert from "node:assert/strict";
import test from "node:test";
import { claimWorkflowRuntime, handoffWorkflowRuntime, WORKFLOW_EXTENSION_VERSION } from "../src/extension-reload.js";
import { createRequestObserver } from "../src/request-recording.js";

test("same-version changed build and legacy runtimes cannot be adopted", () => {
  for (const runtimeBuildIdentity of ["previous-generation", undefined]) {
    const runtime = {
      cwd: process.cwd(),
      extensionVersion: WORKFLOW_EXTENSION_VERSION,
      runtimeBuildIdentity,
      manager: {} as any,
      effort: { level: "high" as const },
    };
    handoffWorkflowRuntime(runtime);
    assert.equal(claimWorkflowRuntime().versionMismatch, runtime);
  }
});

test("rejected append and observer callbacks report closed reasons without arbitrary errors", async () => {
  const reasons: string[] = [];
  const observer = createRequestObserver(
    {
      rootRunId: "r",
      frameRunId: "r",
      executionId: "e",
      callId: "c",
      stableWorkId: "w",
      childAttemptId: "a",
      childAttemptOrdinal: 1,
      sessionId: "s",
    },
    undefined,
    () => Promise.reject(Error("SECRET https://credentials")),
    "not_observed",
    (reason: string) => reasons.push(reason),
  );
  observer.event({ type: "message_start", message: { role: "assistant" } } as any);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reasons, ["append_failed"]);
  observer.event({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      get delta() {
        throw Error("SECRET");
      },
    },
  } as any);
  assert.deepEqual(reasons, ["append_failed", "observer_callback_failed"]);
});

test("append returning false is a failure, not healthy zero evidence", async () => {
  const reasons: string[] = [];
  const observer = createRequestObserver(
    {
      rootRunId: "r",
      frameRunId: "r",
      executionId: "e",
      callId: "c",
      stableWorkId: "w",
      childAttemptId: "a",
      childAttemptOrdinal: 1,
      sessionId: "s",
    },
    undefined,
    () => false,
    "not_observed",
    (r) => reasons.push(r),
  );
  observer.event({ type: "message_start", message: { role: "assistant" } } as any);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reasons, ["append_failed"]);
});

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as hostSdk from "@earendil-works/pi-coding-agent";
import { discardWorkflowRuntime, takeWorkflowRuntime } from "../src/extension-reload.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

function mockFrontend() {
  const handlers: Record<string, (...args: any[]) => void> = {};
  return {
    handlers,
    pi: {
      registerTool() {},
      registerCommand() {},
      getCommands: () => [],
      on: (name: string, fn: any) => {
        handlers[name] = fn;
      },
      getActiveTools: () => [],
      setActiveTools() {},
      sendMessage() {},
    },
  };
}

async function compiledFrontendFixture(root: string) {
  const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { createJiti } = await import(
    new URL("lib/jiti-static.mjs", pathToFileURL(require.resolve("jiti/package.json"))).href
  );
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    virtualModules: { "@earendil-works/pi-coding-agent": hostSdk },
  });
  const repo = new URL("..", import.meta.url).pathname;
  const fixture = join(root, "package");
  cpSync(join(repo, "dist"), join(fixture, "dist"), { recursive: true });
  cpSync(join(repo, "package.json"), join(fixture, "package.json"));
  cpSync(join(repo, "extensions"), join(fixture, "extensions"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(fixture, "node_modules"));
  return { fixture, entry: join(fixture, "extensions/workflow.ts"), jiti };
}

test("compiled frontend retains same build, rejects changed/legacy managers and rejects cached stale graphs", async () => {
  const root = mkdtempSync("/tmp/pi-dw-activation-");
  try {
    await withFakeHomeAsync(join(root, "home"), async () => {
      const { entry, jiti } = await compiledFrontendFixture(root);
      const factory = await jiti.import(entry, { default: true });
      const first = mockFrontend();
      factory(first.pi);
      first.handlers.session_shutdown({ reason: "reload" });
      const staged = takeWorkflowRuntime();
      assert.ok(staged);
      assert.ok(staged.runtimeBuildIdentity?.startsWith("sha256:"));
      // Same build: exact manager, effort, promises and pending-delivery owner.
      staged.effort.level = "ultra";
      handoffWorkflowRuntime(staged);
      const second = mockFrontend();
      factory(second.pi);
      second.handlers.session_shutdown({ reason: "reload" });
      const same = takeWorkflowRuntime();
      assert.ok(same);
      assert.equal(same.manager, staged.manager);
      assert.equal(same.effort, staged.effort);
      for (const identity of [undefined, "sha256:other-build"]) {
        const paused: string[] = [];
        const incompatible = {
          ...same,
          runtimeBuildIdentity: identity,
          manager: {
            listLiveRuns: () => [{ runId: "pending", status: "running" }],
            pause: (id: string) => {
              paused.push(id);
              return true;
            },
          } as any,
        };
        handoffWorkflowRuntime(incompatible);
        const next = mockFrontend();
        factory(next.pi);
        assert.deepEqual(paused, ["pending"]);
        next.handlers.session_shutdown({ reason: "reload" });
        const replacement = takeWorkflowRuntime();
        assert.ok(replacement);
        assert.notEqual(replacement.manager, incompatible.manager);
      }
      // Emulate update in place while Node retains the loaded compiled graph.
      // Frontend must not stamp that old graph with a freshly read disk identity.
      const paused: string[] = [];
      handoffWorkflowRuntime({
        ...same,
        manager: {
          listLiveRuns: () => [{ runId: "cached", status: "running" }],
          pause: (id: string) => {
            paused.push(id);
            return true;
          },
        } as any,
      });
      writeFileSync(
        entry,
        readFileSync(entry, "utf8").replace(
          /const expectedBuildIdentity = "[^"]*";/,
          'const expectedBuildIdentity = "sha256:new-on-disk";',
        ),
      );
      await assert.rejects(() => jiti.import(entry, { default: true }), /Restart Pi/);
      assert.deepEqual(paused, ["cached"]);
      assert.equal(takeWorkflowRuntime(), undefined);
    });
  } finally {
    discardWorkflowRuntime();
    rmSync(root, { recursive: true, force: true });
  }
});

import { createRecordingHealthReporter, observeRequestInvocations } from "../src/request-recording.js";

test("unwritable public invocation hook exposes message fallback and still retains message evidence", () => {
  const logs: string[] = [];
  const records: any[] = [];
  const health = createRecordingHealthReporter((message) => logs.push(message));
  const observer = createRequestObserver(
    {
      rootRunId: "r",
      frameRunId: "r",
      executionId: "e",
      callId: "c",
      stableWorkId: "w",
      childAttemptId: "a",
      childAttemptOrdinal: 1,
      sessionId: "s",
    },
    undefined,
    (r) => records.push(r),
    "not_observed",
    health,
  );
  const publicAgent = Object.freeze({
    streamFunction: (() => {
      throw Error("not called");
    }) as any,
  });
  const restore = observeRequestInvocations(publicAgent, observer);
  observer.event({ type: "message_start", message: { role: "assistant" } } as any);
  observer.close(false);
  restore();
  assert.deepEqual(logs, ["request recording: message_observer_fallback"]);
  assert.equal(records.length, 2);
  assert.equal(records[0].granularity, "sdk_assistant_message");
  health("observer_initialization_failed");
  health("observer_initialization_failed");
  assert.equal(logs.filter((line) => line.endsWith("observer_initialization_failed")).length, 1);
});

import * as recording from "../src/request-recording.js";

test("observer initialization failure is reported without failing child execution", () => {
  const reasons: string[] = [];
  const observer = (recording as any).initializeRequestObserver(
    () => {
      throw Error("SECRET");
    },
    (reason: string) => reasons.push(reason),
  );
  assert.equal(observer, undefined);
  assert.deepEqual(reasons, ["observer_initialization_failed"]);
});

test("rejected hook restoration is a nonfatal observer callback failure", () => {
  const reasons: string[] = [];
  const observer = createRequestObserver(
    {
      rootRunId: "r",
      frameRunId: "r",
      executionId: "e",
      callId: "c",
      stableWorkId: "w",
      childAttemptId: "a",
      childAttemptOrdinal: 1,
      sessionId: "s",
    },
    undefined,
    () => {},
    "not_observed",
    (r) => reasons.push(r),
  );
  const original = (() => {}) as any;
  let current = original;
  const agent = {
    get streamFunction() {
      return current;
    },
    set streamFunction(value) {
      if (value === original) throw Error("SECRET");
      current = value;
    },
  };
  const restore = observeRequestInvocations(agent, observer);
  assert.doesNotThrow(restore);
  assert.deepEqual(reasons, ["invocation_observer_ready", "observer_callback_failed"]);
});

test("health reporter rejects out-of-vocabulary input from an injected runner", () => {
  const logs: string[] = [];
  const health = createRecordingHealthReporter((message) => logs.push(message));
  health("SECRET https://credentials" as any);
  health("enabled");
  assert.deepEqual(logs, ["request recording: enabled"]);
});

// Two separate producer entry points can be cached before the frontend itself.
// A fresh identity module must not relabel either old implementation as current.
test("actual shipped frontend isolates independently cached manager and recording dependencies", async () => {
  const root = mkdtempSync("/tmp/pi-dw-partial-cache-");
  try {
    await withFakeHomeAsync(join(root, "home"), async () => {
      const { entry, fixture, jiti } = await compiledFrontendFixture(root);
      const oldManager = await import(pathToFileURL(join(fixture, "dist/workflow-manager.js")).href);
      const oldRecorder = await import(pathToFileURL(join(fixture, "dist/request-recording.js")).href);
      // Emulate replacing the same-version package with another complete build.
      // All generated identity literals/URL stamps change together, not Git HEAD.
      const oldIdentity = /sha256:[a-f0-9]+/.exec(readFileSync(join(fixture, "dist/runtime-build.js"), "utf8"))?.[0];
      assert.ok(oldIdentity);
      const nextIdentity = `sha256:${"a".repeat(64)}`;
      for (const name of readdirSync(join(fixture, "dist")).filter((name) => name.endsWith(".js"))) {
        const path = join(fixture, "dist", name);
        writeFileSync(path, readFileSync(path, "utf8").replaceAll(oldIdentity, nextIdentity));
      }
      writeFileSync(entry, readFileSync(entry, "utf8").replaceAll(oldIdentity, nextIdentity));
      const factory = await jiti.import(entry, { default: true });
      const frontend = mockFrontend();
      factory(frontend.pi);
      frontend.handlers.session_shutdown({ reason: "reload" });
      const staged = takeWorkflowRuntime();
      assert.ok(staged);
      assert.equal(staged.runtimeBuildIdentity, nextIdentity);
      assert.notEqual(
        staged.manager.constructor,
        oldManager.WorkflowManager,
        "a separately fresh identity must not mislabel the cached constructor",
      );
      const currentRecorder = await import(
        `${pathToFileURL(join(fixture, "dist/request-recording.js")).href}?workflowBuild=${nextIdentity}`
      );
      assert.notEqual(currentRecorder.createRequestObserver, oldRecorder.createRequestObserver);
      // The old graph's literal remains the one it actually loaded.
      assert.equal(
        (await import(pathToFileURL(join(fixture, "dist/workflow-manager.js")).href)).WorkflowManager,
        oldManager.WorkflowManager,
      );
    });
  } finally {
    discardWorkflowRuntime();
    rmSync(root, { recursive: true, force: true });
  }
});

import { createRunPersistence } from "../src/run-persistence.js";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "bounded wait for workflow state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

for (const mode of ["same", "changed", "legacy"] as const) {
  test(`compiled frontend ${mode} build preserves live promise or pauses and resumes from committed journal`, async () => {
    const root = mkdtempSync("/tmp/pi-dw-live-handoff-");
    try {
      await withFakeHomeAsync(join(root, "home"), async () => {
        const { entry, jiti } = await compiledFrontendFixture(root);
        const factory = await jiti.import(entry, { default: true });
        const initial = mockFrontend();
        factory(initial.pi);
        initial.handlers.session_shutdown({ reason: "reload" });
        const runtime = takeWorkflowRuntime();
        assert.ok(runtime);
        const Manager = runtime.manager.constructor as any;
        let finish: (() => void) | undefined;
        const calls: string[] = [];
        const manager = new Manager({
          cwd: root,
          agent: {
            async run(prompt: string, options: any) {
              calls.push(prompt);
              if (prompt === "first") return "first-result";
              await new Promise<void>((resolve, reject) => {
                finish = resolve;
                options.signal.addEventListener("abort", () => reject(Error("aborted fixture")), { once: true });
              });
              return "second-result";
            },
          },
        });
        manager.on("error", () => {});
        const { runId, promise } = manager.startInBackground(
          `export const meta = { name: 'handoff', description: 'test' }; const a = await agent('first', { label: 'first' }); const b = await agent('second', { label: 'second' }); return { a, b };`,
        );
        // Attach rejection handling now, before the incompatible factory pauses.
        const settlement = promise.then(
          (value: any) => ({ value }),
          (error: unknown) => ({ error }),
        );
        await until(() => Boolean(finish) && manager.getRun(runId)?.journal.length === 1);
        const live = manager.getRun(runId);
        const value = {
          ...runtime,
          cwd: root,
          manager,
          runtimeBuildIdentity:
            mode === "same"
              ? runtime.runtimeBuildIdentity
              : mode === "legacy"
                ? undefined
                : "sha256:previous-generation",
        };
        value.effort.level = "ultra";
        handoffWorkflowRuntime(value);
        const next = mockFrontend();
        factory(next.pi);
        next.handlers.session_shutdown({ reason: "reload" });
        const adopted = takeWorkflowRuntime();
        assert.ok(adopted);
        if (mode === "same") {
          assert.equal(adopted.manager, manager);
          assert.equal(adopted.manager.getRun(runId), live);
          assert.equal(adopted.effort, value.effort);
          assert.equal(manager.getRun(runId).status, "running");
          assert.ok(finish);
          finish();
          const result = await settlement;
          assert.deepEqual(JSON.parse(JSON.stringify(result.value.result)), { a: "first-result", b: "second-result" });
          assert.equal(manager.getRun(runId).status, "completed");
          await until(() => Boolean(createRunPersistence(root).load(runId)?.pendingDelivery));
          assert.equal(createRunPersistence(root).load(runId)?.pendingDelivery?.kind, "complete");
          assert.deepEqual(calls, ["first", "second"], "handoff must not restart either child");
        } else {
          assert.notEqual(adopted.manager, manager);
          assert.equal(manager.getRun(runId).status, "paused");
          assert.ok("error" in (await settlement));
          const persisted = createRunPersistence(root).load(runId);
          assert.equal(persisted?.status, "paused");
          assert.equal(persisted?.journal?.[0].result, "first-result");
          const resumedCalls: string[] = [];
          const recovered = new (adopted.manager.constructor as any)({
            cwd: root,
            agent: {
              async run(prompt: string) {
                resumedCalls.push(prompt);
                return "second-result";
              },
            },
          });
          recovered.on("error", () => {});
          assert.equal(await recovered.resume(runId), true);
          await until(() => recovered.getRun(runId)?.status === "completed");
          assert.deepEqual(resumedCalls, ["second"], "completed first child must replay from the durable journal");
          assert.deepEqual(JSON.parse(JSON.stringify(recovered.getRun(runId).result.result)), {
            a: "first-result",
            b: "second-result",
          });
          assert.equal(createRunPersistence(root).load(runId)?.status, "completed");
        }
      });
    } finally {
      discardWorkflowRuntime();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

import ts from "typescript";

test("every shipped internal module edge uses the complete build's URL identity", () => {
  const dist = new URL("../dist/", import.meta.url);
  const identity = /sha256:[a-f0-9]{64}/.exec(readFileSync(new URL("runtime-build.js", dist), "utf8"))?.[0];
  assert.ok(identity);
  let edges = 0;
  for (const name of readdirSync(dist).filter((name) => name.endsWith(".js"))) {
    const text = readFileSync(new URL(name, dist), "utf8");
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = (node: ts.Node) => {
      let specifier: ts.Node | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier) && /^\.\.?\//.test(specifier.text)) {
        edges++;
        assert.ok(
          specifier.text.endsWith(`?workflowBuild=${identity}`),
          `${name} has an unisolated internal module edge`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.ok(edges > 100, "inspect the real compiled graph, not an empty fixture");
  assert.ok(
    readFileSync(new URL("../extensions/workflow.ts", import.meta.url), "utf8").includes(
      `pi-extension.js?workflowBuild=${identity}`,
    ),
  );
});

import { createHash } from "node:crypto";

test("shipped identity covers the executable runtime manifest as well as pre-stamp modules", () => {
  const root = new URL("../", import.meta.url);
  const dist = new URL("dist/", root);
  const identity = /sha256:[a-f0-9]{64}/.exec(readFileSync(new URL("runtime-build.js", dist), "utf8"))?.[0];
  assert.ok(identity);
  const hash = createHash("sha256").update("pi-dynamic-workflows:compiled-generation-url-v1\0");
  const manifest = readFileSync(new URL("package.json", root));
  hash.update(`package.json:${manifest.length}:`).update(manifest);
  for (const name of readdirSync(dist)
    .filter((name) => name.endsWith(".js") && name !== "runtime-build.js")
    .sort()) {
    const raw = Buffer.from(readFileSync(new URL(name, dist), "utf8").replaceAll(`?workflowBuild=${identity}`, ""));
    hash.update(`${name.length}:${name}:${raw.length}:`).update(raw);
  }
  assert.equal(identity, `sha256:${hash.digest("hex")}`);
});
