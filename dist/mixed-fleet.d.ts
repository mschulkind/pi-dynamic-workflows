import type { WorkflowManager } from "./workflow-manager.js";
export interface MixedWorkflowRow {
    id: string;
    name: string;
    status: "running" | "paused" | "pending";
    phase: string;
    done: number;
    total: number;
    startedAt: number;
}
export declare function mixedFleetAccepted(sessionId: string | undefined): boolean;
export declare function installMixedFleet(manager: WorkflowManager, sessionId: string | undefined, open: (id: string) => Promise<void>): () => void;
