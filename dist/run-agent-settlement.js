import { WorkflowErrorCode } from "./errors.js?workflowBuild=sha256:7c5c2bd87522520f9f78bbb7ba977e22d031b185f343733b5a59d5866b615328";
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
