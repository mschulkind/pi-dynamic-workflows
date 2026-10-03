---
status: in-review
stage: BUILT
next: "Human rollout and authorized real-work activation/hydration verification"
---

# Workflow children retain request evidence outside model context

**Status:** Activation repair implemented on `87654de` after a real production run retained zero committed observations. Prior hermetic verification did not prove live activation. The independent partial-cache finding is repaired and locally verified, including the full-suite sweep plus focused fixture repairs and installed/built SDK matrix. This repair is not deployed; see [QA](qa.md) for exact results and deployment limits.

This is the single source of truth for this change's scope and limits. See [research](research.md), [plan](plan.md), [tasks](tasks.md), and [QA](qa.md) for provenance and verification.

## Activation and local diagnostics

**Loaded-build identity** *(coined here)* is an immutable literal digest shipped with the compiled runtime and captured when that module graph is evaluated. It identifies executable workflow code, not a later Git revision, disk reread, dependency version, or proof of provider activation. The build hashes the runtime package manifest and sorted, length-framed fresh compiled JavaScript modules, excluding the identity module itself, with a versioned digest format. Hashing precedes URL stamping, so neither generated identity nor generated URL enters its own input. Identical rebuilds are byte-identical. Source execution uses a distinct identity per evaluated source graph, not the last prebuilt artifact.

A live manager is retained only when both package version and loaded-build identity match. Same-build replacement preserves the manager, promises, effort object, and pending-delivery owner. Missing legacy identities and changed builds use existing pause/journal recovery, not reconfiguration of old implementations. Cwd checks, replacement-reason checks, TTL expiry, and version checks still apply. Updating/reloading may pause affected work; resume it from `/workflows`, rather than treating it as abandoned.

The frontend and **every internal compiled import/re-export** use the same digest query in their native ESM module URLs, including the runtime package manifest. Node keys its ESM cache by URL; a changed complete build therefore gets a separate dependency graph rather than fresh identity metadata attached to independently cached old manager/observer/persistence implementations. An unchanged build uses the identical URLs and retains the identical graph. External public SDK imports are not rewritten. No source code, Git revision, or later disk read is used to relabel a loaded producer.

The frontend also compares its shipped identity to the imported graph's literal. A malformed/stale frontend mismatch still rejects activation, pauses a staged runtime through its existing recovery helper, and asks for a Pi process restart. Legacy graphs lacking that helper rely on the existing handoff expiry pause. Ordinary complete same-version updates can load the new isolated graph, pause incompatible work, and recover from its journal. Updates are not made atomic by this mechanism: do not update package files concurrently with loading them. Old ESM graphs remain cached until process exit; restarting Pi after repeated updates releases that memory.

Recording emits at most one local diagnostic per reason per workflow frame/execution, through the existing logger and manager UI log stream. Managed logs are run-scoped and retained with normal snapshots when storage works; direct embedding uses the normal run log file/callback. Diagnostics bypass model-facing workflow result logs, prompts, shared-store tools, and child histories. No new settings switch or scanner schema is added.

| Reason | Meaning |
| :--- | :--- |
| `enabled` | Recording requested and a sink is present; not proof of a committed record. |
| `disabled` | Explicit opt-out. |
| `missing_append_sink` | Unavailable: the injected persistence/embedding lacks a usable sink. |
| `invocation_observer_ready` | Public SDK invocation wrapper installed. |
| `message_observer_fallback` | Public invocation hook unavailable/unwritable; message observations remain available. |
| `observer_initialization_failed` | Observer construction failed; agent execution remains independent. |
| `observer_callback_failed` | An observation callback failed; evidence may have gaps. |
| `append_failed` | Sink threw, rejected, or explicitly returned false; evidence may have gaps. |

These are a closed vocabulary, never arbitrary exception text, URLs, credentials, prompts/completions, or unrestricted usage. An injected runner can forward the optional `AgentRunOptions.onRequestRecordingHealth` callback alongside its observation sink. Healthy zero observations can mean no observed SDK invocation, a custom runner not emitting observations, or unsupported coverage; `enabled` does not resolve that ambiguity. Missing health on older runs is **UNKNOWN**, not enabled or disabled. Logging itself is best-effort: storage failure is nonfatal and cannot guarantee durable diagnostics, and repeated failures are not counted or reconstructed.

## Observation boundary and identity

An **SDK stream invocation observation** *(coined here)* starts at the call to Pi's documented public `session.agent.streamFunction`. It is not a dispatched HTTP request or transport attempt: middleware, provider-client retries and transport activity can occur inside that invocation. The wrapper preserves arguments, callbacks, options, return identity, and the original SDK consumer; it never consumes the stream iterator.

