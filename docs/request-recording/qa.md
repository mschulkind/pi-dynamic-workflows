---
status: in-review
stage: BUILT
next: "Human rollout and authorized real production activation/hydration verification"
---

# Local evidence supports the message-observation boundary

**Status:** 2026-10-04, locally verified after fixture-isolation repair. MEASURED with local faux providers through the development SDK 0.85.1, the installed fork SDK 0.99.1, and the built fork SDK 1.0.0. No paid-provider or deployed-extension verification. [Scope and limits](implementation.md) remain authoritative.

## Completed checks

| Check | Observed result |
| :--- | :--- |
| Initial regression run | Failed with missing recording module, before runtime edits. |
| Targeted recording/history/usage/cache/record-store/settings suites | 75 tests passed, including 12 new recording regressions. |
| Existing run-persistence suite | 51 tests passed. |
| No-emit source TypeScript; script TypeScript | Passed. |
| Biome check and lint | Passed; no generated output required. |
| Context/capability-doc/guidance freshness | Passed; protected files unchanged. |
| Vantage documentation check | Six edited/new Markdown files passed before this stop report. |
| Review defect regressions | All three failed before fixes; 17 recording tests passed after fixes. |
| Warm append/save read amplification | Committed-log read bytes: 40 observations = 0; 80 = 0 (previously 1,740,486 / 6,865,827). |
| Initial full npm test | 1,701 tests: 1,690 passed, 4 failed, 7 skipped; exit 1 because temporary non-Git fixtures inherited the outer repository. |
| Repaired full npm test | 1,694 passed, 0 failed, 7 skipped; release verification passed with zero warnings. HOME and TMPDIR fixtures were outside repositories. |
| Guidance, lint, tracked build consistency | Passed. A second build produced byte-identical distribution files, verified with complete SHA-256 manifests. |
| Installed fork SDK 0.99.1 | All 17 recording tests passed through its public ESM exports and local faux providers. |
| Built fork SDK 1.0.0 | All 17 recording tests passed with core recording disabled, and again with an explicit private recording directory enabled. Health inheritance is verified; exact transport linkage is not. |

The new regressions use real SDK sessions with faux providers for tool-follow-up, schema repair, sequential named threads, SDK retries, optional persistent transcripts, manager defaults, and opt-out. Persistent retry history preserves both assistant entries and their usage; compact history does not. Context inspection confirms observation IDs/records do not enter provider prompts.

Deterministic observer/persistence tests cover error-only events, partial abort, abort-drain late appends, workflow retry exhaustion, nested duplicate labels, replay versus changed work, normalized counts/default-zero ambiguity, malicious extra fields, sink throw/rejection, cold reads, start-only evidence, failed head commit, truncated committed log, linear append growth, retention/delete, and aggregate non-regression. Core activation tests cover absent, disabled, enabled, and throwing public health interfaces, **not deployed-core transport linkage**.

Fixture/assertion failures encountered during development were repaired: structured-output capture intentionally stops a follow-up, recoverable workflow exhaustion returns null rather than rejecting, and manager persistence is constructed internally rather than injectable through constructor options. No runtime accounting behavior was changed to accommodate tests.

## Durable logs

```text
/workspace/.yolo/durable/workflow-recording-red.log
/workspace/.yolo/durable/workflow-recording-targeted.log
/workspace/.yolo/durable/workflow-recording-persistence.log
/workspace/.yolo/durable/workflow-recording-lint.log
/workspace/.yolo/durable/workflow-recording-quality.log
/workspace/.yolo/durable/workflow-recording-docs.log
```

## Initial verification failure: fixtures crossed the Git boundary

The command ran from this fork with `HOME` and `TMPDIR` under durable storage. `TMPDIR=/workspace/.yolo/durable/workflow-recording-verification-tmp` is inside the outer dotfiles Git repository. Four tests expecting non-Git temporary directories discovered `/workspace` instead. Their worktree creation succeeded rather than failing closed, so their assertions failed and left four outer-repository worktrees/branches. This is an isolation failure of the verification setup, not evidence that the request-recording fixes failed. No worktree cleanup outside this fork's ownership was attempted.

