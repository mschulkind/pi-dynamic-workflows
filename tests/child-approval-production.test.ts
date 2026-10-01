import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createCodingTools,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WorkflowAgent } from "../dist/agent.js";
import { ChildApprovalScope } from "../dist/child-approval.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

// Deliberately imports the current gate, not a simulated bridge. CI can supply
// the gate checkout without making it a production dependency of workflows.
test("committed production adapter + actual gate + real SDK executor: collisions, native tools, destination handoff", {
  skip: !process.env.DW_AUTOMODE_TEST_HELPERS,
}, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "dw-production-"));
  const slot = Symbol.for("@mschulkind/pi-child-approval");
  const globals = globalThis as Record<symbol, unknown>;
  const previous = globals[slot];
  delete globals[slot];
  try {
    await withFakeHomeAsync(home, async () => {
      const helpersPath = process.env.DW_AUTOMODE_TEST_HELPERS as string;
      const { baseConfig } = await import(pathToFileURL(helpersPath).href);
      const { createPiAutomode } = await import(
        pathToFileURL(join(dirname(helpersPath), "../extensions/auto-mode.ts")).href
      );
      const config = baseConfig({ allowInsideWorkingDirectory: true, classifyReadOnlyTools: false });
      const evidence: Array<{ action: string; instructions: string }> = [];
      let decision = "block";
      const provider = "fauxtest-production-approval";
      const core = createFauxCore({ provider, models: [{ id: "local", contextWindow: 128_000, maxTokens: 4096 }] });
      const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null });
      runtime.registerProvider(provider, {
        baseUrl: "http://127.0.0.1:9/unused",
        apiKey: "unused",
        api: core.api,
        streamSimple: core.streamSimple as never,
        models: [
          {
            id: "local",
            name: "local",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 4096,
          },
        ],
      });
      const registry = new ModelRegistry(runtime);
      const roots = ["A", "B"].map((name) => {
        const cwd = join(home, name);
        mkdirSync(cwd);
        writeFileSync(join(cwd, "AGENTS.md"), `DESTINATION_${name}_ONLY`);
        return cwd;
      });
      const sdk = (await import("@earendil-works/pi-coding-agent")) as any;
      const makeRoot = async (cwd: string, manager = SessionManager.inMemory(cwd), sessionStartEvent?: unknown) => {
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir: join(home, "agent"),
          noExtensions: true,
          extensionFactories: [
            createPiAutomode({
              loadConfig: () => config,
              classifyAction: async (_ctx: unknown, _cfg: unknown, action: string, instructions: string) => {
                evidence.push({ action, instructions });
                return {
                  decision: JSON.parse(action).toolName === "outer" ? "allow" : decision,
                  tier: "none",
                  reason: "local execution-spy classifier",
                };
              },
            }),
          ],
        });
        await loader.reload();
        const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
        const { session } = await createAgentSession({
          cwd,
          agentDir: join(home, "agent"),
          model: registry.find(provider, "local"),
          modelRuntime: runtime,
          sessionManager: manager,
          resourceLoader: loader,
          settingsManager,
          ...{ sessionStartEvent },
          tools: [],
        });
        await session.bindExtensions({});
        return {
          session,
          manager,
          services: {
            cwd,
            agentDir: join(home, "agent"),
            resourceLoader: loader,
            modelRuntime: runtime,
            settingsManager,
            diagnostics: [],
          },
        };
      };
      const freshPrompt = async (session: Awaited<ReturnType<typeof makeRoot>>["session"]) => {
        core.setResponses([fauxAssistantMessage("ready", { stopReason: "stop" })]);
        await session.prompt("root-owned destination prompt");
      };
      const a = await makeRoot(roots[0]);
      let b: Awaited<ReturnType<typeof makeRoot>> | undefined;
      const parentRuntime = sdk.AgentSessionRuntime
        ? new sdk.AgentSessionRuntime(
            a.session,
            a.services,
            async ({ cwd, sessionManager, sessionStartEvent }: any) => {
              const next = await makeRoot(cwd, sessionManager, sessionStartEvent);
              return { session: next.session, services: next.services, diagnostics: [] };
            },
          )
        : undefined;
      if (process.env.DW_REQUIRE_NESTED)
        assert.ok(parentRuntime, "native fixture requires real runtime replacement API");
      const scope = new ChildApprovalScope(a.manager);
      const executions: Record<string, number> = { "custom-read": 0, "custom-write": 0, "custom-edit": 0 };
      const run = async (tools: any[], name: string, input: Record<string, unknown>) => {
        core.setResponses([
          fauxAssistantMessage(fauxToolCall(name, input), { stopReason: "toolUse" }),
          fauxAssistantMessage("done", { stopReason: "stop" }),
        ]);
        const agent = new WorkflowAgent({
          cwd: roots[1],
          tools,
          modelRegistry: registry,
          childApprovalScope: scope,
          providerMiddlewareExtensions: [],
        });
        await agent.run("child must not supply root instruction evidence", { model: `${provider}/local` });
      };
      try {
        await freshPrompt(a.session);
        for (const name of ["read", "write", "edit"]) {
          const custom = {
            name,
            label: name,
            description: "Collision execution spy",
            parameters: Type.Object({ path: Type.String() }),
            execute: async () => {
              executions[`custom-${name}`] = (executions[`custom-${name}`] ?? 0) + 1;
              return { content: [{ type: "text", text: "executed" }], details: undefined };
            },
          };
          const before = evidence.length;
          await run([custom], name, { path: join(roots[1], "inside.txt") });
          assert.equal(evidence.length, before + 1, `${name} collision must classify despite implicit exemptions`);
          assert.equal(executions[`custom-${name}`] ?? 0, 0);
          assert.equal(JSON.parse(evidence.at(-1)?.action ?? "").toolName, name);
          assert.match(evidence.at(-1)?.instructions ?? "", /DESTINATION_A_ONLY/);
        }
        writeFileSync(join(roots[1], "native.txt"), "original");
        const native = createCodingTools(roots[1])
          .filter((tool) => ["read", "write", "edit"].includes(tool.name))
          .map((tool) => ({
            ...tool,
            execute: async (...args: Parameters<typeof tool.execute>) => {
              executions[`native-${tool.name}`] = (executions[`native-${tool.name}`] ?? 0) + 1;
              return tool.execute(...args);
            },
          }));
        for (const [name, input] of [
          ["read", { path: "native.txt" }],
          ["write", { path: "native.txt", content: "written" }],
          ["edit", { path: "native.txt", oldText: "written", newText: "edited" }],
        ] as const) {
          const before = evidence.length;
          await run(native, name, input);
          assert.equal(evidence.length, before + 1);
          assert.equal(executions[`native-${name}`] ?? 0, 0);
          decision = "allow";
          await run(native, name, input);
          assert.equal(evidence.length, before + 2);
          assert.equal(executions[`native-${name}`], 1, "classifier allow must reach original native implementation");
          decision = "block";
        }
        assert.equal(readFileSync(join(roots[1], "native.txt"), "utf8"), "edited");
        // Native fixture uses the real runtime switch operation, including shutdown
        // and destination session_start; older SDKs use disposal/recreation.
        // Do not fabricate a destination before_agent_start from child data.
        if (parentRuntime) {
          const destination = SessionManager.create(roots[1], join(home, "sessions"));
          destination.appendMessage({ role: "user", content: "destination root history", timestamp: Date.now() });
          // Older Pi delays creating the session file until an assistant entry.
          destination.appendMessage(fauxAssistantMessage("destination history", { stopReason: "stop" }));
          const sessionFile = destination.getSessionFile();
          assert.ok(sessionFile);
          assert.equal(JSON.parse(readFileSync(sessionFile, "utf8").split("\n")[0]).cwd, roots[1]);
          assert.equal((await parentRuntime.switchSession(sessionFile)).cancelled, false);
          b = {
            session: parentRuntime.session,
            manager: parentRuntime.session.sessionManager,
            services: parentRuntime.services,
          };
          assert.equal(parentRuntime.cwd, roots[1]);
          assert.notEqual(b.manager, a.manager);
        } else {
          a.session.dispose();
          b = await makeRoot(roots[1]);
        }
        scope.bind(b.manager);
        decision = "allow";
        const before = evidence.length;
        await run(native, "read", { path: "native.txt" });
        assert.equal(evidence.length, before, "destination before first prompt must block without calling classifier");
        assert.equal(executions["native-read"], 1);
        await freshPrompt(b.session);
        await run(native, "read", { path: "native.txt" });
        assert.equal(executions["native-read"], 2);
        assert.equal(evidence.length, before + 1);
        assert.match(evidence.at(-1)?.instructions ?? "", /DESTINATION_B_ONLY/);
        assert.doesNotMatch(evidence.at(-1)?.instructions ?? "", /DESTINATION_A_ONLY/);
        let nestedSupported = false;
        decision = "block";
        const nestedRead = {
          name: "read",
          label: "read",
          description: "Nested collision spy",
          parameters: Type.Object({}),
          execute: async () => {
            executions["nested-read"] = (executions["nested-read"] ?? 0) + 1;
            return { content: [{ type: "text", text: "executed" }], details: undefined };
          },
        };
        const outer = {
          name: "outer",
          label: "outer",
          description: "Actual gate nested executor",
          parameters: Type.Object({}),
          execute: async (_id: string, _input: unknown, _signal: unknown, _update: unknown, context: any) => {
            if (context.executeTool) {
              nestedSupported = true;
              await context.executeTool("read", {});
            }
            return { content: [{ type: "text", text: "done" }], details: undefined };
          },
        };
        const beforeNested = evidence.length;
        await run([outer, nestedRead], "outer", {});
        if (process.env.DW_REQUIRE_NESTED) assert.equal(nestedSupported, true);
        if (nestedSupported) {
          assert.equal(evidence.length, beforeNested + 2);
          assert.equal(JSON.parse(evidence.at(-1)?.action ?? "").toolName, "read");
          assert.ok(JSON.parse(evidence.at(-1)?.action ?? "").child.parentToolCallId);
        }
        assert.equal(executions["nested-read"] ?? 0, 0);
        t.diagnostic(
          JSON.stringify({
            executions,
            classifierCalls: evidence.length,
            nestedSupported,
            destinationBeforePrompt: { classifierCalls: 0, executions: 0 },
            evidence,
          }),
        );
      } finally {
        if (parentRuntime) await parentRuntime.dispose();
        else {
          a.session.dispose();
          b?.session.dispose();
        }
      }
    });
  } finally {
    if (previous === undefined) delete globals[slot];
    else globals[slot] = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
