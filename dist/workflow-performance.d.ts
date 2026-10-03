declare const METRICS: readonly ["cacheHit", "cacheMiss", "missAbsent", "missGeneration", "missSequence", "missIdentity", "missBytes", "missHash", "missStamp", "cacheOversize", "cacheEviction", "readBytes", "replayEntries", "hashCalls", "hashBytes", "hashMs", "cloneCalls", "cloneMs", "cellsCalls", "cellsMs", "read", "detail", "lazy", "save", "observation", "flushSkipped", "loopLagMs", "cpuMicros"];
export type PerformanceMetric = (typeof METRICS)[number];
export interface WorkflowPerformance {
    readonly active: boolean;
    add(metric: PerformanceMetric, amount?: number): void;
    now(): number;
    flush(): Promise<void>;
    close(): Promise<void>;
}
/** Absolute owner-only directory, fixed two-file retention, one in-flight write.
 * Call explicitly; the disabled path never constructs a recorder or a timer. */
export declare function createWorkflowPerformance(directory: string, io?: Pick<typeof import("node:fs/promises"), "mkdir" | "lstat" | "open" | "rename" | "unlink">): Promise<WorkflowPerformance | undefined>;
/** Environment opt-in is read once at the first store creation. No disabled IO. */
export declare function workflowPerformance(): WorkflowPerformance | undefined;
/** Session replacement/reload must not carry capture into another session. */
export declare function stopWorkflowPerformance(): Promise<void> | undefined;
export {};
