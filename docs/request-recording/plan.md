---
status: in-review
stage: BUILT
next: "Resolve the verification fixture Git boundary; see QA before continuing"
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
