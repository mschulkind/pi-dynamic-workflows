/** Metadata-only public SDK invocation/message observations; never transport timings. */
import { randomUUID } from "node:crypto";
const processClockId = randomUUID();
const counts = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens"];
/** Feature-detect only a public runtime health method, never enable a recorder. */
export function coreRecordingActivation(runtime) {
    try {
        const candidate = runtime;
        if (typeof candidate?.getPerformanceRecordingHealth !== "function")
            return "unsupported";
        return candidate.getPerformanceRecordingHealth() ? "enabled" : "disabled";
    }
    catch {
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
];
export function reportRecordingHealth(report, reason) {
    try {
        report?.(reason);
    }
    catch {
        /* diagnostics cannot fail execution */
    }
}
/** One bounded message per reason per run, through the existing local log callback. */
export function createRecordingHealthReporter(log) {
    const seen = new Set();
    return (reason) => {
        if (!recordingHealthReasons.includes(reason) || seen.has(reason))
            return;
        seen.add(reason);
        try {
            log?.(`request recording: ${reason}`);
        }
        catch {
            /* storage/logging may itself fail */
        }
    };
}
/** A sink can be asynchronous; neither rejection nor a synchronous failure affects execution. */
export function emitRequestObservation(sink, record, health) {
    try {
        if (!sink) {
            reportRecordingHealth(health, "missing_append_sink");
            return;
        }
        void Promise.resolve(sink(structuredClone(record))).then((accepted) => {
            if (accepted === false)
                reportRecordingHealth(health, "append_failed");
        }, () => reportRecordingHealth(health, "append_failed"));
    }
    catch {
        reportRecordingHealth(health, "append_failed");
    }
}
function modelName(value) {
    return typeof value === "string" && value.length <= 200 && /^[a-zA-Z0-9._:/-]+$/.test(value) && !value.includes("://")
        ? value
        : null;
}
export function createRequestObserver(identity, model, sink, activation = "not_observed", health) {
    let active;
    let invocation;
    let lastId = null;
    let retryOf = null;
    const elapsed = () => Math.max(0, performance.now() - (active?.timing.startedAtMonotonicMs ?? performance.now()));
    const close = (aborted) => {
        if (!active)
            return;
        active.phase = "closed";
        active.recordId = randomUUID();
        active.timing.observationClosedOffsetMs = elapsed();
        active.timing.completionBoundary ??= "observer_close";
        if (aborted && active.outcome === "unknown")
            active.outcome = "aborted";
        emitRequestObservation(sink, active, health);
        lastId = active.observationId;
        active = undefined;
    };
    const completed = (message, boundary) => {
        if (!active)
            return;
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
            if (typeof value === "number" &&
                Number.isFinite(value) &&
                value >= 0 &&
                (value > 0 || key === "reasoning" || key === "cacheWrite1h"))
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
            usage: Object.fromEntries(counts.map((key) => [key, { value: null, status: "unknown" }])),
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
        emitRequestObservation(sink, active, health);
    };
    return {
        close,
        callbackFailure() {
            reportRecordingHealth(health, "observer_callback_failed");
        },
        hookReady() {
            reportRecordingHealth(health, "invocation_observer_ready");
        },
        hookFallback() {
            reportRecordingHealth(health, "message_observer_fallback");
        },
        beginInvocation(requestedModel) {
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
            }
            catch {
                reportRecordingHealth(health, "observer_callback_failed");
                return undefined;
            }
        },
        streamResult(id, message) {
            try {
                if (active?.sdkInvocationId === id)
                    completed(message, "sdk_stream_result");
            }
            catch {
                reportRecordingHealth(health, "observer_callback_failed");
            }
        },
        streamFailure(id) {
            try {
                if (active?.sdkInvocationId === id)
                    active.outcome = "error";
            }
            catch {
                reportRecordingHealth(health, "observer_callback_failed");
            }
        },
        event(event) {
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
                    if (active)
                        active.assistantMessageStarts++;
                }
                else if (event.type === "message_update" && active) {
                    const update = event.assistantMessageEvent;
                    if ((update.type === "text_delta" || update.type === "thinking_delta" || update.type === "toolcall_delta") &&
                        update.delta.length > 0) {
                        const offset = elapsed();
                        active.timing.firstContentOffsetMs ??= offset;
                        active.timing.lastContentOffsetMs = offset;
                        if (update.type === "text_delta")
                            active.timing.firstVisibleAnswerOffsetMs ??= offset;
                        if (update.type === "thinking_delta")
                            active.timing.firstReasoningOffsetMs ??= offset;
                    }
                }
                else if (event.type === "message_end" && event.message.role === "assistant" && active) {
                    completed(event.message, "sdk_message_end");
                    close(false);
                }
            }
            catch {
                reportRecordingHealth(health, "observer_callback_failed");
            }
        },
    };
}
/** Wrap the documented public stream function without changing arguments,
 * return identity, callbacks, retry options, or consuming its iterator. result()
 * is the public final-result promise, independent of the SDK's stream consumer.
 */
function wrapRequestInvocations(agent, observer) {
    const original = agent.streamFunction;
    if (typeof original !== "function")
        throw new Error("Public invocation hook unavailable");
    const wrapped = function (...args) {
        const id = observer.beginInvocation(args[0]);
        try {
            const stream = original.apply(this, args);
            if (id) {
                void Promise.resolve(stream)
                    .then((response) => {
                    try {
                        void response.result().then((message) => observer.streamResult(id, message), () => observer.streamFailure(id));
                    }
                    catch {
                        observer.callbackFailure();
                    }
                }, () => observer.streamFailure(id))
                    .catch(() => observer.callbackFailure());
            }
            return stream;
        }
        catch (error) {
            if (id)
                observer.streamFailure(id);
            throw error;
        }
    };
    agent.streamFunction = wrapped;
    return () => {
        try {
            if (agent.streamFunction === wrapped)
                agent.streamFunction = original;
        }
        catch {
            observer.callbackFailure();
        }
    };
}
/** Unsupported public hooks retain the existing assistant-message fallback. */
export function observeRequestInvocations(agent, observer) {
    try {
        const restore = wrapRequestInvocations(agent, observer);
        observer.hookReady();
        return restore;
    }
    catch {
        observer.hookFallback();
        return () => { };
    }
}
/** Initialization is observational too; a rejected public hook cannot fail a child. */
export function initializeRequestObserver(create, health) {
    try {
        return create();
    }
    catch {
        reportRecordingHealth(health, "observer_initialization_failed");
        return undefined;
    }
}
