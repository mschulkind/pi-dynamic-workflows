import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Core from "@earendil-works/pi-coding-agent";
import { WorkflowAgent } from "../src/agent.js";
import { createRunPersistence } from "../src/run-persistence.js";
import { runWorkflow } from "../src/workflow.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

const sdk = Core as any;
function retainFixture(name: string, runtime: any, attempts: unknown[], observations: unknown[]) {
  const artifactDirectory = process.env.WORKFLOW_CAPTURE_ARTIFACT_DIR;
  if (!artifactDirectory) return;
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(artifactDirectory, `${name}.json`),
    JSON.stringify({ runtime: sdk.getRuntimeInfo(runtime, []), attempts, observations }, null, 2),
    { mode: 0o600 },
  );
}
test("public Core runtime dispatch joins freshly hydrated workflow journal to actual local HTTP/SSE attempts", {
  skip: typeof sdk.getProducerObservationCapability !== "function",
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-producer-transport-"));
  const saved = new Map(
    ["YOLO_DURABLE_DIR", "PI_API_PERFORMANCE", "PI_API_PERFORMANCE_DIR"].map((key) => [key, process.env[key]]),
  );
  delete process.env.PI_API_PERFORMANCE;
  delete process.env.PI_API_PERFORMANCE_DIR;
  process.env.YOLO_DURABLE_DIR = root;
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const index = ++calls;
      if (index === 1) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end('{"error":{"message":"fixture retry"}}');
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const delta =
        index === 2
          ? {
              tool_calls: [
                { index: 0, id: "fixture-tool", type: "function", function: { name: "ping", arguments: "{}" } },
              ],
            }
          : { content: "fixture answer" };
      for (const chunk of [
        {
          id: "fixture-response",
          object: "chat.completion.chunk",
          model: "fixture",
          choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }],
        },
        {
          id: "fixture-response",
          object: "chat.completion.chunk",
          model: "fixture",
          choices: [{ index: 0, delta: {}, finish_reason: index === 2 ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        },
      ])
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  let runtime: any;
  try {
    await withFakeHomeAsync(root, async () => {
      runtime = await sdk.ModelRuntime.create({
        authPath: join(root, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      assert.equal(runtime.getTransportRecordingStatus().enabled, true);
      runtime.registerProvider("workflow-local-http", {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "fixture-unused",
        api: "openai-completions",
        models: [
          {
            id: "fixture",
            name: "Fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      });
      const dispatches: any[] = [];
      const unsubscribe = sdk
        .getProducerObservationCapability(runtime)
        .subscribe((event: unknown) => dispatches.push(event));
      const agent = new WorkflowAgent({
        cwd: root,
        modelRegistry: new Core.ModelRegistry(runtime),
        session: {
          settingsManager: Core.SettingsManager.inMemory({
            retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
            compaction: { enabled: false },
            cacheWarming: "off",
          }),
          customTools: [
            Core.defineTool({
              name: "ping",
              description: "fixture",
              parameters: { type: "object", properties: {} },
              execute: async () => ({ content: [{ type: "text", text: "fixture tool" }], details: {} }),
            }),
          ],
        },
      });
      const script = `export const meta = { name: 'capture', description: 'fixture' }; return await agent('fixture', { model: 'workflow-local-http/fixture', thinking: 'high' });`;
      const result = await runWorkflow(script, { cwd: root, agent, persistLogs: false });
      await runtime.flushPerformanceRecords();
      const ledger = join(root, "pi-api-performance");
      assert.equal(statSync(ledger).mode & 0o777, 0o700);
      const attempts = readdirSync(ledger)
        .flatMap((file) => {
          assert.equal(statSync(join(ledger, file)).mode & 0o777, 0o600);
          return readFileSync(join(ledger, file), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        })
        .filter((record) => record.recordKind === "api_attempt");
      const hydrated = createRunPersistence(root).load(result.runId);
      assert.ok(hydrated);
      const observations = Object.values(hydrated.requestObservations ?? {}).filter(
        (record: any) => record.phase === "closed",
      ) as any[];
      assert.ok(attempts.length >= 3, `expected physical attempts, saw ${attempts.length}`);
      assert.ok(observations.length >= 2);
      for (const record of observations) {
        assert.equal(record.transportLink.granularity, "core_logical_request");
        assert.equal(record.transportLink.wireAttemptId, null);
        assert.ok(
          dispatches.some(
            (d) => d.sdkInvocationId === record.sdkInvocationId && d.logicalRequestId === record.logicalRequestId,
          ),
        );
        assert.ok(
          attempts.some(
            (a) =>
              a.sdkInvocationId === record.sdkInvocationId &&
              a.logicalRequestId === record.logicalRequestId &&
              a.sessionId === record.sessionId,
          ),
        );
        assert.equal(record.reasoning.requestedExplicit, "high");
        assert.equal(record.reasoning.resolvedSession, "off");
        assert.equal(record.reasoning.clamped, true);
      }
      assert.notEqual(observations[0].logicalRequestId, observations.at(-1).logicalRequestId);
      assert.ok(runtime.getTransportRecordingStatus().observedHealth.written >= attempts.length);
      retainFixture("http-sse", runtime, attempts, Object.values(hydrated.requestObservations ?? {}));
      const before = calls;
      await runWorkflow(script, { cwd: root, agent, recordAgentRequests: false, persistLogs: false });
      assert.equal(calls, before + 1);
      runtime.configureTransportRecording({ directory: null });
      assert.equal(runtime.getTransportRecordingStatus().enabled, false);
      await runWorkflow(script, { cwd: root, agent, persistLogs: false });
      await runtime.flushPerformanceRecords();
      assert.equal(
        readdirSync(ledger).flatMap((file) => readFileSync(join(ledger, file), "utf8").trim().split("\n")).length,
        attempts.length + 1,
      );
      unsubscribe();
    });
  } finally {
    await runtime?.flushPerformanceRecords();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("public Core WebSocket adapter operation IDs join workflow observations without equating connections to generations", {
  skip: typeof sdk.getProducerObservationCapability !== "function",
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-producer-ws-"));
  const original = globalThis.WebSocket;
  const saved = new Map(["PI_API_PERFORMANCE", "PI_API_PERFORMANCE_DIR"].map((key) => [key, process.env[key]]));
  delete process.env.PI_API_PERFORMANCE;
  delete process.env.PI_API_PERFORMANCE_DIR;
  const sockets: EventTarget[] = [];
  class Socket extends EventTarget {
    readyState = 1;
    constructor() {
      super();
      sockets.push(this);
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(_payload: string) {
      queueMicrotask(() => {
        for (const event of [
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "message", id: "fixture-message", role: "assistant", content: [] },
          },
          {
            type: "response.content_part.added",
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "" },
          },
          {
            type: "response.output_text.delta",
            item_id: "fixture-message",
            output_index: 0,
            content_index: 0,
            delta: "fixture answer",
          },
          {
            type: "response.completed",
            response: {
              id: "fixture-response",
              model: "fixture",
              status: "completed",
              output: [],
              usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
            },
          },
        ])
          this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(event) }));
      });
    }
    close() {
      this.readyState = 3;
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  let runtime: any;
  try {
    await withFakeHomeAsync(root, async () => {
      runtime = await sdk.ModelRuntime.create({
        authPath: join(root, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
        performanceDirectory: join(root, "ledger"),
      });
      const fixtureToken = `aaa.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64")}.bbb`;
      runtime.registerProvider("workflow-local-ws", {
        baseUrl: "http://127.0.0.1:9/faux",
        apiKey: fixtureToken,
        api: "openai-codex-responses",
        models: [
          {
            id: "fixture",
            name: "Fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      });
      const agent = new WorkflowAgent({
        cwd: root,
        modelRegistry: new Core.ModelRegistry(runtime),
        session: {
          settingsManager: Core.SettingsManager.inMemory({
            transport: "websocket",
            retry: { enabled: false },
            compaction: { enabled: false },
            cacheWarming: "off",
          }),
        },
      });
      const result = await runWorkflow(
        `export const meta = {name: 'ws', description: 'fixture'}; return await agent('fixture', {model: 'workflow-local-ws/fixture'});`,
        { cwd: root, agent, persistLogs: false },
      );
      await runtime.flushPerformanceRecords();
      const records = readdirSync(join(root, "ledger")).flatMap((file) =>
        readFileSync(join(root, "ledger", file), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      );
      const attempts = records.filter(
        (record) => record.recordKind === "api_attempt" && record.attemptKind === "generation",
      );
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].transport, "websocket");
      assert.equal(attempts[0].websocket.sendAccepted, true);
      const hydrated = createRunPersistence(root).load(result.runId);
      assert.ok(hydrated);
      const closed = Object.values(hydrated.requestObservations ?? {}).filter(
        (r: any) => r.phase === "closed",
      ) as any[];
      assert.equal(closed.length, 1);
      assert.equal(closed[0].logicalRequestId, attempts[0].logicalRequestId);
      assert.equal(closed[0].sdkInvocationId, attempts[0].sdkInvocationId);
      assert.equal(closed[0].transportLink.wireAttemptId, null);
      assert.equal(closed[0].reasoning.requestedExplicit, null);
      assert.equal(closed[0].reasoning.selected, null);
      assert.equal(closed[0].reasoning.selectionSource, "session_default");
      retainFixture("websocket-adapter", runtime, records, Object.values(hydrated.requestObservations ?? {}));
    });
  } finally {
    await runtime?.flushPerformanceRecords();
    globalThis.WebSocket = original;
    for (const socket of sockets) (socket as Socket).close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