An **SDK assistant-message observation** *(coined here)* is the fallback boundary when the public invocation hook cannot be installed. It observes an assistant response through public session events, not dispatch. An error-only message can start immediately before ending.

- Each public invocation has a fresh `sdkInvocationId`, and its observation has an `observationId`; start and close records have separate `recordId` values. Join them, do not count both as requests. Synthetic assistant starts during a failed invocation share its identity and do not create a new request; `assistantMessageStarts` reports the observed count. SDK retries and tool follow-ups actually invoking the function receive new IDs.
- Fallback message-only records have `sdkInvocationId: null`, `granularity: sdk_assistant_message`, and `startBoundary: sdk_message_start`. They cannot enumerate or deduplicate SDK invocations; never treat message count as an exact request count. Records with hook attribution use `granularity` and `startBoundary: sdk_stream_invocation`.
- Root run, nested frame, lexical call, fresh execution, child attempt UUID, attempt ordinal, and child session identify attribution. Attempts remain distinct across retries and threaded turns.
- `stableWorkId` combines the namespaced call ID with the existing deterministic resume hash. It changes when hashed call inputs change, not on a genuine replay. It is an opaque work fingerprint, not an authentication hash. Positional calls alone are not stable work identity; this fingerprint is not proof of equivalent upstream state or identical live tool results.
- Replay records have `accountingRole: non_request_provenance`, reference prior run/call/work identity, and are not new requests. A reference does not prove earlier evidence exists.
- Request records have `accountingRole: request_evidence`, never add to aggregate totals, and are outside prompts, shared-store tools, message content, and compact histories. Existing accounting/footer/approval behavior is unchanged.

The subscription covers tool-follow-up requests, schema repair, SDK retry responses, error responses, and named-thread turns. A workflow retry gets a fresh child-attempt ID. A summary that uses the same public stream function can retain invocation start and final-result metadata through the public `result()` promise, without reading chunks. Completion is labeled `sdk_stream_result`; streamed first/last content and reasoning are unavailable for that path. Summary routes bypassing this hook remain unavailable; recording is not a complete summary inventory. Hidden transport retries are unavailable here.

## Storage and discovery

Managed runs append through `RunPersistence.appendObservation`. The default filesystem implementation uses the existing short writer mutex, hash-chained log, flushed append, and atomic committed head. Evidence writes remain open while aborted children unwind, independently of closed snapshot callbacks. Snapshot saves preserve already-committed evidence. Successful appends update a coherent warm cache only after the head commits; cold, externally changed, damaged, or evicted cache entries hydrate normally. Cache entry/count/size bounds remain unchanged.

```text
~/.pi/workflows/projects/<project-key>/runs/<run-id>.json
~/.pi/workflows/projects/<project-key>/runs/<run-id>.json.events.jsonl
```

`workflowProjectPaths(cwd).runsDir` gives the directory. `RunPersistence.load(runId).requestObservations` returns a record-ID map from the committed log. Raw log tails after the head's byte boundary are uncommitted: do not treat them as evidence. Direct `runWorkflow` embedding uses the same storage, lazily creates a metadata-only run container with no script or prompts, and marks it terminal after draining. Initialization is retried on later observations after a failed initial save; the earlier dropped record remains unavailable, not retroactively recovered.

Retention/delete follows existing run policy (default 300 terminal runs, with running/paused and pending-delivery exclusions). No separate orphan evidence files exist. Records grow linearly with observations, not stream chunks; snapshots still have to compare current state. An interrupted run can retain only a start record. Observer/write failures are best-effort and may leave gaps; they must not fail agents. Injected persistence without `appendObservation` does not retain this evidence. An injected `onRequestObservation` owns durability and async flushing; custom runners must emit observations.

`recordAgentRequests` defaults to true in workflow settings, manager options, and `runWorkflow` options. Explicit false disables this evidence, not transcript persistence or core transport recording. No environment switch is needed for baseline recording. Direct `WorkflowAgent.run` outside `runWorkflow` needs supplied attribution and a sink; it has no workflow run to attach to automatically.

## Reading the record schema

Schema version 1 records are metadata evidence, not another cost ledger. Request observations use `recordKind: workflow_request_observation` / `accountingRole: request_evidence`; replay uses `workflow_request_replay` / `non_request_provenance`. Field definitions and exported TypeScript types live in the [recorder](../../src/request-recording.ts).

