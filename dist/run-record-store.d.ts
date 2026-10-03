import { aggregateAgentUsage } from "./display.js";
import { type PersistenceFsLayer } from "./fs-persistence.js";
import type { WorkflowRequestEvidence } from "./request-recording.js";
import type { PersistedRunState } from "./run-persistence.js";
interface RunSummary {
    total: number;
    done: number;
    active: number;
    running: number;
    queued: number;
    error: number;
    skipped: number;
    activeLabels: string[];
    checkpoint: Pick<NonNullable<PersistedRunState["checkpoint"]>, "checkpointId" | "kind" | "status"> | null;
    usage: ReturnType<typeof aggregateAgentUsage>;
}
export type RunDisplayDetail = Pick<PersistedRunState, "runId" | "workflowName" | "status" | "agents" | "journal" | "phases" | "logs" | "currentPhase" | "tokenUsage">;
/** Stable private revision identity; caller-visible fields are never cache keys. */
export declare function runPreviewIdentity(state: PersistedRunState): object;
/** One operation-local replay, even when the record exceeds the storage cache cap. */
export declare function runDetail(state: PersistedRunState): RunDisplayDetail;
/** Stat-only invalidation for an already verified selected snapshot. Never replay evidence. */
export declare function runDetailIsCurrent(state: PersistedRunState): boolean;
export declare function copyRunPreview(state: PersistedRunState): PersistedRunState;
export declare function runSummary(state: PersistedRunState): RunSummary;
interface Head {
    format: "pi-workflow-run-v2";
    generation: string;
    bytes: number;
    sequence: number;
    hash: string;
    keys: string[];
    index: Record<string, unknown>;
    summary: RunSummary;
    pendingDelivery?: {
        kind: "complete" | "text";
        deliveryId?: string;
    };
}
export declare function createRunRecordStore(fs: PersistenceFsLayer): {
    read: (path: string) => PersistedRunState | null;
    peek: (path: string) => PersistedRunState | null;
    preview: (path: string, record: PersistedRunState | Head) => PersistedRunState;
    save: (path: string, state: PersistedRunState) => void;
    updateMetadata: (path: string, patch: Partial<Pick<PersistedRunState, "sessionId" | "pendingDelivery" | "autoResumeAttempts">>, expectedDeliveryId?: string) => boolean;
    appendObservation: (path: string, observation: WorkflowRequestEvidence) => boolean;
    recoverInterrupted: (path: string) => boolean;
    forget: (path: string) => boolean;
    logPath: (path: string) => string;
};
export {};
