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
