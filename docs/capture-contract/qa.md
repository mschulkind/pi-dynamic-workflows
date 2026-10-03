---
status: in-review
stage: BUILT
next: Parent full landing gates, packed Core consumers, and authorized host rollout
---

# Local producer evidence and remaining gates

No paid providers, commits, pushes, deployment, restart, scanner, private SDK
imports, or Core/root edits were used. [Contract](implementation.md) owns meaning.
The initial missing dispatch and status tests failed before implementation.

## Observed checks

| Check | Result |
| :--- | :--- |
| Development SDK 0.85.1 targeted recording, activation, record-store, and reload suites | 102 passed, zero failures; two fixtures skipped because that SDK lacks the finalized Core capability. |
| Final Core 1.0 source, workflow source | 41 passed, zero skips, including fresh HTTP/SSE and WebSocket adapter joins. |
| Final Core 1.0 source, compiled workflow graph | 41 passed, zero skips. |
| Installed SDK 0.99.1 compiled workflow compatibility | 39 passed, zero failures; two unavailable-Core fixtures skipped. |
| Development SDK 0.85.1 compiled workflow compatibility | 39 passed, zero failures; two unavailable-Core fixtures skipped. |
| Existing append/save performance regression | 40 and 80 observations both read zero committed-log bytes. |
| Source build and scoped Biome | Passed; script TypeScript, docs/context/guidance freshness, release verification (zero warnings), and whitespace passed. |

The HTTP fixture uses an actual loopback server with a 503 response, streaming
completion chunks, a tool call, and a new follow-up generation. Cold persistence
hydration joins newly committed workflow records to actual Core `api_attempt`
records using final public IDs. The fixture observes 0700 directory/0600 file
permissions, enabled runtime health, fresh write counts, reasoning clamping,
workflow-recording opt-out without extra requests, and Core explicit null opt-out
without additional records. A separate faux-session regression proves explicit
agent retry indices 0/1 share logical identity while SDK invocation IDs differ.

The WebSocket fixture replaces the platform socket with a local event target and
runs the actual Core adapter through the public SDK. It verifies generation
operation records, accepted send, and exact journal joins. This is adapter socket
operation evidence, **not a real network WebSocket exchange**; connection records
are excluded from generation counts. No paid endpoint is reached.

Two complete distribution/frontend manifests covered 119 files and matched byte
for byte across a rebuild. The new cold-hydration fixture additionally verifies
absent additive version-1 fields and historical local IDs are never backfilled.

## Source versus loaded evidence

Core's finalized producer module was absent from compiled output. A durable test
loader resolves public package export facades to their source equivalents, with
`tsx` handling TypeScript. Production workflow code uses only package-root public
API detection. No private SDK submodule is imported or patched by workflow code.
The compiled-workflow loader maps test imports to the same digest-qualified graph
used by the frontend, not an unqualified duplicate module graph.

Retained fixture evidence contains actual public runtime provenance, recorder
status/counters, attempt records, and committed start/close observations. Runtime
origin is `source_unstamped`. This does not claim an installed CLI, loaded host
extension, packed compiled Core, or historical run now has this capability.

```text
/workspace/.yolo/durable/workflow-producer-red.log
/workspace/.yolo/durable/workflow-producer-targeted.log
/workspace/.yolo/durable/workflow-producer-core-source.log
/workspace/.yolo/durable/workflow-producer-core-compiled-wf.log
/workspace/.yolo/durable/workflow-producer-sdk099-compiled.log
/workspace/.yolo/durable/workflow-producer-sdk085-compiled.log
/workspace/.yolo/durable/workflow-producer-fuzzy-red.log
/workspace/.yolo/durable/workflow-producer-dist-before.txt
/workspace/.yolo/durable/workflow-producer-dist-after.txt
/workspace/.yolo/durable/workflow-producer-quality.log
/workspace/.yolo/durable/workflow-producer-docs.log
/workspace/.yolo/durable/workflow-producer-build.log
/workspace/.yolo/durable/workflow-producer-source-loader.mjs
/workspace/.yolo/durable/workflow-producer-evidence/source/http-sse.json
/workspace/.yolo/durable/workflow-producer-evidence/source/websocket-adapter.json
/workspace/.yolo/durable/workflow-producer-evidence/compiled-wf/http-sse.json
/workspace/.yolo/durable/workflow-producer-evidence/compiled-wf/websocket-adapter.json
```

Initial source-loader mapping used only a dotted distribution prefix and failed
on the TUI's undotted export. The harness was repaired without dependency edits.
A development-SDK loader probe initially assumed every dependency was hoisted;
its missing nested package was repaired by ordinary resolver fallback. A
name-matched model suffix regression failed before capture reused the actual
model-resolution result instead of the narrower display parser.
The HTTP assertion initially checked the wrong record kind (`attempt` rather than
Core's `api_attempt`); the fixture was corrected, not the production recorder.
The old synthetic-message fixture now checks the explicitly local observer UUID,
not falsely asserting a Core invocation ID on unsupported SDKs. These repaired
failures remain distinct from producer correctness evidence.

## Parent landing verification

The parent full gate passed 1,728 tests, with nine skipped and zero failures.
Quality, docs/context/guidance freshness, release verification (zero warnings),
and deterministic generated-file checks passed. Evidence:
`.yolo/durable/producer-parent/wf/`, task `78003e18`, in the parent workspace.

Fresh packed Core passed both source-workflow and compiled-workflow HTTP/SSE
and WebSocket-adapter tests with zero skips. The actual summary adapter passed
separately. Evidence: `.yolo/durable/producer-parent/packed-final/`, task
`1a91c190`. The temporary compiled fixture initially lacked `type: module`;
correcting that ESM boundary repaired its exit. The final run used no diagnostic
wrappers or forced exits. This proves local packaged integration, not activation
in an already-running host process.

## Remaining rollout

The parent full and packed consumer gates are complete. Actual host-loaded recorder activation, process refresh, and
real-provider checks are not performed here. Automatic inspector activation is
unconditionally disabled: Yolo version 2 is observational only, and version 1's
positive-proof interpretation is withdrawn. Neither record bytes nor an
apparently read-only mount authorize activation; resistance to privileged mount
replacement remains unproven. Do not commit or deploy the incomplete Yolo patch.
See the [repair record](repair.md) for fresh bounded checks. No historical backfill
is possible. Older SDKs intentionally retain null exact IDs and time-window
fallback; arbitrary auxiliary sessions remain unattributed.
