import { WorkflowErrorCode } from "./errors.js?workflowBuild=sha256:785b466482da41a3e1d95d152bf3b2530f07d8f19eaea92d47565b067057d9da";
export const INTERRUPTED_AGENT_CAUSE = { error: "interrupted", errorCode: WorkflowErrorCode.WORKFLOW_ABORTED };
export function agentHasNonTerminalStatus(status) {
    return status === "queued" || status === "running";
}
/** Display-only settlement; replay remains keyed by the committed journal. */
export function settleInterruptedPersistedAgents(agents, cause, endedAt) {
    return agents.map((agent) => !agentHasNonTerminalStatus(agent.status)
        ? agent
        : {
            ...agent,
            status: "skipped",
            error: cause.error,
            errorCode: cause.errorCode,
            recoverable: false,
            endedAt: agent.endedAt ?? endedAt,
        });
}
