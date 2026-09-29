import { runSummary } from "./run-record-store.js";
import type { WorkflowManager } from "./workflow-manager.js";

// Process-local optional integration with pi-subagents. Both packages are
// installed independently, so neither can require the other's module path.
const SLOT = Symbol.for("pi.mixed-work.fleet.v1");
const VERSION = 1;
const EVENTS = [
  "started",
  "resumed",
  "paused",
  "phase",
  "agentStart",
  "agentEnd",
  "complete",
  "error",
  "stopped",
] as const;

export interface MixedWorkflowRow {
  id: string;
  name: string;
  status: "running" | "paused" | "pending";
  phase: string;
  done: number;
  total: number;
  startedAt: number;
}

interface MixedFleetEntry {
  version: number;
  sessionId: string;
  rows: MixedWorkflowRow[];
  accepted: boolean;
  open: (id: string) => Promise<void>;
}

function currentEntry(): MixedFleetEntry | undefined {
  const entry = (globalThis as Record<symbol, unknown>)[SLOT];
  if (!entry || typeof entry !== "object") return undefined;
  const value = entry as MixedFleetEntry;
  return value.version === VERSION ? value : undefined;
}

export function mixedFleetAccepted(sessionId: string | undefined): boolean {
  return Boolean(sessionId && currentEntry()?.sessionId === sessionId && currentEntry()?.accepted);
}

export function installMixedFleet(
  manager: WorkflowManager,
  sessionId: string | undefined,
  open: (id: string) => Promise<void>,
): () => void {
  if (!sessionId) return () => {};
  const slot = globalThis as Record<symbol, unknown>;
  const entry: MixedFleetEntry = { version: VERSION, sessionId, rows: [], accepted: false, open };
  slot[SLOT] = entry;
  const update = () => {
    if (slot[SLOT] !== entry) return;
    entry.rows = manager
      .listRuns()
      .filter((run) => run.status === "running" || run.status === "paused" || run.pendingDelivery)
      .map((run) => {
        const live = manager.getSnapshot(run.runId);
        const summary = runSummary(run);
        const agents = live?.agents;
        return {
          id: run.runId,
          name: run.workflowName,
          status:
            run.pendingDelivery && run.status !== "running" && run.status !== "paused"
              ? "pending"
              : (run.status as "running" | "paused"),
          phase: live?.currentPhase ?? run.currentPhase ?? "",
          done: agents ? agents.filter((agent) => agent.status === "done").length : summary.done,
          total: agents?.length ?? summary.total,
          startedAt: Date.parse(run.startedAt) || 0,
        };
      });
  };
  for (const event of EVENTS) manager.on(event, update);
  update();
  return () => {
    for (const event of EVENTS) manager.off(event, update);
    if (slot[SLOT] === entry) delete slot[SLOT];
  };
}
