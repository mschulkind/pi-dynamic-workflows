---
status: in-review
stage: BUILT
next: "Human rollout and authorized real-work verification; see QA"
---

# Reuse workflow persistence rather than recording in prompts

**Status:** 2026-10-04, written against `ca31c8d`. MEASURED by targeted local SDK regressions. [Scope](implementation.md) wins on behavior; the tree wins on fact; this map is implementation advice.

| File | Change |
| :--- | :--- |
| [Request recorder](../../src/request-recording.ts) | New: public message observations and metadata schema. |
| [Agent](../../src/agent.ts) | Wrap public invocation function, subscribe before prompting, restore/close before disposal; inspect only public runtime health. |
| [Workflow](../../src/workflow.ts) | Attribute frames/calls/executions/attempts; replay provenance; embedding default sink. |
| [Record store](../../src/run-record-store.ts) and [persistence](../../src/run-persistence.ts) | Committed observation delta; preserve evidence during stale snapshots. |
| [Manager](../../src/workflow-manager.ts), [settings](../../src/workflow-settings.ts), [extension wiring](../../src/pi-extension.ts) | Default-on flag and supported opt-out. |
| [Exports](../../src/index.ts), [README](../../README.md), [regressions](../../tests/request-recording.test.ts) | Public types, discovery, targeted tests. |

## Constraints and reuse

- Reuse the committed-head protocol and writer serialization, not a second raw append file. Avoid ordinary staleness-gated manager snapshot callbacks for evidence from draining children.
- Reuse `hashAgentCall` identity, not a second prompt copy or authentication fingerprint.
- Use `createFauxCore` / `fauxRegistry` / fake-home fixtures with real `createAgentSession`; no network model calls.
- Do not touch protected capability/authoring files, dependency locks, scanner, or the separate core fork.

## Build order

1. Write failing recording regressions; observe missing implementation failure.
2. Add observer plus persistence delta; pass focused recording tests and no-emit typecheck.
3. Wire default-on settings, call attribution, and replay; verify real SDK paths and aggregate regressions.
4. Run targeted quality checks, document evidence, leave source uncommitted for review. Full gates and tracked build verification follow fixes to review findings.


## Coherent activation repair on current main

1. Reproduce incompatible same-version retention and silent append/observer failures first, retaining failed-before-fixed logs.
2. Stamp the compiled graph with [loaded-build identity](implementation.md#activation-and-local-diagnostics), preserve same-build handoff, and reuse existing incompatible-runtime pause/journal recovery for legacy/changed builds. Isolate every internal compiled dependency URL, not only the identity module, so partial caches cannot be mislabeled; retain a mismatch fallback.
3. Reuse the observation emitter and existing local logger for closed recording-health reasons; report unsupported sinks, initialization/callback failures, and thrown/rejected/false appends without leaking errors into prompts.
4. Verify realistic frontend adoption/fallback and local faux-SDK recording, opt-out, accounting, and handoff safety. Fixture HOME/TMPDIR belong under `/tmp` outside every Git repository; durable evidence belongs under the workspace durable directory.
5. Implementation left source and tracked build uncommitted for review. The authorized verification phase repairs independent findings, runs the full landing gate and faux-SDK matrix, and lands one coherent commit. Host rollout/live validation remain outside this task.
