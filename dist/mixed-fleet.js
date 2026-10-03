import { runSummary } from "./run-record-store.js?workflowBuild=sha256:2d8e7cb7c269cf9a1336216b3646528b36ffc8595d2e268c10a1117614f035c7";
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
];
function currentEntry() {
    const entry = globalThis[SLOT];
    if (!entry || typeof entry !== "object")
        return undefined;
    const value = entry;
    return value.version === VERSION ? value : undefined;
}
export function mixedFleetAccepted(sessionId) {
    return Boolean(sessionId && currentEntry()?.sessionId === sessionId && currentEntry()?.accepted);
}
export function installMixedFleet(manager, sessionId, open) {
    if (!sessionId)
        return () => { };
    const slot = globalThis;
    const entry = { version: VERSION, sessionId, rows: [], accepted: false, open };
    slot[SLOT] = entry;
    const update = () => {
        if (slot[SLOT] !== entry)
            return;
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
                status: run.pendingDelivery && run.status !== "running" && run.status !== "paused"
                    ? "pending"
                    : run.status,
                phase: live?.currentPhase ?? run.currentPhase ?? "",
                done: agents ? agents.filter((agent) => agent.status === "done").length : summary.done,
                total: agents?.length ?? summary.total,
                startedAt: Date.parse(run.startedAt) || 0,
            };
        });
    };
    for (const event of EVENTS)
        manager.on(event, update);
    update();
    return () => {
        for (const event of EVENTS)
            manager.off(event, update);
        if (slot[SLOT] === entry)
            delete slot[SLOT];
    };
}
