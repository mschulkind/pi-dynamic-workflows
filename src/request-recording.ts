/** Metadata-only public SDK invocation/message observations; never transport timings. */
import { randomUUID } from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import * as CoreSDK from "@earendil-works/pi-coding-agent";

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
  granularity: "sdk_stream_invocation" | "sdk_assistant_message" | "core_provider_dispatch";
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
  logicalRequestId: string | null;
  /** Additive v1 fields: absent in historical journals. */
  observerInvocationId?: string | null;
  reasoning?: ReasoningObservation;
  coreDispatch?: {
    boundary: "provider_dispatch";
    observedOffsetMs: number;
    operationId: string | null;
    purpose: string;
    orchestrationRetry: number | null;
    api: string | null;
    provider: string | null;
    model: string | null;
    transportCoverage: "supported" | "unsupported";
  };
  outcome: "success" | "error" | "aborted" | "unknown";
  stopReason: string | null;
  usage: Record<(typeof counts)[number], Count>;
  safeProviderCounts: Record<string, never>;
  rawCoverage: "unavailable";
  timing: {
    processClockId: string;
    startedAtUtc: string;
    startedAtMonotonicMs: number;
    startBoundary: "sdk_stream_invocation" | "sdk_message_start" | "provider_dispatch";
    firstContentOffsetMs: number | null;
    firstReasoningOffsetMs: number | null;
    firstVisibleAnswerOffsetMs: number | null;
    lastContentOffsetMs: number | null;
    completedOffsetMs: number | null;
    observationClosedOffsetMs: number | null;
    completionBoundary: "sdk_message_end" | "sdk_stream_result" | "observer_close" | null;
  };
  transportLink: {
    granularity: "session_time_window" | "core_logical_request";
    sessionId: string;
    activation: CoreRecordingActivation;
    capabilityVersion?: 1 | null;
    wireAttemptId?: null;
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
  evidenceReference: { rootRunId: string; callId: string; stableWorkId: string };
}
export type WorkflowRequestEvidence = RequestObservation | RequestReplay;
export type RequestSink = (record: WorkflowRequestEvidence) => unknown;
export type CoreRecordingActivation = "enabled" | "disabled" | "unsupported" | "not_observed";
export interface ReasoningObservation {
  requestedModelSuffix: string | null;
  requestedExplicit: string | null;
  selected: string | null;
  selectionSource: "model_suffix" | "explicit_thinking" | "session_options" | "session_default" | "unknown";
  resolvedSession: string | null;
  clamped: boolean | null;
  sdkInvocation: string | null;
}
export function reasoningLevel(value: unknown): string | null {
  return typeof value === "string" && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
    ? value
    : null;
}
export interface CoreDispatch {
  schemaVersion: 1;
  boundary: "provider_dispatch";
  sdkInvocationId: string;
  logicalRequestId: string;
  sessionId: string | null;
  operationId: string | null;
  purpose: string;
  orchestrationRetry: number | null;
  api: string | null;
  provider?: string | null;
  model?: string | null;
  transportCoverage: "supported" | "unsupported";
}
/** Namespace lookup lets old public SDK exports load without the new symbol. */
export function subscribeCoreProducer(
  runtime: unknown,
  observer: ReturnType<typeof createRequestObserver>,
): () => void {
  try {
    const helper = (
      CoreSDK as unknown as {
        getProducerObservationCapability?: (
          runtime: unknown,
        ) => { version: number; subscribe(callback: (event: CoreDispatch) => void): () => void } | null;
      }
    ).getProducerObservationCapability;
    const capability = typeof helper === "function" ? helper(runtime) : null;
    if (capability?.version !== 1) return () => {};
    const unsubscribe = capability.subscribe((event) => observer.dispatch(event));
    observer.capabilityReady();
    return () => {
      try {
        unsubscribe();
      } catch {
        observer.callbackFailure();
      }
    };
  } catch {
    observer.callbackFailure();
    return () => {};
  }
}
/** Feature-detect only a public runtime health method, never enable a recorder. */
export function coreRecordingActivation(runtime: unknown): CoreRecordingActivation {
  try {
    const candidate = runtime as
      | {
          getTransportRecordingStatus?: () => { capabilityVersion: number; enabled: boolean };
          getPerformanceRecordingHealth?: () => unknown;
        }
      | undefined;
    if (typeof candidate?.getTransportRecordingStatus === "function") {
      const status = candidate.getTransportRecordingStatus();
      if (status?.capabilityVersion === 1 && typeof status.enabled === "boolean")
        return status.enabled ? "enabled" : "disabled";
      return "unsupported";
    }
    if (typeof candidate?.getPerformanceRecordingHealth !== "function") return "unsupported";
    return candidate.getPerformanceRecordingHealth() ? "enabled" : "disabled";
  } catch {
    return "not_observed";
  }
}
/** Closed vocabulary only; these diagnostics are local logs, never request payloads. */
const recordingHealthReasons = [
  "enabled",
  "disabled",
  "missing_append_sink",
  "invocation_observer_ready",
  "message_observer_fallback",
  "observer_initialization_failed",
  "observer_callback_failed",
  "append_failed",
] as const;
export type RecordingHealthReason = (typeof recordingHealthReasons)[number];
export type RecordingHealthReporter = (reason: RecordingHealthReason) => void;
export function reportRecordingHealth(
  report: RecordingHealthReporter | undefined,
  reason: RecordingHealthReason,
): void {
  try {
    report?.(reason);
  } catch {
    /* diagnostics cannot fail execution */
  }
}
/** One bounded message per reason per run, through the existing local log callback. */
export function createRecordingHealthReporter(log: ((message: string) => void) | undefined): RecordingHealthReporter {
  const seen = new Set<RecordingHealthReason>();
  return (reason) => {
    if (!recordingHealthReasons.includes(reason) || seen.has(reason)) return;
    seen.add(reason);
    try {
      log?.(`request recording: ${reason}`);
    } catch {
      /* storage/logging may itself fail */
    }
  };
}
/** A sink can be asynchronous; neither rejection nor a synchronous failure affects execution. */
export function emitRequestObservation(
  sink: RequestSink | undefined,
  record: WorkflowRequestEvidence,
  health?: RecordingHealthReporter,
): void {
  try {
    if (!sink) {
      reportRecordingHealth(health, "missing_append_sink");
      return;
    }
    void Promise.resolve(sink(structuredClone(record))).then(
      (accepted) => {
        if (accepted === false) reportRecordingHealth(health, "append_failed");
      },
      () => reportRecordingHealth(health, "append_failed"),
    );
  } catch {
    reportRecordingHealth(health, "append_failed");
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
  health?: RecordingHealthReporter,
  reasoning?: Omit<ReasoningObservation, "sdkInvocation">,
) {
  let capabilityVersion: 1 | null = null;
  let active: RequestObservation | undefined;
  let invocation: { id: string; utc: string; monotonicMs: number; model: { provider: string; id: string } } | undefined;
  const auxiliary: RequestObservation[] = [];
  let invocationReasoning: string | null = null;
  let lastId: string | null = null;
  let retryOf: string | null = null;
  const elapsed = () => Math.max(0, performance.now() - (active?.timing.startedAtMonotonicMs ?? performance.now()));
  const closeActive = (aborted: boolean) => {
    if (!active) return;
    active.phase = "closed";
    active.recordId = randomUUID();
    active.timing.observationClosedOffsetMs = elapsed();
    active.timing.completionBoundary ??= "observer_close";
    if (aborted && active.outcome === "unknown") active.outcome = "aborted";
    emitRequestObservation(sink, active, health);
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
  const start = (emit = true) => {
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
      sdkInvocationId: null,
      observerInvocationId: invocation?.id ?? null,
      reasoning: {
        requestedModelSuffix: reasoningLevel(reasoning?.requestedModelSuffix),
        requestedExplicit: reasoningLevel(reasoning?.requestedExplicit),
        selected: reasoningLevel(reasoning?.selected),
        selectionSource: [
          "model_suffix",
          "explicit_thinking",
          "session_options",
          "session_default",
          "unknown",
        ].includes(reasoning?.selectionSource ?? "")
          ? (reasoning?.selectionSource ?? "unknown")
          : "unknown",
        resolvedSession: reasoningLevel(reasoning?.resolvedSession),
        clamped: typeof reasoning?.clamped === "boolean" ? reasoning.clamped : null,
        sdkInvocation: invocationReasoning,
      },
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
      transportLink: {
        granularity: "session_time_window",
        sessionId: identity.sessionId,
        activation,
        capabilityVersion,
        wireAttemptId: null,
      },
      coverage: {
        hiddenTransportAttempts: "unavailable",
        compactionRequests: "unavailable",
        usageZeroProvenance: "unavailable",
      },
    };
    retryOf = null;
    if (emit) emitRequestObservation(sink, active, health);
    return active;
  };
  return {
    close(aborted: boolean) {
      closeActive(aborted);
      for (const record of auxiliary.splice(0)) {
        record.phase = "closed";
        record.recordId = randomUUID();
        record.timing.observationClosedOffsetMs = Math.max(0, performance.now() - record.timing.startedAtMonotonicMs);
        record.timing.completionBoundary = "observer_close";
        emitRequestObservation(sink, record, health);
      }
    },
    capabilityReady() {
      capabilityVersion = 1;
    },
    dispatch(event: CoreDispatch) {
      try {
        if (
          event.schemaVersion !== 1 ||
          event.boundary !== "provider_dispatch" ||
          event.sessionId !== identity.sessionId
        )
          return;
        const isAuxiliary = !["assistant", "unknown"].includes(event.purpose);
        // An owning-session dispatch is authoritative, not a time-window guess.
        // Auxiliary dispatches must never overwrite a pending assistant invocation.
        const id = (value: unknown) =>
          typeof value === "string" &&
          value.length > 0 &&
          value.length <= 256 &&
          /^[a-zA-Z0-9_./:-]+$/.test(value) &&
          !value.includes("//")
            ? value
            : null;
        const logical = id(event.logicalRequestId);
        const sdk = id(event.sdkInvocationId);
        if (!logical || !sdk) return;
        if (!isAuxiliary && active?.coreDispatch) closeActive(false);
        const purpose = [
          "assistant",
          "compaction",
          "branch_summary",
          "bug_report_summary",
          "cache_warm",
          "auxiliary",
          "unknown",
        ].includes(event.purpose)
          ? event.purpose
          : "unknown";
        const previous = active;
        if (isAuxiliary) active = undefined;
        if (!active) {
          // Build without emitting a provisional start; this boundary already has final IDs.
          active = start(false);
          active.granularity = "core_provider_dispatch";
          active.timing.startBoundary = "provider_dispatch";
          active.timing.startedAtUtc = new Date().toISOString();
          active.timing.startedAtMonotonicMs = performance.now();
          if (isAuxiliary) {
            active.observerInvocationId = null;
            active.requestedProvider = null;
            active.requestedModel = null;
            active.reasoning = undefined;
          }
        }
        if (!active) return;
        active.logicalRequestId = logical;
        active.sdkInvocationId = sdk;
        active.coreDispatch = {
          boundary: "provider_dispatch",
          observedOffsetMs: elapsed(),
          operationId: id(event.operationId),
          purpose,
          orchestrationRetry:
            typeof event.orchestrationRetry === "number" &&
            Number.isSafeInteger(event.orchestrationRetry) &&
            event.orchestrationRetry >= 0
              ? event.orchestrationRetry
              : null,
          api: modelName(event.api),
          provider: modelName(event.provider),
          model: modelName(event.model),
          transportCoverage: event.transportCoverage === "supported" ? "supported" : "unsupported",
        };
        active.transportLink = {
          granularity: "core_logical_request",
          sessionId: identity.sessionId,
          activation,
          capabilityVersion: 1,
          wireAttemptId: null,
        };
        if (isAuxiliary || !previous) emitRequestObservation(sink, active, health);
        if (isAuxiliary) {
          auxiliary.push(active);
          active = previous;
          if (auxiliary.length > 64) {
            const record = auxiliary.shift();
            if (!record) return;
            record.phase = "closed";
            record.recordId = randomUUID();
            record.timing.completionBoundary = "observer_close";
            record.timing.observationClosedOffsetMs = Math.max(
              0,
              performance.now() - record.timing.startedAtMonotonicMs,
            );
            emitRequestObservation(sink, record, health);
          }
        }
      } catch {
        reportRecordingHealth(health, "observer_callback_failed");
      }
    },
    callbackFailure() {
      reportRecordingHealth(health, "observer_callback_failed");
    },
    hookReady() {
      reportRecordingHealth(health, "invocation_observer_ready");
    },
    hookFallback() {
      reportRecordingHealth(health, "message_observer_fallback");
    },
    beginInvocation(requestedModel: { provider: string; id: string }, options?: { reasoning?: unknown }) {
      try {
        closeActive(false);
        invocationReasoning = reasoningLevel(options?.reasoning);
        invocation = {
          id: randomUUID(),
          utc: new Date().toISOString(),
          monotonicMs: performance.now(),
          model: requestedModel,
        };
        start();
        return invocation.id;
      } catch {
        reportRecordingHealth(health, "observer_callback_failed");
        return undefined;
      }
    },
    streamResult(id: string, message: AssistantMessage) {
      try {
        if (active?.observerInvocationId === id) completed(message, "sdk_stream_result");
      } catch {
        reportRecordingHealth(health, "observer_callback_failed");
      }
    },
    streamFailure(id: string) {
      try {
        if (active?.observerInvocationId === id) active.outcome = "error";
      } catch {
        reportRecordingHealth(health, "observer_callback_failed");
      }
    },
    event(event: AgentSessionEvent) {
      try {
        if (event.type === "auto_retry_start") {
          retryOf = lastId;
          return;
        }
        if (event.type === "message_start" && event.message.role === "assistant") {
          if (!active || (!invocation && !active.coreDispatch)) {
            closeActive(false);
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
          closeActive(false);
        }
      } catch {
        reportRecordingHealth(health, "observer_callback_failed");
      }
    },
  };
}

/** Wrap the documented public stream function without changing arguments,
 * return identity, callbacks, retry options, or consuming its iterator. result()
 * is the public final-result promise, independent of the SDK's stream consumer.
 */
function wrapRequestInvocations(
  agent: Pick<AgentSession["agent"], "streamFunction">,
  observer: ReturnType<typeof createRequestObserver>,
): () => void {
  const original = agent.streamFunction;
  if (typeof original !== "function") throw new Error("Public invocation hook unavailable");
  const wrapped: typeof original = function (this: unknown, ...args) {
    const id = observer.beginInvocation(args[0], args[2]);
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
                observer.callbackFailure();
              }
            },
            () => observer.streamFailure(id),
          )
          .catch(() => observer.callbackFailure());
      }
      return stream;
    } catch (error) {
      if (id) observer.streamFailure(id);
      throw error;
    }
  };
  agent.streamFunction = wrapped;
  return () => {
    try {
      if (agent.streamFunction === wrapped) agent.streamFunction = original;
    } catch {
      observer.callbackFailure();
    }
  };
}

/** Unsupported public hooks retain the existing assistant-message fallback. */
export function observeRequestInvocations(
  agent: Pick<AgentSession["agent"], "streamFunction">,
  observer: ReturnType<typeof createRequestObserver>,
): () => void {
  try {
    const restore = wrapRequestInvocations(agent, observer);
    observer.hookReady();
    return restore;
  } catch {
    observer.hookFallback();
    return () => {};
  }
}

/** Initialization is observational too; a rejected public hook cannot fail a child. */
export function initializeRequestObserver(
  create: () => ReturnType<typeof createRequestObserver>,
  health?: RecordingHealthReporter,
): ReturnType<typeof createRequestObserver> | undefined {
  try {
    return create();
  } catch {
    reportRecordingHealth(health, "observer_initialization_failed");
    return undefined;
  }
}
