/** Metadata-only public SDK invocation/message observations; never transport timings. */
import { randomUUID } from "node:crypto";
import * as CoreSDK from "@earendil-works/pi-coding-agent";
const processClockId = randomUUID();
const counts = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens"];
export function reasoningLevel(value) {
    return typeof value === "string" && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
        ? value
        : null;
}
/** Namespace lookup lets old public SDK exports load without the new symbol. */
export function subscribeCoreProducer(runtime, observer) {
    try {
        const helper = CoreSDK.getProducerObservationCapability;
        const capability = typeof helper === "function" ? helper(runtime) : null;
        if (capability?.version !== 1)
            return () => { };
        const unsubscribe = capability.subscribe((event) => observer.dispatch(event));
        observer.capabilityReady();
        return () => {
            try {
                unsubscribe();
            }
            catch {
                observer.callbackFailure();
            }
        };
    }
    catch {
        observer.callbackFailure();
        return () => { };
    }
}
/** Feature-detect only a public runtime health method, never enable a recorder. */
export function coreRecordingActivation(runtime) {
    try {
        const candidate = runtime;
        if (typeof candidate?.getTransportRecordingStatus === "function") {
            const status = candidate.getTransportRecordingStatus();
            if (status?.capabilityVersion === 1 && typeof status.enabled === "boolean")
                return status.enabled ? "enabled" : "disabled";
            return "unsupported";
        }
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
export function createRequestObserver(identity, model, sink, activation = "not_observed", health, reasoning) {
    let capabilityVersion = null;
    let active;
    let invocation;
    const auxiliary = [];
    let invocationReasoning = null;
    let lastId = null;
    let retryOf = null;
    const elapsed = () => Math.max(0, performance.now() - (active?.timing.startedAtMonotonicMs ?? performance.now()));
    const closeActive = (aborted) => {
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
        if (emit)
            emitRequestObservation(sink, active, health);
        return active;
    };
    return {
        close(aborted) {
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
        dispatch(event) {
            try {
                if (event.schemaVersion !== 1 ||
                    event.boundary !== "provider_dispatch" ||
                    event.sessionId !== identity.sessionId)
                    return;
                const isAuxiliary = !["assistant", "unknown"].includes(event.purpose);
                // An owning-session dispatch is authoritative, not a time-window guess.
                // Auxiliary dispatches must never overwrite a pending assistant invocation.
                const id = (value) => typeof value === "string" &&
                    value.length > 0 &&
                    value.length <= 256 &&
                    /^[a-zA-Z0-9_./:-]+$/.test(value) &&
                    !value.includes("//")
                    ? value
                    : null;
                const logical = id(event.logicalRequestId);
                const sdk = id(event.sdkInvocationId);
                if (!logical || !sdk)
                    return;
                if (!isAuxiliary && active?.coreDispatch)
                    closeActive(false);
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
                if (isAuxiliary)
                    active = undefined;
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
                if (!active)
                    return;
                active.logicalRequestId = logical;
                active.sdkInvocationId = sdk;
                active.coreDispatch = {
                    boundary: "provider_dispatch",
                    observedOffsetMs: elapsed(),
                    operationId: id(event.operationId),
                    purpose,
                    orchestrationRetry: typeof event.orchestrationRetry === "number" &&
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
                if (isAuxiliary || !previous)
                    emitRequestObservation(sink, active, health);
                if (isAuxiliary) {
                    auxiliary.push(active);
                    active = previous;
                    if (auxiliary.length > 64) {
                        const record = auxiliary.shift();
                        if (!record)
                            return;
                        record.phase = "closed";
                        record.recordId = randomUUID();
                        record.timing.completionBoundary = "observer_close";
                        record.timing.observationClosedOffsetMs = Math.max(0, performance.now() - record.timing.startedAtMonotonicMs);
                        emitRequestObservation(sink, record, health);
                    }
                }
            }
            catch {
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
        beginInvocation(requestedModel, options) {
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
            }
            catch {
                reportRecordingHealth(health, "observer_callback_failed");
                return undefined;
            }
        },
        streamResult(id, message) {
            try {
                if (active?.observerInvocationId === id)
                    completed(message, "sdk_stream_result");
            }
            catch {
                reportRecordingHealth(health, "observer_callback_failed");
            }
        },
        streamFailure(id) {
            try {
                if (active?.observerInvocationId === id)
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
                    if (!active || (!invocation && !active.coreDispatch)) {
                        closeActive(false);
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
                    closeActive(false);
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
        const id = observer.beginInvocation(args[0], args[2]);
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
