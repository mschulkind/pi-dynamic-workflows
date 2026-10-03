import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequestObserver, observeRequestInvocations } from "../src/request-recording.js";

const identity = {
  rootRunId: "r",
  frameRunId: "r",
  executionId: "e",
  callId: "r:0",
  stableWorkId: "w",
  childAttemptId: "a",
  childAttemptOrdinal: 1,
  sessionId: "s",
};
test("records every assistant boundary, retry and partial abort without content or default-zero claims", () => {
  const records: any[] = [];
  const observer = createRequestObserver({ ...identity, secret: "SECRET" } as any, { provider: "p", id: "m" }, (r) =>
    records.push(r),
  );
  observer.event({ type: "message_start", message: { role: "assistant" } } as any);
  observer.event({
    type: "message_update",
    message: { role: "assistant" },
    assistantMessageEvent: { type: "thinking_delta", delta: "SECRET" },
  } as any);
  observer.event({
    type: "message_end",
    message: {
      role: "assistant",
      model: "m",
      stopReason: "error",
      errorMessage: "SECRET",
      usage: { input: 0, output: 3, cacheRead: 0, reasoning: 2, secret: "SECRET" },
    },
  } as any);
  observer.event({ type: "auto_retry_start" } as any);
  observer.event({ type: "message_start", message: { role: "assistant" } } as any);
  observer.close(true);
  assert.equal(records.length, 4);
  assert.equal(records[1].usage.input.status, "unknown");
  assert.equal(records[1].usage.output.value, 3);
  assert.equal(records[1].usage.reasoning.value, 2);
  assert.equal(records[3].outcome, "aborted");
  assert.equal(records[2].retryOfObservationId, records[0].observationId);
  assert.ok(records[1].timing.firstReasoningOffsetMs >= 0);
  assert.equal(records[1].timing.firstVisibleAnswerOffsetMs, null);
  assert.equal(JSON.stringify(records).includes("SECRET"), false);
});
test("observer rejection/throw never breaks agents and visible text is not reasoning or tools", () => {
  const records: any[] = [];
  const observer = createRequestObserver(identity, undefined, (r) => {
    records.push(r);
    throw Error("disk");
  });
  observer.event({ type: "message_start", message: { role: "assistant" } } as any);
  observer.event({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: "x" } } as any);
  observer.event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer" } } as any);
  observer.event({
    type: "message_end",
    message: { role: "assistant", stopReason: "stop", usage: { output: 0 } },
  } as any);
  assert.equal(records[1].usage.output.status, "unknown");
  assert.ok(records[1].timing.firstVisibleAnswerOffsetMs >= 0);
  assert.equal(records[1].outcome, "success");
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WorkflowAgent } from "../src/agent.js";
import { createRunPersistence, type PersistedRunState } from "../src/run-persistence.js";
import { runWorkflow } from "../src/workflow.js";
import { loadWorkflowSettings } from "../src/workflow-settings.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";
import { fauxRegistry } from "./helpers/faux-registry.js";

