import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
export interface RequestIdentity {
    rootRunId: string;
    frameRunId: string;
    executionId: string;
    callId: string;
    stableWorkId: string;
    childAttemptId: string;
    childAttemptOrdinal: number;
    sessionId: string;
}
declare const counts: readonly ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens"];
type Count = {
    value: number | null;
    status: "unknown" | "sdk_normalized";
};
export interface RequestObservation extends RequestIdentity {
    schemaVersion: 1;
    recordKind: "workflow_request_observation";
    source: "pi-dynamic-workflows";
    accountingRole: "request_evidence";
    recordId: string;
    observationId: string;
    phase: "started" | "closed";
    granularity: "sdk_stream_invocation" | "sdk_assistant_message";
    sdkInvocationId: string | null;
    assistantMessageStarts: number;
    retryOfObservationId: string | null;
    retryRelation: "observed" | "unknown";
    requestedProvider: string | null;
    requestedModel: string | null;
    observedMessageModel: string | null;
    returnedModel: string | null;
    actualApiHostname: null;
    sessionEntryId: null;
    logicalRequestId: null;
    outcome: "success" | "error" | "aborted" | "unknown";
    stopReason: string | null;
    usage: Record<(typeof counts)[number], Count>;
    safeProviderCounts: Record<string, never>;
    rawCoverage: "unavailable";
    timing: {
        processClockId: string;
        startedAtUtc: string;
        startedAtMonotonicMs: number;
        startBoundary: "sdk_stream_invocation" | "sdk_message_start";
        firstContentOffsetMs: number | null;
        firstReasoningOffsetMs: number | null;
        firstVisibleAnswerOffsetMs: number | null;
        lastContentOffsetMs: number | null;
        completedOffsetMs: number | null;
        observationClosedOffsetMs: number | null;
        completionBoundary: "sdk_message_end" | "sdk_stream_result" | "observer_close" | null;
    };
    transportLink: {
        granularity: "session_time_window";
        sessionId: string;
        activation: CoreRecordingActivation;
    };
    coverage: {
        hiddenTransportAttempts: "unavailable";
        compactionRequests: "unavailable";
        usageZeroProvenance: "unavailable";
    };
}
export interface RequestReplay {
    schemaVersion: 1;
    recordKind: "workflow_request_replay";
    recordId: string;
    source: "pi-dynamic-workflows";
    accountingRole: "non_request_provenance";
    rootRunId: string;
    frameRunId: string;
    executionId: string;
    callId: string;
    stableWorkId: string;
    observedAtUtc: string;
    evidenceReference: {
        rootRunId: string;
        callId: string;
        stableWorkId: string;
    };
}
export type WorkflowRequestEvidence = RequestObservation | RequestReplay;
export type RequestSink = (record: WorkflowRequestEvidence) => unknown;
export type CoreRecordingActivation = "enabled" | "disabled" | "unsupported" | "not_observed";
/** Feature-detect only a public runtime health method, never enable a recorder. */
export declare function coreRecordingActivation(runtime: unknown): CoreRecordingActivation;
/** A sink can be asynchronous; neither rejection nor a synchronous failure affects execution. */
export declare function emitRequestObservation(sink: RequestSink | undefined, record: WorkflowRequestEvidence): void;
export declare function createRequestObserver(identity: RequestIdentity, model: {
    provider: string;
    id: string;
} | undefined, sink: RequestSink, activation?: CoreRecordingActivation): {
    close: (aborted: boolean) => void;
    beginInvocation(requestedModel: {
        provider: string;
        id: string;
    }): string | undefined;
    streamResult(id: string, message: AssistantMessage): void;
    streamFailure(id: string): void;
    event(event: AgentSessionEvent): void;
};
/** Wrap the documented public stream function without changing arguments,
 * return identity, callbacks, retry options, or consuming its iterator. result()
 * is the public final-result promise, independent of the SDK's stream consumer.
 */
export declare function observeRequestInvocations(agent: Pick<AgentSession["agent"], "streamFunction">, observer: ReturnType<typeof createRequestObserver>): () => void;
export {};
