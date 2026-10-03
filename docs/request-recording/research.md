---
status: accepted
stage: CURRENT
---

# Default child histories do not retain request performance

Source rechecked on 2026-10-04 against `ca31c8d` and installed SDK `0.85.1`. The supplied audit's conclusion is independently supported by the local faux-session regression. [Scope and limitations](implementation.md) are authoritative.

| Evidence | Finding |
| :--- | :--- |
| [Child session construction](../../src/agent.ts) | In-memory by default; optional persistent manager uses project cwd, not worktree cwd. SDK files are written lazily. |
| [Compact histories](../../src/agent-history.ts) | Only bounded text/tool/error entries; no request usage or performance data. |
| [Aggregate usage](../../src/agent-usage.ts) | Existing retry accounting is not per-request recording. |
| [Real SDK regression](../../tests/request-recording.test.ts) | Optional persistent session contains both failed and successful retry assistant entries, each with entry ID and usage. Compact history drops usage. |

Installed public SDK session events notify listeners before appending the assistant entry. Therefore a message-end callback cannot safely use the current leaf as that response's entry ID. SDK retry preparation removes failed responses from active context but retains session history. Session statistics also include compaction/branch summaries and tool-result usage; they are not conversational request totals.

## Fast-moving — verify before building

Read-only inspection of the separate core fork's public runtime/SDK recording contract confirms opt-in at runtime construction, public health/options/flush methods, and SDK-generated session/request correlation. The workflow runtime already shares the host model runtime. The installed SDK lacks that contract, and the environment switch is unset. This inspection does not establish deployment or route coverage.

Disposition: retain public invocation observations with message fallback now; reject copied provider implementations or private SDK hooks. Defer exact transport linkage to a shared public correlation observer if one becomes available. No scanner was investigated.

## Review reproductions

Independent review found that one interrupted SDK stream can cause two assistant-message starts, a failed initial direct-run container save prevents subsequent appends, and append/snapshot alternation invalidates the hydration cache. New failing regressions reproduce all three. The invocation regression injects a stream through the documented public function of a real SDK session: the provider runtime's own lazy adapter catches errors earlier, so a provider-only fixture does not exercise the agent's synthetic-message path. No private fields are needed.


## Production activation evidence and reproduction

The supplied live audit identified `workflow-recording-live-audit-murucvzc-b0mp3c`, completed 2026-10-03 at 03:38 UTC with one child and zero committed observations after `RunPersistence.load` hydration. This implementation phase did not rerun that paid-provider audit. On-disk production wiring looked valid; the exact cause of that run's missing evidence remains unproven.

Inspection found handoff compatibility checked only package version `3.13.0`, unchanged across `ca31c8d` and `87654de`. A failing regression reproduced retention of incompatible same-version code. Reconfiguration updates options, not old manager/persistence implementations. A compiled frontend fixture additionally reproduces cached ESM graph rejection after an in-place frontend update. This is evidence of an activation hazard, not proof of a current-code append bug or attribution of the historical run to one cause.

The repair uses [loaded-build identity and local diagnostics](implementation.md#activation-and-local-diagnostics). No historical timing or missing observations are recovered; SDK observations still are not wire attempts.


## Independent partial-cache finding

Independent review reproduced a separately cached baseline manager being attached to a fresh identity module: the shipped frontend activated and the mislabeled manager was then claimed as compatible. The verification phase reproduced that failure before repair in a package fixture with independently preloaded real manager and recorder modules. Comparing only the identity module was insufficient.

The repair isolates the entire internal compiled dependency graph by [loaded-build identity](implementation.md#activation-and-local-diagnostics) in module URLs. A permanent structural regression checks every compiled import/re-export edge and the frontend entry; an independent digest check includes the runtime manifest to preserve version-only update safety. Real compiled-manager fixtures now demonstrate original-promise preservation and pending completion delivery for the same build, plus abort settlement, committed journal preservation, and replay-based resume after changed/legacy handoffs. These fixtures use local controlled agents, not paid providers; they do not identify the historical zero-record run's cause.