For downstream discovery, enumerate runs using the existing persistence API or directory above, hydrate the authoritative head, then read `requestObservations`. Use root/frame/call/work/execution/attempt/session identity to attribute work. Join phases by `observationId`; use nonnull `sdkInvocationId` to group invocation evidence. Do not add the enclosing run or agent usage totals again. Replay references identify historical work, not evidence of a new paid request. Treat absent coverage as unknown and honor retention/committed-head boundaries. This is a storage handoff only, not scanner implementation or scanner coverage.

```ts
import { createRunPersistence } from "@quintinshaw/pi-dynamic-workflows";
const persistence = createRunPersistence(projectCwd);
const evidence = persistence.load(runId)?.requestObservations ?? {};
```

## Usage and timing coverage

| Dimension | Retained | Not available here |
| :--- | :--- | :--- |
| Storage | Committed start/close records, replay provenance | Guaranteed writes after observer/filesystem failure |
| Identity | Run/frame/call/work/execution/attempt/session/invocation/observation | SDK session entry ID, provider request ID, exact core logical request ID |
| Model | Requested provider/model at the public invocation; assistant-message model; `responseModel` as `returnedModel` when supplied | Actual hostname; returned model when absent from SDK evidence |
| Usage | Finite nonnegative allowlisted normalized input/output/cache/reasoning/total counts | Safe original provider counts, provider-reporting provenance |
| Timing | UTC start paired with process-clock UUID and monotonic start; content/reasoning/answer/last-content/end/close offsets | Dispatch/wire attempts, server decode latency, historical missing observations |

Required normalized SDK counters at zero are `unknown` with null value: the SDK defaults these fields to zero without usage reports. Optional reasoning/cache-write-one-hour counts can retain zero as `sdk_normalized`, **not provider-confirmed zero**. Positive values are normalized SDK counts, not original provider counts. Reasoning is a subset of output in this SDK; never add it to output again. Unknown never becomes an estimate or confirmed zero. Cost aggregates remain exclusively on existing accounting paths.

First visible answer means the first observed nonempty text delta, not proof of a final answer. Reasoning and tool arguments do not satisfy it. Tool-argument deltas count only as content observations. First/last offsets can remain null when no delta is seen. Completion is the SDK message-end observation when received, or the independently observed `sdk_stream_result` for requests without conversational message events. A disposal close without completion is explicitly `observer_close`, with no invented completion. Result-promise timing does not measure server completion or network dispatch. No rates are calculated. Chunks/characters are not tokens, and any future derived rate must name its numerator and time denominator.

No new record retains text, tool arguments, reasoning content/signatures, arbitrary errors, credentials/authentication hashes, payloads, full URLs/query/path, or duplicated prompts. Model strings are bounded and filtered. Hostname remains null rather than inferred from provider/model names.

## Core transport inheritance

The development dependency SDK is `0.85.1`; the installed CLI fork SDK is `0.99.1`. Neither exposes the new public performance-recorder health interface, so child records on those versions report `activation: unsupported`. The built fork SDK is `1.0.0` and exposes that interface: probes verified disabled and explicitly enabled states. `PI_API_PERFORMANCE_DIR` is unset in the parent process. The new core recorder is **not active in the installed CLI**.

On a core build exposing public `getPerformanceRecordingHealth`, children inherit the existing host runtime through the established model-registry/runtime wiring (an injected child runtime takes precedence). Health indicates enabled/disabled/unsupported/unobserved; enabled is not proof that a particular route produced a durable transport record. No private SDK modules or copied provider implementation are used.

The evolving core SDK supplies child session and operation/logical-request correlation itself. This change does not replace it or activate a runtime after construction. Core opt-in uses `PI_API_PERFORMANCE_DIR` when the runtime is created; transport evidence resides separately in that configured directory, under the core recorder's own schema and retention. This change neither duplicates nor flushes those records; the runtime owns its persistence.

Workflow records link only by child session plus UTC observation window. That is **partial linkage**, especially for successive turns on a named thread; exact request IDs are null. The inspected public contract offers no shared observer that exposes those generated IDs here. SDK invocation/message windows are not wire dispatch windows, so correlation can remain ambiguous. Unsupported summary/routes and recorder failures are not invented as hidden attempts. Enabled-core health inheritance passed local faux-provider probes. Exact transport-record linkage remains unverified; these probes do not deploy the new core or establish a shared request ID.

## Explicit exclusions

No scanner discovery, implementation, accounting, or coverage claim. No core-fork writes, deployment, dependency/lock changes, or paid calls. Full local gates are recorded in [QA](qa.md). Historical unrecorded timing cannot be recovered; optional old session files may supply message usage and identity, not missing monotonic timing or hidden attempts.
