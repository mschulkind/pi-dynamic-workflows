# Storage repair and local performance capture

## Changes

Cached hydration now matches committed sequence and run identity as well as
its prior generation/bytes/hash/event-stamp checks. Mismatches replay and retain
the existing fail-closed boundary verification. Observation appends cannot
reuse a cache entry with a mismatched boundary; their existing small-head
append protocol is otherwise unchanged.

List callers receive fresh routing values, lazy delivery/detail descriptors,
and independent summaries. Copies share an opaque private revision token,
not caller-visible object identity. A changed parsed head produces a new token.
Selected snapshots also check the event-file stamp before reuse. A changed or
missing log invalidates the display cache; failed committed-prefix verification
clears the selection rather than displaying a previously verified result. This
adds a stat check, not history reads, to warm historical selections. Display
validation does not replace authoritative resume validation.

The navigator selects agents, journal, phases, logs and routing/usage fields
with one hydration and one clone, then retains only its most recent converted
snapshot. Full authoritative reads and lazy delivery text remain available.
Scripts, arguments and request observations are not cloned for phase selection.
Complete agent results/history and namespaced/legacy journal fallbacks remain.

Preview stamp matching includes ctime. Cooperative writers still replace heads
atomically. Stat-only reuse cannot detect hostile edits that preserve every
available stamp. Neither preview tokens nor routing summaries bypass log
verification.

## Opt-in capture

Set the following environment variable before starting the workflow runtime;
no workflow setting or model change is required:

```bash
PI_WORKFLOW_PERF_DIR=/absolute/private/local/directory
```

Unset means off. Relative directories, symlinks at the selected directory,
non-owner directories, and group/world-accessible directories are rejected.
New directories use mode 0700; files use 0600. One exclusive lock prevents
concurrent recorders in that directory. After a process crash, use a new
private directory or manually remove the stale capture lock after confirming
its recorder is gone; automatic lock reclamation is deliberately absent.

Capture initializes asynchronously, so startup operations may be unmeasured.
It stops after 120 five-second samples, on IO failure, or on session shutdown
(including replacement/reload). A stopped capture does not automatically
restart in the same loaded module graph. A new process can opt in again.

Only closed-name numeric cumulative counters are written: hydration cache
hits/misses and first mismatch reasons; oversize rejection/eviction; committed
event bytes actually read; replay entries; hash calls/bytes/milliseconds;
clone calls/milliseconds; comparison-cell construction calls/milliseconds;
static hydration caller counts (`read`, `detail`, `lazy`, `save`), and
`observation` append counts.
Mismatch reasons include absence, generation, sequence, identity, bytes, hash
and stamp. Hash and clone counts describe owned storage boundaries, not all
process-wide hashing/cloning. Head reads and preview-copy cloning are not
instrumented. Metadata-only writers and UI rendering have no detailed timing.

Process CPU microseconds and five-second timer lateness are sampled using Node
performance/process APIs. Timer lateness is not dispatch-to-render latency or
physical-keypress latency. Nested timings overlap and must not be added as if
they were independent CPU totals. Static caller counts do not identify a run,
agent, model, phase, or arbitrary call stack.

## Bounds and privacy

A fixed aggregate table saturates at the maximum safe integer. Every five
seconds one asynchronous snapshot replaces one of two fixed files; at most
one temporary write is in flight. Concurrent flush requests increment a skip
counter and reuse that promise rather than enqueueing data. Output is below
4 KiB in the growth fixture, independent of request/run count. Stop clears the
timer, waits for any in-flight asynchronous write, writes one final fresh
aggregate snapshot, closes the exclusive lock and removes it; close is
idempotent. Final sampling preserves counters accumulated during a slow write.
An awaitable shutdown also waits for pending asynchronous initialization; a
capture completing after shutdown is closed instead of being re-enabled.

There are no content fields, paths, URLs, credentials, prompts, outputs,
keystrokes, names, identifiers, raw errors or stacks in records. The configured
directory is used for IO but not included in the payload. No stdout, UI,
network, request-evidence, or model-context output is produced. IO failure
silently disables capture without changing persistence. File creation and
writes are asynchronous, never synchronous flushes per render.

Disabled operation instrumentation does not call clocks, create event objects,
serialize diagnostics, allocate stacks, read extra files, or start timers.
Normal persistence work remains synchronous and unchanged. Enabled counters
and timing add overhead; these are aggregate diagnostic samples, not a CPU
profile. Core UI dispatch/render instrumentation remains incomplete and is
owned by the separate core writer.

## Deferred work

Independent lazy getters still hydrate separately when a record exceeds the
storage cache cap; the explicit detail operation is the bounded alternative.
Caching every oversized full record behind list previews is deliberately not
introduced. Oversized snapshot saves still replay, and comparison construction still
serializes unchanged cells. Large result panes still prepare whole bodies.
This repair does not claim to eliminate those independently measured costs or
to fix the slow target in production. No provider/runtime agent routing,
accounting or replay identities were changed.
