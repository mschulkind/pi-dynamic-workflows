/** Metadata-only public SDK invocation/message observations; never transport timings. */
import { randomUUID } from "node:crypto";
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
const processClockId = randomUUID();
const counts = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens"] as const;
type Count = { value: number | null; status: "unknown" | "sdk_normalized" };
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
  transportLink: { granularity: "session_time_window"; sessionId: string; activation: CoreRecordingActivation };
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
  evidenceReference: { rootRunId: string; callId: string; stableWorkId: string };
}
export type WorkflowRequestEvidence = RequestObservation | RequestReplay;
export type RequestSink = (record: WorkflowRequestEvidence) => unknown;
export type CoreRecordingActivation = "enabled" | "disabled" | "unsupported" | "not_observed";
/** Feature-detect only a public runtime health method, never enable a recorder. */
export function coreRecordingActivation(runtime: unknown): CoreRecordingActivation {
  try {
    const candidate = runtime as { getPerformanceRecordingHealth?: () => unknown } | undefined;
    if (typeof candidate?.getPerformanceRecordingHealth !== "function") return "unsupported";
    return candidate.getPerformanceRecordingHealth() ? "enabled" : "disabled";
  } catch {
    return "not_observed";
  }
}
/** A sink can be asynchronous; neither rejection nor a synchronous failure affects execution. */
export function emitRequestObservation(sink: RequestSink | undefined, record: WorkflowRequestEvidence): void {
  try {
    void Promise.resolve(sink?.(structuredClone(record))).catch(() => {});
  } catch {
    /* diagnostic only */
  }
}
function modelName(value: unknown): string | null {
  return typeof value === "string" && value.length <= 200 && /^[a-zA-Z0-9._:/-]+$/.test(value) && !value.includes("://")
    ? value
    : null;
}
export function createRequestObserver(
  identity: RequestIdentity,
  model: { provider: string; id: string } | undefined,
  sink: RequestSink,
  activation: CoreRecordingActivation = "not_observed",
) {
  let active: RequestObservation | undefined;
  let invocation: { id: string; utc: string; monotonicMs: number; model: { provider: string; id: string } } | undefined;
  let lastId: string | null = null;
  let retryOf: string | null = null;
  const elapsed = () => Math.max(0, performance.now() - (active?.timing.startedAtMonotonicMs ?? performance.now()));
  const close = (aborted: boolean) => {
    if (!active) return;
    active.phase = "closed";
    active.recordId = randomUUID();
    active.timing.observationClosedOffsetMs = elapsed();
    active.timing.completionBoundary ??= "observer_close";
    if (aborted && active.outcome === "unknown") active.outcome = "aborted";
    emitRequestObservation(sink, active);
    lastId = active.observationId;
    active = undefined;
  };
  const completed = (message: AssistantMessage, boundary: "sdk_message_end" | "sdk_stream_result") => {
    if (!active) return;
    active.observedMessageModel = modelName(message.model);
    active.returnedModel = modelName(message.responseModel);
    const reason = message.stopReason;
    active.stopReason = ["stop", "length", "toolUse", "error", "aborted", "pending", "deferred"].includes(reason)
      ? reason
      : null;
    active.outcome =
      reason === "error"
        ? "error"
        : reason === "aborted"
          ? "aborted"
          : reason === "pending" || reason === "deferred" || active.stopReason === null
            ? "unknown"
            : "success";
    for (const key of counts) {
      const value = message.usage?.[key];
      // Required SDK counters default to zero without provider reports.
      // Optional counters retain SDK provenance, never confirmed provider zero.
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        (value > 0 || key === "reasoning" || key === "cacheWrite1h")
      )
        active.usage[key] = { value, status: "sdk_normalized" };
    }
    active.timing.completedOffsetMs = elapsed();
    active.timing.completionBoundary = boundary;
  };
  const start = () => {
    active = {
      rootRunId: identity.rootRunId,
      frameRunId: identity.frameRunId,
      executionId: identity.executionId,
      callId: identity.callId,
      stableWorkId: identity.stableWorkId,
      childAttemptId: identity.childAttemptId,
      childAttemptOrdinal: identity.childAttemptOrdinal,
      sessionId: identity.sessionId,
      schemaVersion: 1,
      recordKind: "workflow_request_observation",
      source: "pi-dynamic-workflows",
      accountingRole: "request_evidence",
      recordId: randomUUID(),
      observationId: randomUUID(),
      phase: "started",
      granularity: invocation ? "sdk_stream_invocation" : "sdk_assistant_message",
      sdkInvocationId: invocation?.id ?? null,
      assistantMessageStarts: 0,
      retryOfObservationId: retryOf,
      retryRelation: retryOf ? "observed" : "unknown",
      requestedProvider: modelName((invocation?.model ?? model)?.provider),
      requestedModel: modelName((invocation?.model ?? model)?.id),
      observedMessageModel: null,
      returnedModel: null,
      actualApiHostname: null,
      sessionEntryId: null,
      logicalRequestId: null,
      outcome: "unknown",
      stopReason: null,
      usage: Object.fromEntries(
        counts.map((key) => [key, { value: null, status: "unknown" }]),
      ) as RequestObservation["usage"],
      safeProviderCounts: {},
      rawCoverage: "unavailable",
      timing: {
        processClockId,
        startedAtUtc: invocation?.utc ?? new Date().toISOString(),
        startedAtMonotonicMs: invocation?.monotonicMs ?? performance.now(),
        startBoundary: invocation ? "sdk_stream_invocation" : "sdk_message_start",
        firstContentOffsetMs: null,
        firstReasoningOffsetMs: null,
        firstVisibleAnswerOffsetMs: null,
        lastContentOffsetMs: null,
        completedOffsetMs: null,
        observationClosedOffsetMs: null,
        completionBoundary: null,
      },
      transportLink: { granularity: "session_time_window", sessionId: identity.sessionId, activation },
      coverage: {
        hiddenTransportAttempts: "unavailable",
        compactionRequests: "unavailable",
        usageZeroProvenance: "unavailable",
      },
    };
    retryOf = null;
    emitRequestObservation(sink, active);
  };
  return {
    close,
    beginInvocation(requestedModel: { provider: string; id: string }) {
      try {
        close(false);
        invocation = {
          id: randomUUID(),
          utc: new Date().toISOString(),
          monotonicMs: performance.now(),
          model: requestedModel,
        };
        start();
        return invocation.id;
      } catch {
        return undefined;
      }
    },
    streamResult(id: string, message: AssistantMessage) {
      try {
        if (active?.sdkInvocationId === id) completed(message, "sdk_stream_result");
      } catch {
        /* diagnostic only */
      }
    },
    streamFailure(id: string) {
      try {
        if (active?.sdkInvocationId === id) active.outcome = "error";
      } catch {
        /* diagnostic only */
      }
    },
    event(event: AgentSessionEvent) {
      try {
        if (event.type === "auto_retry_start") {
          retryOf = lastId;
          return;
        }
        if (event.type === "message_start" && event.message.role === "assistant") {
          if (!active || !invocation) {
            close(false);
            start();
          }
          if (active) active.assistantMessageStarts++;
        } else if (event.type === "message_update" && active) {
          const update = event.assistantMessageEvent;
          if (
            (update.type === "text_delta" || update.type === "thinking_delta" || update.type === "toolcall_delta") &&
            update.delta.length > 0
          ) {
            const offset = elapsed();
            active.timing.firstContentOffsetMs ??= offset;
            active.timing.lastContentOffsetMs = offset;
            if (update.type === "text_delta") active.timing.firstVisibleAnswerOffsetMs ??= offset;
            if (update.type === "thinking_delta") active.timing.firstReasoningOffsetMs ??= offset;
          }
        } else if (event.type === "message_end" && event.message.role === "assistant" && active) {
          completed(event.message, "sdk_message_end");
          close(false);
        }
      } catch {
        /* observations must not break agents */
      }
    },
  };
}

/** Wrap the documented public stream function without changing arguments,
 * return identity, callbacks, retry options, or consuming its iterator. result()
 * is the public final-result promise, independent of the SDK's stream consumer.
 */
export function observeRequestInvocations(
  agent: Pick<AgentSession["agent"], "streamFunction">,
  observer: ReturnType<typeof createRequestObserver>,
): () => void {
  const original = agent.streamFunction;
  const wrapped: typeof original = function (this: unknown, ...args) {
    const id = observer.beginInvocation(args[0]);
    try {
      const stream = original.apply(this, args);
      if (id) {
        void Promise.resolve(stream)
          .then(
            (response) => {
              try {
                void response.result().then(
                  (message) => observer.streamResult(id, message),
                  () => observer.streamFailure(id),
                );
              } catch {
                /* observational failure does not fail the agent */
              }
            },
            () => observer.streamFailure(id),
          )
          .catch(() => {});
      }
      return stream;
    } catch (error) {
      if (id) observer.streamFailure(id);
      throw error;
    }
  };
  agent.streamFunction = wrapped;
  return () => {
    if (agent.streamFunction === wrapped) agent.streamFunction = original;
  };
}
