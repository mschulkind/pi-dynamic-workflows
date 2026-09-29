import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installMixedFleet, mixedFleetAccepted } from "../src/mixed-fleet.js";
import type { WorkflowManager } from "../src/workflow-manager.js";

const SLOT = Symbol.for("pi.mixed-work.fleet.v1");

test("publishes bounded active workflow summaries and releases them on session switch", async () => {
  const emitter = new EventEmitter();
  let runs = [
    {
      runId: "run-a",
      workflowName: "Audit",
      status: "running",
      currentPhase: "Scan",
      agents: [{ status: "done" }, { status: "running" }],
      startedAt: "2026-09-29T00:00:00Z",
    },
  ];
  const manager = {
    listRuns: () => runs,
    getSnapshot: () => null,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  } as unknown as WorkflowManager;
  const opened: string[] = [];
  const dispose = installMixedFleet(manager, "session-a", async (id) => {
    opened.push(id);
  });
  try {
    const entry = (globalThis as Record<symbol, any>)[SLOT];
    assert.deepEqual(entry.rows, [
      {
        id: "run-a",
        name: "Audit",
        status: "running",
        phase: "Scan",
        done: 1,
        total: 2,
        startedAt: Date.parse("2026-09-29T00:00:00Z"),
      },
    ]);
    assert.equal(mixedFleetAccepted("session-a"), false);
    entry.accepted = true;
    assert.equal(mixedFleetAccepted("session-a"), true);
    assert.equal(mixedFleetAccepted("another-session"), false);
    await entry.open("run-a");
    assert.deepEqual(opened, ["run-a"]);
    runs = runs.map((run) => ({ ...run, status: "paused" }));
    emitter.emit("paused", { runId: "run-a" });
    assert.equal(entry.rows[0].status, "paused");
    const [first] = runs;
    assert.ok(first);
    Object.assign(first, { status: "completed", pendingDelivery: { id: "delivery-1" } });
    emitter.emit("complete", { runId: "run-a" });
    assert.equal(entry.rows[0].status, "pending");
    runs = [];
    emitter.emit("stopped", { runId: "run-a" });
    assert.deepEqual(entry.rows, []);
  } finally {
    dispose();
  }
  assert.equal((globalThis as Record<symbol, unknown>)[SLOT], undefined);
});