Failed cases:

- requested worktree isolation fails closed before starting a non-git agent;
- a journal entry from isolation: false cannot replay after worktree isolation is requested;
- createWorktree no-ops (not isolated) outside a git repo;
- createWorktree falls back when git fails (non-git directory).

The delegated verification ran at `/workspace/.forks/pi-dynamic-workflows`, branch `main`, HEAD `ca31c8d`, and stopped with exit 1. The parent verified the exact four recorded worktrees and branches against that inventory, checked each had the expected HEAD and no changes, then removed them without force. Only the main dotfiles checkout remains registered; the dotfiles tree is clean. No user worktree or branch was removed.

The parent reran the complete landing gate with throwaway HOME and TMPDIR under `/tmp`; durable logs and source remained under the workspace. All four assertions passed without production-code changes or weakened tests. Release verification, guidance, lint, and deterministic rebuild checks passed. Additional current/built SDK probes first needed ESM-loader harness repairs; the 1.0 probe then exposed a fixture hardcoding `unsupported` instead of observing the actual public runtime, which correctly reported `disabled`. The fixture now asserts the inherited runtime's actual activation state, and all 17 recording tests passed on both SDKs and with the core recorder explicitly enabled.

No paid calls, core-fork edits, scanner changes, publication, deployment, or historical timing recovery occurred. The core-enabled probe uses faux providers; health activation does not establish physical transport-attempt coverage.

Final parent verification artifacts:

```text
/workspace/.yolo/durable/workflow-recording-parent-full.log
/workspace/.yolo/durable/workflow-recording-parent-guidance.log
/workspace/.yolo/durable/workflow-recording-parent-lint.log
/workspace/.yolo/durable/workflow-recording-parent-dist-before.txt
/workspace/.yolo/durable/workflow-recording-parent-dist-after.txt
/workspace/.yolo/durable/workflow-recording-current-sdk.log
/workspace/.yolo/durable/workflow-recording-built-sdk.log
/workspace/.yolo/durable/workflow-recording-enabled-sdk.log
/workspace/.yolo/durable/workflow-recording-enabled-ledger-path.txt
/workspace/.yolo/durable/workflow-recording-cleanup.log
```

The full gate is `npm test`, followed by `npm run guidance:check`, `npm run lint`,
and a byte-identical `npm run build` check. SDK matrix probes use the public ESM
exports with the durable loader harness; they do not replace dependencies or
activate the deployed extension. Earlier delegated evidence remains available:

```text
/workspace/.yolo/durable/workflow-recording-verification-red.log
/workspace/.yolo/durable/workflow-recording-verification-targeted.log
/workspace/.yolo/durable/workflow-recording-verification-full.log
/workspace/.yolo/durable/workflow-recording-verification-docs.log
/workspace/.yolo/durable/workflow-recording-verification-outer-worktrees.log
/workspace/.yolo/durable/workflow-recording-verification-partial.patch
/workspace/.yolo/durable/workflow-recording-verification-new-files.tar
```


## Current activation repair on 87654de

