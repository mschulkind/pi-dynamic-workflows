import assert from "node:assert/strict";
import test from "node:test";
import { coreRecordingActivation, createRequestObserver } from "../src/request-recording.js";

const identity = {
  rootRunId: "r",
  frameRunId: "r",
  executionId: "e",
  callId: "c",
  stableWorkId: "w",
  childAttemptId: "a",
  childAttemptOrdinal: 1,
  sessionId: "s",
};
const event = (sdkInvocationId: string, logicalRequestId: string, orchestrationRetry = 0) => ({
  schemaVersion: 1 as const,
  boundary: "provider_dispatch" as const,
  sdkInvocationId,
  logicalRequestId,
  sessionId: "s",
  operationId: "op",
  purpose: "assistant" as const,
  orchestrationRetry,
  provider: "p",
  api: "openai-completions",
  model: "m",
  wireAttemptId: null,
  transportCoverage: "supported" as const,
});
test("only final Core dispatch upgrades linkage; retries share logical ID and tool follow-ups replace it", () => {
  const records: any[] = [];
  const observer = createRequestObserver(identity, { provider: "p", id: "m" }, (r) => records.push(r));
  for (const [id, logical, retry] of [
    ["i1", "l1", 0],
    ["i2", "l1", 1],
    ["i3", "l2", 0],
  ] as const) {
    const local = observer.beginInvocation({ provider: "p", id: "m" }, { reasoning: "high" });
    assert.equal(records.at(-1).logicalRequestId, null);
    observer.dispatch({ ...event(id, logical, retry), sessionId: "other" });
    observer.dispatch(event(id, logical, retry));
    assert.ok(local);
    observer.streamResult(local, { role: "assistant", stopReason: "stop", usage: { output: 2 } } as any);
    observer.close(false);
  }
  const closed = records.filter((r) => r.phase === "closed");
  assert.deepEqual(
    closed.map((r) => r.logicalRequestId),
    ["l1", "l1", "l2"],
  );
  assert.deepEqual(
    closed.map((r) => r.sdkInvocationId),
    ["i1", "i2", "i3"],
  );
  assert.equal(closed[0].transportLink.granularity, "core_logical_request");
  assert.equal(closed[0].transportLink.wireAttemptId, null);
  assert.equal(closed[0].reasoning.sdkInvocation, "high");
});
test("unknown reasoning is not off and malformed metadata cannot leak", () => {
  const records: any[] = [];
  const observer = createRequestObserver(identity, undefined, (r) => records.push(r));
  observer.beginInvocation({ provider: "p", id: "m" }, { reasoning: "https://SECRET" });
  observer.dispatch({ ...event("https://SECRET", "https://SECRET"), operationId: "https://SECRET" });
  observer.close(false);
  assert.equal(records[1].reasoning.sdkInvocation, null);
  assert.equal(records[1].logicalRequestId, null);
  assert.equal(JSON.stringify(records).includes("SECRET"), false);
});
test("current public status distinguishes enabled from durable writes", () => {
  assert.equal(
    coreRecordingActivation({
      getTransportRecordingStatus: () => ({ capabilityVersion: 1, enabled: true, observedHealth: { written: 0 } }),
    }),
    "enabled",
  );
  assert.equal(
    coreRecordingActivation({ getTransportRecordingStatus: () => ({ capabilityVersion: 1, enabled: false }) }),
    "disabled",
  );
});

test("auxiliary Core dispatch remains separate from pending assistant and never invents completion", () => {
  const records: any[] = [];
  const observer = createRequestObserver(identity, undefined, (r) => records.push(r));
  const local = observer.beginInvocation({ provider: "p", id: "m" });
  observer.dispatch({ ...event("aux-i", "aux-l"), purpose: "compaction" });
  observer.dispatch(event("i", "l"));
  assert.ok(local);
  observer.streamResult(local, { role: "assistant", stopReason: "stop", usage: { output: 1 } } as any);
  observer.close(false);
  const closed = records.filter((r) => r.phase === "closed");
  assert.deepEqual(
    closed.map((r) => r.sdkInvocationId),
    ["i", "aux-i"],
  );
  assert.equal(closed[1].timing.completionBoundary, "observer_close");
  assert.equal(closed[1].outcome, "unknown");
  assert.equal(closed[1].reasoning, undefined);
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunPersistence } from "../src/run-persistence.js";
import { runWorkflow } from "../src/workflow.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

test("cold hydration tolerates absent additive v1 fields without backfilling historical local SDK IDs", async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-producer-legacy-"));
  try {
    await withFakeHomeAsync(root, async () => {
      const result = await runWorkflow(
        `export const meta = {name: 'legacy', description: 'fixture'}; return await agent('fixture');`,
        {
          cwd: root,
          persistLogs: false,
          agent: {
            async run(_prompt: string, options: any) {
              const observer = createRequestObserver(
                { ...options.requestIdentity, sessionId: "legacy-session" },
                undefined,
                (record) => {
                  const legacy = structuredClone(record) as any;
                  delete legacy.reasoning;
                  delete legacy.observerInvocationId;
                  delete legacy.coreDispatch;
                  delete legacy.transportLink.capabilityVersion;
                  delete legacy.transportLink.wireAttemptId;
                  legacy.sdkInvocationId = "historical-local-id";
                  options.onRequestObservation(legacy);
                },
              );
              observer.beginInvocation({ provider: "p", id: "m" });
              observer.close(false);
              return "fixture";
            },
          },
        },
      );
      const loaded = createRunPersistence(root).load(result.runId);
      assert.ok(loaded);
      const records = Object.values(loaded.requestObservations ?? {}) as any[];
      assert.equal(records.length, 2);
      assert.ok(
        records.every(
          (r) =>
            r.sdkInvocationId === "historical-local-id" &&
            r.logicalRequestId === null &&
            r.coreDispatch === undefined &&
            r.reasoning === undefined,
        ),
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
