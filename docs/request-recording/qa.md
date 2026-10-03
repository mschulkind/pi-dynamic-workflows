---
status: in-review
stage: BUILT
next: "Publish on the host, refresh extensions, and inspect new request records"
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
