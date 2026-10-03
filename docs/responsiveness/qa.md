# Repair verification

## Observed red and green evidence

Durable logs:

```text
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-red.log
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-red-extra.log
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-targeted.log
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-ui-telemetry.log
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-final-targeted.log
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-overhead.json
```

Initial regressions failed: a warm sequence mismatch was accepted, mutated
status poisoned subsequent listings, and oversized navigator selection read
the event log eight times instead of once. Independent old-check probes also
failed for run identity and coarse-mtime in-place ownership changes.

After repair, storage/persistence/request-recording/telemetry tests passed
94/94. Navigator/pager/reload/telemetry tests passed 84/84. The oversized
selection regression now reads once, and an unchanged subsequent selection
reads zero additional event bytes. List mutation tests cover status, nested
usage, summary labels and pending-delivery identity, without history reads.

Telemetry tests cover an inert disabled clock/timer path, 100,000 aggregate
updates with bounded files, whitelist/privacy, asynchronous flush coalescing,
owner-only directories, nonfatal IO failure, actual enabled storage metrics,
CPU/timer-lateness sampling, deadline and idempotent close. No model calls or
real-provider runs occurred; agent execution behavior was not changed.

The final combined targeted run passed 174/174. Build, Biome/script TypeScript,
capability-doc freshness, context freshness, guidance freshness, and release
verification passed; the release gate reported zero warnings. Two consecutive
builds produced identical compiled-module/declaration/frontend SHA-256 lists.
Vantage 0.8.1 checked all seven changed Markdown documents with no findings.
Git whitespace checks passed.

A single synthetic overhead sample performed 100,000 enabled aggregate updates
in 7.24 ms versus 0.95 ms for an integer-increment loop; the numeric snapshot
was 441 bytes. This tests the aggregate sink, not whole-storage timing, and is
not a statistically controlled performance comparison. The inert disabled-path
regression and fixed-table growth test provide the stronger boundedness evidence.

## Landing boundary

The parent owns the full `npm test` landing gate. Use separate temporary HOME
and TMPDIR under `/tmp`, outside Git. This phase runs only targeted suites,
build and short checks. Tracked compiled output and frontend build identity
must be reviewed together. There were no commits, pushes, config changes,
host/jail restarts, deployments, or edits to the core fork.

No attached JavaScript CPU profile was available. Historical capture was
absent, and workflow diagnostics do not complete core UI instrumentation.
Live attribution and production responsiveness remain unverified.

One combined short-check/test command exceeded its 30-second shell bound after
its checks passed. Its interrupted test attempt supplied no result and was not
counted. The final combined targeted suite was rerun with a 60-second bound and
passed all 174 tests; final build determinism was rechecked afterward.


## Independent findings and final evidence

Log-only committed corruption reproduced a preexisting display-cache defect:
authoritative load failed closed, but the selected navigator kept its old
result. The new permanent regression failed before the event-stamp invalidation
repair, then passed. The actual overlay also drops corrupted detail without
throwing. This is a display correction, not a change to paid-call replay or
request recording.

The actual oversized overlay regression was separately run with its prior
repeated-getter conversion restored: it failed with eight reads instead of one.
The repaired source and compiled fixtures now report one read / 5,243,459 event
bytes for cold phases and zero additional reads over 20 warm key/redraw loops.
The actual panel/widget/navigation/poll regression uses 12 live and 25 historical
runs, each with a 1 MiB journal result; 100 loops read zero events/bytes.

A deliberately blocked asynchronous writer exposed lost final skip counters:
closing during the write retained only the previously serialized snapshot.
Its regression failed before the close correction. It now proves 1,000 flush
requests share one in-flight promise and one temporary file; shutdown waits and
emits a fresh final snapshot containing the skips. A separate subprocess
regression shuts down during initialization and checks that no capture lock or
temporary file survives. Disabled actual save/read/detail operations also run
under throwing diagnostic clock/timer spies, not just a missing-file read.