async function isolated(fn: (root: string) => Promise<void>) {
  const base = process.env.TMPDIR ?? "/tmp";
  mkdirSync(join(base, "request-recording-tests"), { recursive: true });
  const root = mkdtempSync(join(base, "request-recording-tests", "test-"));
  try {
    await withFakeHomeAsync(root, () => fn(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("durable starts survive cold reads and stale snapshots; failed head and truncation fail closed", () =>
  isolated(async (root) => {
    const persistence = createRunPersistence(root);
    const state: PersistedRunState = {
      runId: "r",
      workflowName: "test",
      script: "",
      status: "running",
      phases: [],
      agents: [],
      logs: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persistence.save(state);
    const records: any[] = [];
    const observer = createRequestObserver(identity, undefined, (r) => records.push(r));
    observer.event({ type: "message_start", message: { role: "assistant" } } as any);
    assert.equal(persistence.appendObservation?.("r", records[0]), true);
    persistence.save(state);
    assert.equal(Object.keys(createRunPersistence(root).load("r")?.requestObservations ?? {}).length, 1);
    const log = join(persistence.getRunsDir(), "r.json.events.jsonl");
    const priorBytes = statSync(log).size;
    for (let i = 0; i < 50; i++) persistence.appendObservation?.("r", { ...records[0], recordId: `extra-${i}` });
    assert.ok(statSync(log).size - priorBytes < 200000, "append growth must be linear");
    const failing = createRunPersistence(root, {
      renameSync() {
        throw Error("head");
      },
    });
    assert.equal(failing.appendObservation?.("r", { ...records[0], recordId: "uncommitted" }), false);
    assert.equal(createRunPersistence(root).load("r")?.requestObservations?.uncommitted, undefined);
    // A subsequent append discards the uncommitted tail.
    persistence.appendObservation?.("r", { ...records[0], recordId: "after-failure" });
    assert.ok(createRunPersistence(root).load("r")?.requestObservations?.["after-failure"]);
    writeFileSync(log, "truncated");
    assert.equal(createRunPersistence(root).load("r"), null);
    persistence.delete("r");
  }));

test("real SDK faux sessions record tool follow-up, schema repair, named threads; no prompt contamination", () =>
  isolated(async (root) => {
    const core = createFauxCore({
      provider: "recording-faux",
      models: [{ id: "faux-model", name: "Faux", contextWindow: 128000, maxTokens: 4096 }],
    });
    const registry = await fauxRegistry(root, "recording-faux", core);
    const contexts: unknown[] = [];
    const records: any[] = [];
    const agent = new WorkflowAgent({
      cwd: root,
      modelRegistry: registry,
      tools: [
        defineTool({
          name: "ping",
          label: "ping",
          description: "test",
          parameters: Type.Object({}),
          execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
        }),
      ],
    });
    core.setResponses([
      fauxAssistantMessage(fauxToolCall("ping", {}), { stopReason: "toolUse" }),
      (context) => {
        contexts.push(context);
        return fauxAssistantMessage("done", { stopReason: "stop" });
      },
      fauxAssistantMessage("missing schema", { stopReason: "stop" }),
      fauxAssistantMessage(fauxToolCall("structured_output", { answer: "fixed" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("thread one", { stopReason: "stop" }),
      fauxAssistantMessage("thread two", { stopReason: "stop" }),
    ]);
    await agent.run("first", {
      model: "recording-faux/faux-model",
      requestIdentity: identity,
      onRequestObservation: (r) => records.push(r),
    });
    await agent.run("repair", {
      model: "recording-faux/faux-model",
      schema: Type.Object({ answer: Type.String() }),
      requestIdentity: { ...identity, childAttemptId: "b" },
      onRequestObservation: (r) => records.push(r),
    });
    await agent.run("thread", {
      model: "recording-faux/faux-model",
      thread: "same",
      requestIdentity: { ...identity, childAttemptId: "c" },
      onRequestObservation: (r) => records.push(r),
    });
    await agent.run("thread", {
      model: "recording-faux/faux-model",
      thread: "same",
      requestIdentity: { ...identity, childAttemptId: "d" },
      onRequestObservation: (r) => records.push(r),
    });
    const closed = records.filter((r) => r.phase === "closed");
    assert.equal(closed.length, 6);
    assert.equal(closed[4].sessionId, closed[5].sessionId);
    assert.notEqual(closed[4].childAttemptId, closed[5].childAttemptId);
    assert.equal(new Set(closed.map((r) => r.observationId)).size, 6);
    assert.equal(closed[0].requestedModel, "faux-model");
    // Match the inherited public runtime: older SDKs lack the recorder, while
    // newer SDKs expose it but leave it disabled unless explicitly configured.
    assert.equal(closed[0].transportLink.activation, coreRecordingActivation(registry.runtime));
    assert.equal(contexts.length, 1);
    assert.equal(JSON.stringify(contexts).includes("workflow_request_observation"), false);
    assert.equal(JSON.stringify(contexts).includes(closed[0].observationId), false);
  }));

test("direct runWorkflow defaults to durable evidence and explicit false disables it", () =>
  isolated(async (root) => {
    const core = createFauxCore({ provider: "recording-default", models: [{ id: "faux-model" }] });
    const registry = await fauxRegistry(root, "recording-default", core);
    const script = `export const meta = { name: 'record', description: 'test' }; await agent('hello', { model: 'recording-default/faux-model' });`;
    core.setResponses([
      fauxAssistantMessage("answer", { stopReason: "stop" }),
      fauxAssistantMessage("answer", { stopReason: "stop" }),
    ]);
    const health: string[] = [];
    const result = await runWorkflow(script, {
      cwd: root,
      runId: "default",
      modelRegistry: registry,
      persistLogs: false,
      onLog: (message) => health.push(message),
    });
    assert.ok(health.includes("request recording: enabled"));
    assert.ok(health.includes("request recording: invocation_observer_ready"));
    // Local diagnostics must not become model-facing workflow result logs.
    assert.equal(JSON.stringify(result.logs).includes("request recording:"), false);
    const persistence = createRunPersistence(root);
    assert.equal(Object.keys(persistence.load("default")?.requestObservations ?? {}).length, 2);
    await runWorkflow(script, {
      cwd: root,
      runId: "disabled",
      onLog: (message) => health.push(message),
      modelRegistry: registry,
      recordAgentRequests: false,
      persistLogs: false,
    });
    assert.equal(persistence.load("disabled"), null);
    assert.ok(health.includes("request recording: disabled"));
    const settingsPath = join(root, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ recordAgentRequests: false }));
    assert.equal(loadWorkflowSettings({ settingsPath }).recordAgentRequests, false);
  }));

import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { compactAgentHistory } from "../src/agent-history.js";
import { coreRecordingActivation } from "../src/request-recording.js";

test("core activation is public feature detection, not an environment guess or an activation call", () => {
  assert.equal(coreRecordingActivation({}), "unsupported");
  assert.equal(coreRecordingActivation({ getPerformanceRecordingHealth: () => undefined }), "disabled");
  assert.equal(coreRecordingActivation({ getPerformanceRecordingHealth: () => ({ written: 0 }) }), "enabled");
  assert.equal(
    coreRecordingActivation({
      getPerformanceRecordingHealth() {
        throw Error("failure");
      },
    }),
    "not_observed",
  );
});

test("real SDK retries retain request usage in optional sessions, while compact history loses it", () =>
  isolated(async (root) => {
    const core = createFauxCore({ provider: "recording-retry", models: [{ id: "faux-model" }] });
    const registry = await fauxRegistry(root, "recording-retry", core);
    const records: any[] = [];
    let sessionFile: string | undefined;
    const agent = new WorkflowAgent({
      cwd: root,
      modelRegistry: registry,
      persistAgentSessions: true,
      session: {
        settingsManager: SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } }),
      },
    });
    const failure = fauxAssistantMessage("", { stopReason: "error" });
    failure.errorMessage = "503 service unavailable SECRET";
    core.setResponses([failure, fauxAssistantMessage("recovered", { stopReason: "stop" })]);
    await agent.run("retry", {
      model: "recording-retry/faux-model",
      requestIdentity: identity,
      onRequestObservation: (r) => records.push(r),
      onSessionCreated: (s) => {
        sessionFile = s.sessionFile;
      },
    });
    const closed = records.filter((r) => r.phase === "closed");
    assert.equal(closed.length, 2);
    assert.equal(closed[0].outcome, "error");
    assert.equal(closed[1].retryOfObservationId, closed[0].observationId);
    assert.equal(JSON.stringify(records).includes("SECRET"), false);
    assert.ok(sessionFile);
    const entries = readFileSync(sessionFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const messages = entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant");
    assert.equal(messages.length, 2, "abandoned failed response survives in persistent session");
    assert.ok(messages.every((entry) => entry.id && entry.message.usage));
    assert.equal(
      JSON.stringify(compactAgentHistory(messages.map((entry) => entry.message))).includes('"usage"'),
      false,
    );
  }));

test("nested duplicate labels and workflow retries have distinct attempts; replay is not a request", () =>
  isolated(async (root) => {
    const records: any[] = [];
    const journal = new Map<string, any>();
    let runs = 0;
    const script = `export const meta = { name: 'ids', description: 'test' }; await parallel([() => agent('same', { label: 'duplicate' }), () => workflow("export const meta = { name: 'child', description: 'test' }; await agent('same', { label: 'duplicate' });")]);`;
    const fakeAgent = {
      async run(_prompt: string, options: any) {
        runs++;
        const observer = createRequestObserver(
          { ...options.requestIdentity, sessionId: `s-${runs}` },
          undefined,
          options.onRequestObservation,
        );
        observer.event({ type: "message_start", message: { role: "assistant" } } as any);
        observer.event({
          type: "message_end",
          message: { role: "assistant", stopReason: "stop", usage: { input: 10, output: 2 } },
        } as any);
        return "answer";
      },
    };
    const result = await runWorkflow(script, {
      cwd: root,
      runId: "identity",
      agent: fakeAgent,
      onRequestObservation: (r) => records.push(r),
      onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
      persistLogs: false,
    });
    assert.equal(runs, 2);
    assert.equal(new Set(records.filter((r) => r.phase === "closed").map((r) => r.callId)).size, 2);
    assert.equal(new Set(records.map((r) => r.rootRunId)).size, 1);
    assert.equal(new Set(records.map((r) => r.executionId)).size, 1);
    const oldWork = records[0].stableWorkId;
    await runWorkflow(script, {
      cwd: root,
      runId: "identity",
      agent: fakeAgent,
      resumeJournal: journal,
      onRequestObservation: (r) => records.push(r),
      persistLogs: false,
    });
    assert.equal(runs, 2);
    const replays = records.filter((r) => r.recordKind === "workflow_request_replay");
    assert.equal(replays.length, 2);
    assert.equal(replays[0].accountingRole, "non_request_provenance");
    assert.equal(replays[0].stableWorkId, oldWork);
    assert.ok(result.tokenUsage.total > 0, "existing estimate accounting remains intact");
    await runWorkflow(script.replaceAll("'same'", "'changed'"), {
      cwd: root,
      runId: "identity",
      agent: fakeAgent,
      resumeJournal: journal,
      onRequestObservation: (r) => records.push(r),
      persistLogs: false,
    });
    assert.equal(runs, 4);
    assert.notEqual(records.filter((r) => r.phase === "closed")[2].stableWorkId, oldWork);
  }));

test("async observer rejection is consumed, and end without text is not a visible answer", async () => {
  const observer = createRequestObserver(identity, undefined, async () => {
    throw Error("disk");
  });
  observer.event({ type: "message_start", message: { role: "assistant" } } as any);
  observer.close(false);
  await new Promise((resolve) => setImmediate(resolve));
});

import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";

test("workflow retry exhaustion preserves all attempts and terminal accounting", () =>
  isolated(async (root) => {
    const records: any[] = [];
    const retryCosts: number[] = [];
    const fakeAgent = {
      async run(_prompt: string, options: any) {
        const observer = createRequestObserver(
          { ...options.requestIdentity, sessionId: "failed-session" },
          undefined,
          options.onRequestObservation,
        );
        observer.event({ type: "message_start", message: { role: "assistant" } } as any);
        observer.event({
          type: "message_end",
          message: { role: "assistant", stopReason: "error", usage: { input: 11, output: 2 } },
        } as any);
        options.onUsage?.({ input: 11, output: 2, cacheRead: 0, cacheWrite: 0, total: 13, cost: 0 });
        throw new WorkflowError("local failure", WorkflowErrorCode.AGENT_EMPTY_OUTPUT, { recoverable: true });
      },
    };
    const result = await runWorkflow(
      `export const meta = { name: 'failure', description: 'test' }; await agent('hello');`,
      {
        cwd: root,
        agent: fakeAgent,
        agentRetries: 1,
        agentRetryBackoffMs: () => 0,
        onRequestObservation: (r) => records.push(r),
        onRetrySpend: (tokens: number) => retryCosts.push(tokens),
        persistLogs: false,
      },
    );
    assert.equal(result.tokenUsage.total, 26);
    const closed = records.filter((r) => r.phase === "closed");
    assert.equal(closed.length, 2);
    assert.deepEqual(
      closed.map((r) => r.childAttemptOrdinal),
      [1, 2],
    );
    assert.notEqual(closed[0].childAttemptId, closed[1].childAttemptId);
    assert.equal(closed[0].stableWorkId, closed[1].stableWorkId);
    assert.equal(retryCosts.length, 1);
  }));

test("abort-drain observations can append after workflow snapshot callbacks close", () =>
  isolated(async (root) => {
    const controller = new AbortController();
    const agent = {
      async run(_prompt: string, options: any) {
        setTimeout(() => controller.abort(), 5);
        const observer = createRequestObserver(
          { ...options.requestIdentity, sessionId: "partial" },
          undefined,
          options.onRequestObservation,
        );
        observer.event({ type: "message_start", message: { role: "assistant" } } as any);
        observer.event({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "PRIVATE" },
        } as any);
        await new Promise<void>((resolve) =>
          options.signal.addEventListener("abort", () => setTimeout(resolve, 20), { once: true }),
        );
        observer.close(true);
        throw Error("aborted");
      },
    };
    await assert.rejects(
      runWorkflow(`export const meta = { name: 'timeout', description: 'test' }; await agent('hello');`, {
        cwd: root,
        runId: "timeout",
        agent,
        signal: controller.signal,
        drainAbortGraceMs: 1,
        persistLogs: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    const evidence = Object.values(createRunPersistence(root).load("timeout")?.requestObservations ?? {}) as any[];
    assert.equal(evidence.length, 2);
    assert.equal(evidence[1].outcome, "aborted");
    assert.ok(evidence[1].timing.firstVisibleAnswerOffsetMs >= 0);
    assert.equal(JSON.stringify(evidence).includes("PRIVATE"), false);
  }));

import { existsSync } from "node:fs";
import { WorkflowManager } from "../src/workflow-manager.js";

test("managed default children persist evidence without changing aggregates; opt-out and retention remain independent", () =>
  isolated(async (root) => {
    const core = createFauxCore({ provider: "recording-manager", models: [{ id: "faux-model" }] });
    const registry = await fauxRegistry(root, "recording-manager", core);
    core.setResponses(Array.from({ length: 3 }, () => fauxAssistantMessage("same answer", { stopReason: "stop" })));
    const persistence = createRunPersistence(root, undefined, { maxTerminalRunsOnDisk: 1 });
    const script = `export const meta = { name: 'managed', description: 'test' }; await agent('same task', { model: 'recording-manager/faux-model' });`;
    const manager = new WorkflowManager({ cwd: root, modelRegistry: registry });
    const first = manager.startInBackground(script);
    const withRecording = await first.promise;
    const cold = createRunPersistence(root).load(first.runId);
    assert.equal(Object.keys(cold?.requestObservations ?? {}).length, 2);
    const observations = Object.values(cold?.requestObservations ?? {}) as any[];
    assert.equal(observations[0].sessionId, cold?.agents[0].sessionId);
    assert.equal(cold?.agents[0].sessionFile, undefined);
    const disabled = new WorkflowManager({
      cwd: root,
      modelRegistry: registry,
      recordAgentRequests: false,
    });
    const second = disabled.startInBackground(script);
    const withoutRecording = await second.promise;
    assert.deepEqual(withRecording.tokenUsage, withoutRecording.tokenUsage);
    assert.equal(Object.keys(createRunPersistence(root).load(second.runId)?.requestObservations ?? {}).length, 0);
    const terminal = persistence.load(second.runId);
    assert.ok(terminal);
    persistence.save(terminal);
    assert.equal(createRunPersistence(root).load(first.runId), null, "run retention also removes its evidence");
    assert.equal(existsSync(join(persistence.getRunsDir(), `${first.runId}.json.events.jsonl`)), false);
    persistence.delete(second.runId);
    assert.equal(existsSync(join(persistence.getRunsDir(), `${second.runId}.json.events.jsonl`)), false);
  }));

import { defaultPersistenceFs } from "../src/fs-persistence.js";
import { createRunRecordStore } from "../src/run-record-store.js";
import { workflowProjectPaths } from "../src/workflow-paths.js";

test("one interrupted real SDK stream invocation remains one request despite synthetic error message starts", () =>
  isolated(async (root) => {
    const core = createFauxCore({ provider: "recording-interrupted", models: [{ id: "faux-model" }] });
    const registry = await fauxRegistry(root, "recording-interrupted", core);
    let invocations = 0;
    const partial = fauxAssistantMessage("PRIVATE PARTIAL", { stopReason: "pending" });
    const { session } = await createAgentSession({
      cwd: root,
      modelRuntime: registry.runtime,
      model: registry.find("recording-interrupted", "faux-model"),
      sessionManager: SessionManager.inMemory(root),
      tools: [],
      settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
    });
    // The documented public function injection bypasses the runtime's lazy
    // provider adapter (which itself catches iterator errors). The agent loop
    // must synthesize an error after already emitting a partial message start.
    session.agent.streamFunction = (() => {
      invocations++;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial };
          yield { type: "text_delta", contentIndex: 0, delta: "PRIVATE PARTIAL", partial };
          throw Error("interrupted SECRET");
        },
        result: () => new Promise(() => {}),
      };
    }) as never;
    const records: any[] = [];
    const observer = createRequestObserver({ ...identity, sessionId: session.sessionId }, session.model, (r) =>
      records.push(r),
    );
    const restore = observeRequestInvocations(session.agent, observer);
    const unsubscribe = session.subscribe((event) => observer.event(event));
    try {
      await session.prompt("interrupt");
    } finally {
      restore();
      unsubscribe();
      observer.close(false);
      await session.dispose();
    }
    const closed = records.filter((r) => r.phase === "closed");
    assert.equal(invocations, 1);
    assert.ok(closed.every((r) => typeof r.sdkInvocationId === "string"));
    assert.equal(new Set(closed.map((r) => r.sdkInvocationId)).size, 1);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].assistantMessageStarts, 2);
    assert.equal(closed[0].outcome, "error");
    assert.equal(closed[0].timing.startBoundary, "sdk_stream_invocation");
    assert.ok(closed[0].timing.firstVisibleAnswerOffsetMs >= 0);
    assert.equal(JSON.stringify(records).includes("PRIVATE"), false);
    assert.equal(JSON.stringify(records).includes("SECRET"), false);
  }));

test("direct recording retries container initialization after a transient initial save failure", () =>
  isolated(async (root) => {
    const runsDir = workflowProjectPaths(root).runsDir;
    mkdirSync(join(runsDir, ".."), { recursive: true });
    writeFileSync(runsDir, "obstruct directory");
    const agent = {
      async run(_prompt: string, options: any) {
        const observer = createRequestObserver(
          { ...options.requestIdentity, sessionId: "transient" },
          undefined,
          options.onRequestObservation,
        );
        observer.event({ type: "message_start", message: { role: "assistant" } } as any);
        rmSync(runsDir);
        observer.event({
          type: "message_end",
          message: { role: "assistant", stopReason: "stop", usage: { output: 3 } },
        } as any);
        return "answer";
      },
    };
    await runWorkflow(`export const meta = { name: 'transient', description: 'test' }; await agent('hello');`, {
      cwd: root,
      runId: "transient",
      agent,
      persistLogs: false,
    });
    const evidence = Object.values(createRunPersistence(root).load("transient")?.requestObservations ?? {}) as any[];
    assert.equal(evidence.length, 1, "failed start is unavailable, but later terminal observation must persist");
    assert.equal(evidence[0].phase, "closed");
    assert.equal(evidence[0].usage.output.value, 3);
  }));

test("alternating observation append and snapshot save does not repeatedly hydrate the growing log", () =>
  isolated(async (root) => {
    const measure = (n: number) => {
      const real = defaultPersistenceFs();
      let bytesRead = 0;
      const store = createRunRecordStore({
        ...real,
        readSync(...args) {
          const read = real.readSync(...args);
          bytesRead += read;
          return read;
        },
      });
      const state: PersistedRunState = {
        runId: `read-${n}`,
        workflowName: "read-growth",
        script: "",
        status: "running",
        phases: [],
        agents: [],
        logs: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const path = join(root, `read-${n}.json`);
      store.save(path, state);
      const records: any[] = [];
      createRequestObserver(identity, undefined, (r) => records.push(r)).event({
        type: "message_start",
        message: { role: "assistant" },
      } as any);
      for (let i = 0; i < n; i++) {
        store.appendObservation(path, { ...records[0], recordId: `observation-${i}` });
        store.save(path, state);
      }
      assert.equal(Object.keys(store.read(path)?.requestObservations ?? {}).length, n);
      return bytesRead;
    };
    const small = measure(40),
      large = measure(80);
    console.log(`Committed-log read bytes for alternating append/save: 40=${small}, 80=${large}`);
    assert.ok(large <= Math.max(4096, small * 2.5), `read growth must not be quadratic: ${small} -> ${large}`);
  }));

test("public invocation wrapper preserves stream, receiver, options and iteration; message-less results remain labeled", async () => {
  const records: any[] = [];
  const observer = createRequestObserver(identity, undefined, (r) => records.push(r));
  const model = { provider: "local", id: "requested" } as any;
  const context = { messages: [] };
  const options = { onPayload: () => undefined, signal: new AbortController().signal, maxRetries: 3, sessionId: "s" };
  const message = fauxAssistantMessage("PRIVATE ANSWER", { stopReason: "stop" });
  message.responseModel = "returned-model";
  message.usage = { ...message.usage, output: 3, reasoning: 0 };
  let iterations = 0;
  const stream = {
    result: () => Promise.resolve(message),
    async *[Symbol.asyncIterator]() {
      iterations++;
      yield { type: "done", message };
    },
  };
  const returned = Promise.resolve(stream);
  const agent = {
    streamFunction: function (this: unknown, ...args: unknown[]) {
      assert.equal(this, agent);
      assert.deepEqual(args, [model, context, options]);
      assert.equal(args[2], options);
      return returned;
    },
  } as any;
  const original = agent.streamFunction;
  const restore = observeRequestInvocations(agent, observer);
  assert.equal(agent.streamFunction(model, context, options), returned);
  await new Promise((resolve) => setImmediate(resolve));
  observer.close(false);
  restore();
  assert.equal(agent.streamFunction, original);
  assert.equal(iterations, 0, "observer must never consume the SDK iterator");
  assert.equal(records.length, 2);
  assert.equal(records[1].timing.completionBoundary, "sdk_stream_result");
  assert.equal(records[1].assistantMessageStarts, 0);
  assert.equal(records[1].returnedModel, "returned-model");
  assert.equal(records[1].usage.reasoning.status, "sdk_normalized");
  assert.equal(records[1].usage.reasoning.value, 0);
  assert.equal(records[1].usage.output.value, 3);
  assert.equal(JSON.stringify(records).includes("PRIVATE"), false);
});

test("warm observation cache remains coherent across mutation, external writers and failed commits", () =>
  isolated(async (root) => {
    const fs = defaultPersistenceFs();
    const path = join(root, "coherent.json");
    let rejectHead = false;
    const store = createRunRecordStore({
      ...fs,
      renameSync(from, to) {
        if (rejectHead && String(to) === path) throw Error("injected commit failure");
        return fs.renameSync(from, to);
      },
    });
    const other = createRunRecordStore(fs);
    const state: PersistedRunState = {
      runId: "coherent",
      workflowName: "coherent",
      script: "",
      status: "running",
      phases: [],
      agents: [],
      logs: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.save(path, state);
    const records: any[] = [];
    createRequestObserver(identity, undefined, (r) => records.push(r)).event({
      type: "message_start",
      message: { role: "assistant" },
    } as any);
    const first = { ...records[0], recordId: "first" };
    store.appendObservation(path, first);
    first.requestedModel = "mutated";
    assert.equal((store.read(path)?.requestObservations?.first as any).requestedModel, null);
    other.appendObservation(path, { ...records[0], recordId: "external" });
    store.appendObservation(path, { ...records[0], recordId: "after-external" });
    store.save(path, state);
    assert.deepEqual(Object.keys(store.read(path)?.requestObservations ?? {}), ["first", "external", "after-external"]);
    rejectHead = true;
    assert.throws(
      () => store.appendObservation(path, { ...records[0], recordId: "uncommitted" }),
      /injected commit failure/,
    );
    rejectHead = false;
    assert.equal(store.read(path)?.requestObservations?.uncommitted, undefined);
    store.appendObservation(path, { ...records[0], recordId: "after-failure" });
    const cold = createRunRecordStore(fs).read(path);
    assert.ok(cold?.requestObservations?.["after-failure"]);
    assert.deepEqual(cold?.requestObservations, store.read(path)?.requestObservations);
  }));

test("unsupported managed append sinks and rejected writes are locally visible and nonfatal", () =>
  isolated(async (root) => {
    const agent = {
      async run(_prompt: string, options: any) {
        if (options.onRequestObservation) {
          const observer = createRequestObserver(
            { ...options.requestIdentity, sessionId: "s" },
            undefined,
            options.onRequestObservation,
            "not_observed",
            options.onRequestRecordingHealth,
          );
          observer.event({ type: "message_start", message: { role: "assistant" } } as any);
          observer.close(false);
          await new Promise((resolve) => setImmediate(resolve));
        }
        return "answer";
      },
    };
    for (const appendObservation of [
      undefined,
      () => {
        throw Error("SECRET https://credentials");
      },
      () => Promise.reject(Error("SECRET")),
    ]) {
      const manager = new WorkflowManager({ cwd: root, agent });
      (manager as any).persistence.appendObservation = appendObservation;
      const result = await manager.runSync(
        `export const meta = { name: 'health', description: 'test' }; await agent('hello');`,
      );
      const state = createRunPersistence(root).load(result.runId);
      assert.ok(state);
      assert.equal(state.status, "completed");
      assert.ok(
        state.logs.includes(
          appendObservation ? "request recording: append_failed" : "request recording: missing_append_sink",
        ),
      );
      assert.equal(JSON.stringify(state.logs).includes("SECRET"), false);
    }
  }));
