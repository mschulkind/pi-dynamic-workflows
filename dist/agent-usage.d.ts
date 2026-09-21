/** Token and cost usage for one subagent attempt or logical agent call. */
export interface AgentUsage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    cost: number;
    /**
     * True when these figures come from a character-count heuristic because the
     * provider reported no usage — NOT a measurement. Propagates through
     * sumAgentUsage into run totals so persistence and display never present an
     * estimate as metered fact (#209). Rendering uses a "~" prefix.
     */
    estimated?: boolean;
}
/** Create an independent zero-valued agent usage record. */
export declare function createEmptyAgentUsage(): AgentUsage;
/** Add agent usage records without mutating either input. */
export declare function sumAgentUsage(...records: AgentUsage[]): AgentUsage;
/** Cumulative display usage plus the exact attempt delta when usage becomes committed. */
interface AgentCallUsageUpdate {
    tokenUsage: AgentUsage;
    committedUsage?: AgentUsage;
}
/** Settled cumulative usage for one logical agent call, including retries. */
interface AgentUsageCommit {
    tokens: number;
    tokenUsage?: AgentUsage;
}
/**
 * Track provisional and committed usage for one logical agent call across retries.
 * Starting a new attempt closes older attempts so their late callbacks are ignored.
 */
export declare function createAgentCallUsageTracker(onUpdate: (update: AgentCallUsageUpdate) => void): {
    startAttempt(): {
        reportProgress(usage: AgentUsage): void;
        reportTerminal(usage: AgentUsage): void;
        commitWithFallback(fallbackTotal: () => number): AgentUsageCommit;
        commitTerminalUsage(): AgentUsageCommit;
    };
};
/** Return whether two complete agent usage records contain the same values. */
export declare function agentUsageEquals(left: AgentUsage, right: AgentUsage): boolean;
/**
 * Pi's Usage shape, spelled structurally rather than imported.
 *
 * `@earendil-works/pi-ai` is not a dependency of this package, and only these
 * fields are read, so a structural type keeps the dependency list honest. Pi
 * requires `totalTokens` and a nested `cost` object.
 */
export interface PiUsage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
    };
}
/**
 * The loosest shape `toPiUsage` accepts.
 *
 * Deliberately not `AgentUsage`: the same figures arrive in two forms, and one of
 * them is looser than the other. `AgentUsage` (agent-usage.ts) always carries all
 * six fields, while a snapshot's `tokenUsage` (display.ts WorkflowSnapshot)
 * marks cacheRead/cacheWrite `estimated` and optional. Both are mapped here, so
 * the parameter is the union of what they can be rather than the stricter one.
 */
export interface UsageLike {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
    cost?: number;
}
/**
 * Map accumulated usage to Pi's Usage, or undefined when there is nothing to
 * report.
 *
 * The four cost sub-rates are zeroed and only the aggregate `total` is carried,
 * because that is all the provider reports: this mirrors what `pi-subagents`
 * returns from its own tool results (`toAgentToolUsage`), so a workflow's spend
 * is shaped exactly like a subagent's and lands in the same footer bucket.
 *
 * Returns undefined for a zero-spend run so callers can omit the field entirely
 * rather than record a meaningless zero entry.
 */
export declare function toPiUsage(usage: UsageLike | undefined): PiUsage | undefined;
export {};