The final source targeted set passed 179/179. Public faux overlay/panel tests
passed 2/2 against installed SDK 0.99.1 and against dev SDK 0.85.1. Compiled tests
passed 2/2 on each of those SDKs using only public package ESM resolution; no
provider sessions were created. The core checkout reports 1.0.0, but its loaded
runtime was not exercised or modified. These tests attest faux public UI
compatibility, not a real-provider 1.0.0 integration run.

An initial test resolver incorrectly used CommonJS conditions for an ESM-only
public export and failed before running tests. It was corrected to public ESM
resolution, then both source/compiled installed-SDK tests passed. No private SDK
APIs or production monkeypatches were added.

Final evidence and synthetic fixture generators remain durable:

```text
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-corruption-red.log
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-overlay-red.log
/workspace/.yolo/durable/responsiveness-workflow-audit/repair-slow-writer-red.log
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-targeted.log
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-sdk-public.log
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-dist-sdk-public.log
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-dist-dev-sdk.log
/workspace/.yolo/durable/responsiveness-workflow-audit/sdk-public-loader.mjs
/workspace/.yolo/durable/responsiveness-workflow-audit/compile-public-fixture.mjs
/workspace/.yolo/durable/responsiveness-workflow-audit/compiled-responsiveness.test.mjs
```

Fixture homes/projects use the `/tmp/workflow-responsiveness-home-*` and
`/tmp/workflow-responsiveness-*` prefixes; telemetry fixtures use
`/tmp/workflow-perf-*`. Every shell test run also received separate temporary
HOME/TMPDIR outside Git. Source capture remains limited to owned workflow
functions; independent getter amplification and large-body rendering are still
explicit limitations. Real-target CPU-profile comparison remains required.
Full parent npm-test/context/docs/release/no-paid landing gates remain pending,
even where this phase previously ran short checks on its own graph.

Final raw byte comparison covered 59 compiled JavaScript files, 59 declarations,
the frontend and the package manifest: 120 files across two successive builds,
without normalizing imports. The baseline tracks 116 dist files plus one
frontend (117 generated files); the new diagnostics module adds two dist files,
so the final generated count is 119 plus the unchanged package manifest.
The count/equality evidence is retained here:

```text
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-build-counts.json
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-build-1.sha256
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-build-2.sha256
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-byte-snapshot/
```

A combined compatibility/build/check command exceeded its 60-second bound
before documentation validation. Its completed compatibility and raw hash
comparisons were retained; the short check was rerun independently and passed.
No interrupted validation is counted as a pass.

## Owned files

Source edits are confined to run-record storage, persistence, navigator UI,
extension shutdown wiring, and the new workflow-performance module. Permanent
regressions live in the run-record-store, workflow-performance, and new
workflow-responsiveness test files. Documentation edits are the five documents
in this directory, the storage protocol and README. Rebuilt dist and frontend
identity changes belong to the same workflow graph. No source history was
rewritten and no request-recording source was changed.

The final aggregate-sink sample completed 100,000 updates in 6.48 ms versus
1.31 ms for the integer-increment loop, with a 441-byte snapshot. This is still
an illustrative single sample, not whole-storage overhead or target profiling:

```text
/workspace/.yolo/durable/responsiveness-workflow-audit/finalize-overhead.json
```

## Parent landing verification

The full parent gate passed on October 3, 2026: 1,723 tests passed, seven
skipped, zero failed. The release check reported zero warnings. Capability,
context, guidance, lint, and script checks passed. Fixture HOME and TMPDIR were
outside Git; no paid-provider calls were used.

A fresh rebuild matched the complete 119-file generated dist/frontend
SHA-256 manifest byte-for-byte. The unchanged package manifest is not part of
that generated-file count. Evidence is in
`/workspace/.yolo/durable/responsiveness-parent/`: `full.log`, `guidance.log`,
`lint.log`, `rebuild.log`, and `dist-{before,after}.txt`.

This supersedes the pending parent-gate statements above. It does not establish
production activation, SDK 1.0.0 UI behavior, or the cause of PID 79's lag.
Publication, extension update, and full Pi restart remain human rollout steps.

The finalized loaded graph stamp is:

```text
sha256:2d8e7cb7c269cf9a1336216b3646528b36ffc8595d2e268c10a1117614f035c7
```
