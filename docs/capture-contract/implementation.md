---
status: in-review
stage: BUILT
next: Parent full gates and packed Core verification
---

# Workflow producer capture contract

This extends the [recording and replay contract](../request-recording/implementation.md).
The Core package-root API is the only authority for exact transport linkage.
No argument wrapper, local UUID, environment variable, disk package, or UTC window
is evidence that Core selected a particular request ID.

## Public source API

Consumers namespace-import `@earendil-works/pi-coding-agent` and detect
`getProducerObservationCapability(actualChildRuntime)`. Missing helper,
unsupported capability, or throwing accessor remains unsupported. The finalized
version-1 capability provides `subscribe(callback)` and
`createAuxiliaryCorrelation(purpose, parent)`. Workflow capture only subscribes:
it never allocates competing summary IDs or patches SDK correlation options.

The owning runtime is the public `session.modelRuntime`, including an injected
child runtime. Subscriptions begin before prompting, filter by exact owning
session, and unsubscribe before disposal. Callback, subscription, sink, and
restoration failures cannot change generation. No observer is installed when
workflow request recording is disabled. Reasoning metadata initialization stays
inside the existing safe observer-initialization boundary.

## Identity definitions

These meanings come from the finalized Core producer contract supplied by the
parent, not new workflow terminology:

- **Logical request ID**: Core's final intended generation identity. Explicit
  SDK agent retries retain it; later tool-follow-up generations replace it.
  It is not an individual HTTP request, socket operation, or workflow child retry.
- **SDK invocation ID**: Core's physical provider dispatch identity, selected after
  authentication/header preparation. Different dispatches have distinct IDs,
  even when they share a logical request. A dispatch is not proof of wire traffic.
- **Transport attempt ID**: Core adapter identity for an actual HTTP invocation
  or socket operation. Connection attempts are not generation attempts.
- **Observer invocation ID** *(coined here)*: workflow-local wrapper identity.
  It groups synthetic message starts and final-result callbacks, not Core
  dispatches or physical attempts.

The finalized API's `wireAttemptId` is always null. Workflow never manufactures
one. Join Core `api_attempt` generation records to workflow evidence by nonnull
Core `sdkInvocationId`, `logicalRequestId`, and owning `sessionId`; operation and
explicit orchestration retry index are additional attribution. Transport retries
can create several attempts for one SDK invocation. Do not interpret
`orchestrationRetry` as a transport retry count.

## Version-1 schema evolution

The journal keeps `schemaVersion: 1` with additive optional fields. Historical
records can lack every new field; no backfill or reinterpretation occurs.

| Field | Meaning |
| :--- | :--- |
| `observerInvocationId` | Local wrapper identity; null for dispatch-only auxiliary records. |
| `coreDispatch` | Proof that linkage came from the version-1 public `provider_dispatch` callback. Contains bounded operation, purpose, physical model/provider/API, transport coverage, explicit retry index, and callback receipt offset. |
| `logicalRequestId` | Final Core ID only; null until observed. |
| `sdkInvocationId` | Final Core ID in new records; null without public dispatch evidence. |
| `transportLink.granularity` | `core_logical_request` only after public dispatch; otherwise `session_time_window`. |
| `transportLink.capabilityVersion` | 1 when the actual runtime subscription is available; null otherwise. |
| `transportLink.wireAttemptId` | Always null; the event is not an attempt event. |
| `reasoning` | Closed, metadata-only requested/resolved/invocation reasoning fields. |

Older version-1 records used `sdkInvocationId` for a workflow-local wrapper UUID.
Consequently **require `coreDispatch.boundary === 'provider_dispatch'` before any
exact Core join**. For historical grouping, use `observerInvocationId` when
present, otherwise the old local `sdkInvocationId`; never join the latter to Core
without the discriminator. Optional fields and new granularity values must be
accepted by downstream readers. The persistence loader preserves additive fields
rather than coercing absent reasoning into off or absent retry indices into zero.

## Lifecycle and timing

A public wrapper start precedes authentication and Core ID selection. Its
committed `started` record honestly has null Core IDs and time-window linkage.
The matching `closed` record, joined by `observationId`, gains exact IDs only if
the callback was observed. Earlier starts are not rewritten. An interrupted run
can therefore retain an unlinked start even on a capable runtime.

Dispatch-only records start with exact IDs at the public callback receipt
boundary. `coreDispatch.observedOffsetMs` is local monotonic receipt time relative
to the record's start, not wire-send or server latency. Existing content/end
boundaries remain SDK observations, not provider timings.

Auxiliary purposes such as compaction are recorded separately from a pending
assistant invocation. No summary is called twice, no arguments are altered, and
no summary result is consumed. Such records close at `observer_close` with unknown
outcome and completion unless an independently observed public wrapper supplies
completion. At most 64 auxiliary starts are held; older ones receive an honest
observer close, not a fabricated provider completion. Summary dispatches without
the owning session remain unattributed rather than guessed. Complete compaction
inventory and hidden transport-attempt coverage remain unavailable here.

## Reasoning sources

`reasoning.requestedModelSuffix` captures the original model suffix only when the
catalog-aware parser recognizes it; literal model IDs ending in a thinking word
are not suffixes. `requestedExplicit` independently retains the separate
`thinking` argument, even when a suffix or pre-spawn policy wins.

`selected` is the level handed to session creation after existing routing/policy
precedence, or the injected session option. `selectionSource` distinguishes model
suffix, explicit thinking, session options, session default, and unknown.
`resolvedSession` reads the actual public session thinking level after SDK
clamping; `clamped` is true/false only when both selected and resolved values are
known. `sdkInvocation` is separately observed from the public stream arguments.
A missing or unrecognized value is null, **not `off`**. Known `off` remains off.
This evidence does not claim what reasoning settings were transmitted after
provider hooks; Core retains actual serialized allowlisted settings.

Only enumerated reasoning values, bounded filtered model/correlation names,
scalar counters, IDs, and timings are retained. No prompts, results, reasoning
text, credentials, URLs, payloads, raw errors, or stacks enter this metadata.
Existing accounting remains authoritative; request evidence is not added again.

## Activation and loaded code

Capture reads public `getTransportRecordingStatus()` when available, falling
back to the historical health method. Enabled means configured, not durable
traffic. It neither configures nor flushes the recorder in production. Core owns
private jail-default activation and explicit opt-out precedence.

[QA](qa.md) verifies fresh private files and increasing write counters from the
actual local runtime, including default durable-directory activation and explicit
null opt-out. It also records public runtime provenance: Core source execution
is `source_unstamped`, not proof of installed compiled code. The workflow compiled
graph retains digest-qualified dependency isolation and deterministic frontend
stamping. Installed/disk identity is never substituted for loaded identity.