Prior full-suite/SDK-matrix results above belong to the earlier implementation; they do not establish live activation or verify this new repair. The supplied production audit retained zero committed observations. Its exact cause remains unproven; [research](research.md#production-activation-evidence-and-reproduction) records the distinction.

Failed-before-fixed evidence is retained under the durable directory:

```text
/workspace/.yolo/durable/activation-red.log
/workspace/.yolo/durable/activation-false-red.log
/workspace/.yolo/durable/activation-initialization-red.log
/workspace/.yolo/durable/activation-restore-red.log
/workspace/.yolo/durable/activation-vocabulary-red.log
```

The initial tests failed for same-version incompatible adoption and silent rejected append/callback diagnostics. The explicit false-append test then failed before emitter handling was added. The initialization regression failed before the shared safe-initialization helper existed. A hook-restoration regression also failed before restoration failures became nonfatal callback diagnostics. An injected-runner vocabulary regression failed before runtime allowlisting prevented arbitrary diagnostic text. A subsequent integration test initially called the nonexistent `manager.run`; that fixture typo was corrected to the existing `runSync`, without production API changes.

Current targeted runs exercise the shipped compiled frontend via the real frontend loader, matching-build manager/effort retention, changed/legacy fallback, cached-graph refusal with pause, existing cwd/TTL/session/pending-delivery cases, faux-SDK healthy recording and opt-out, unsupported injected sinks, sync/async/false append failures, observer initialization/callback failures, and message fallback. Local health stays out of model-facing result logs. All fixture HOME/TMPDIR locations are outside Git repositories; logs/drafts stay durable.

Final targeted verification: **100 passed, zero failed/skipped** across activation, recording, reload, frontend/host modules, tool availability, agent usage/history, and settings suites. Source/script TypeScript build/check passed. Targeted Biome check passed without warnings. Capability docs, context measurement, and guidance freshness passed; protected guidance was unchanged. Two builds produced byte-identical complete distribution/frontend SHA-256 manifests. Vantage 0.8.0 checked all six edited Markdown files with no findings.

```text
/workspace/.yolo/durable/activation-integration.log
/workspace/.yolo/durable/activation-build.log
/workspace/.yolo/durable/activation-biome.log
/workspace/.yolo/durable/activation-quality.log
/workspace/.yolo/durable/activation-dist-before.txt
/workspace/.yolo/durable/activation-dist-after.txt
/workspace/.yolo/durable/activation-docs.log
```

During implementation, broad `npm test`, release verification, and the installed/built SDK matrix have deliberately not been rerun in this phase. Paid-provider live activation, host refresh, deployment, publication, and historical timing recovery are not claimed.


## Verification phase: partial-cache repair

The independent reviewer found that the initial frontend checked only its identity module, permitting a separately cached old manager to be mislabeled as new. That defect was reproduced before repair:

```text
/workspace/.yolo/durable/activation-partial-cache-red.log
/workspace/.yolo/durable/activation-manifest-red.log
```

Complete internal module-URL isolation replaces that insufficient check. The manifest digest regression additionally failed before package metadata entered the digest, preventing a version-only update from inheriting cached JSON. Same-build compiled-manager tests preserve the live run and original returned promise, finish both children exactly once, and retain the pending-delivery marker. Changed/legacy handoffs pause real in-flight managers, await aborted execution settlement, preserve the first child's committed journal result, and resume in a fresh compiled manager without rerunning that child. A fixture initially compared VM objects with host objects using strict prototype equality; assertions now compare plain JSON values, without production-code changes.

The requested prior loader path was absent. The existing recording loader was read and adapted in durable storage. Built-SDK probes initially failed because symlink URLs prevented ordinary dependency resolution, then because a hand-made mapping omitted new SDK packages. The harness now resolves public export targets to real paths through the fork's existing workspace package inventory. No SDK source/dependency tree was changed. Failed harness logs are retained, not evidence of a producer defect.

The authorized full sweep and focused gate repairs are recorded below. All verification uses throwaway HOME/TMPDIR under `/tmp` with isolated Git configuration; artifacts remain durable. No paid-provider call, host deployment, runtime reload/restart, scanner change, or core source edit occurred.


### Landing evidence and remaining limits

| Check | Result |
| :--- | :--- |
| Full `npm test` sweep (one broad run) | 1,716 tests: 1,707 passed, 2 fixture failures, 7 skipped. |
| Focused gate repair | 42 tests: 35 passed, 0 failed, 7 skipped; both broad-run failures resolved. |
| Effective full-suite coverage after focused repairs | 1,709 passing cases, 7 skipped; no known remaining failing case. The entire suite was not repeated. |
| Installed SDK 0.99.1 | All 40 recording/activation/reload tests passed; zero failures/skips. |
| Built SDK 1.0, core off | All 40 tests passed; zero failures/skips. |
| Built SDK 1.0, core on | All 40 tests passed; zero failures/skips, with expected custom/auxiliary coverage-gap warnings. |
| Final Biome and source/script TypeScript | Passed with no warnings. |
| Docs/context/guidance freshness and release verification | Passed; release gate reported zero warnings. |
| Complete distribution plus frontend manifests | 117 files byte-identical across a second build. |
| Edited Markdown render checks | Vantage checked six files, no findings. |

The full run's release test still required the previous unqualified frontend import. Its assertion now requires the digest-qualified entry and the shipped identity module. The approval fixture separately imported an unqualified internal scope beside a qualified compiled agent, duplicating module-local runtime-admission state. A shared test helper now selects the same compiled generation as the public entry; both normal and optional production approval fixtures use it. No approval runtime code or assertion of fail-closed admission was relaxed. Both failures passed on the focused rerun, and the previously unreached release/guidance/lint/rebuild steps then passed. The full `npm test` command itself remains an initial failed-run artifact, not falsely reported as a single green invocation.

Seven optional existing approval checks remain skipped: six need the external actual-gate helper configuration, and one requires `ctx.executeTool` absent from the development SDK. SDK-matrix recording tests have no skips. Core-enabled faux-provider tests report custom/auxiliary transport coverage gaps; their success verifies public health inheritance and workflow SDK observations, not physical wire attempts. The optional full-transcript test also prints its expected persistence warning. No historical timing is recovered and no running deployed manager is claimed repaired.

```text
/workspace/.yolo/durable/activation-verify-full.log
/workspace/.yolo/durable/activation-verify-gate-repair.log
/workspace/.yolo/durable/activation-verify-check-final.log
/workspace/.yolo/durable/activation-verify-docs-freshness.log
/workspace/.yolo/durable/activation-verify-context.log
/workspace/.yolo/durable/activation-verify-guidance.log
/workspace/.yolo/durable/activation-verify-release.log
/workspace/.yolo/durable/activation-verify-lint.log
/workspace/.yolo/durable/activation-verify-dist-before.txt
/workspace/.yolo/durable/activation-verify-dist-after.txt
/workspace/.yolo/durable/activation-verify-sdk-099.log
/workspace/.yolo/durable/activation-verify-sdk-100-off.log
/workspace/.yolo/durable/activation-verify-sdk-100-on.log
/workspace/.yolo/durable/activation-verify-sdk-loader-failure.log
/workspace/.yolo/durable/activation-verify-sdk-loader-telemetry-failure.log
/workspace/.yolo/durable/activation-verify-sdk-loader-protocol-failure.log
/workspace/.yolo/durable/activation-verify-docs.log
```

The final loader-failure artifact's name predates diagnosis; its missing package was `pi-codemode`, not the protocol package. It is a harness-inventory failure retained verbatim. Fixture setup, full gate, focused repairs, and matrix commands are retained as durable shell scripts/loader files alongside these logs.

### Final parent full gate

After the focused fixture repairs, the parent reran the complete gate: **1,709 passed, zero failed, seven skipped** across 1,716 tests. Release verification reported zero warnings; guidance and lint passed. Complete distribution/frontend manifests matched across another build, and the source tree remained clean. This supersedes the earlier focused-only landing limitation, not the missing live-activation evidence.

```text
/workspace/.yolo/durable/activation-parent-gate.sh
/workspace/.yolo/durable/activation-parent-full.log
/workspace/.yolo/durable/activation-parent-guidance.log
/workspace/.yolo/durable/activation-parent-lint.log
/workspace/.yolo/durable/activation-parent-dist-before.txt
/workspace/.yolo/durable/activation-parent-dist-after.txt
```

The README's reload paragraph now explicitly requires matching package and loaded-build identities, consistent with the recording contract. Publication, process restart, and fresh production hydration verification remain human rollout steps; no scanner changes or historical recovery occurred.
