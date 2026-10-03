---
status: accepted
stage: CURRENT
---

# Public dispatch identity is available in Core source

This phase started on workflow main `4685d95`. The parent supplied the finalized
Core version-1 handoff. Its package-root helper returns a passive subscription
capability; the event exposes the final logical request and SDK invocation IDs
selected after authentication/header preparation. Transport attempts remain the
Core adapter's responsibility. [Contract](implementation.md) defines these IDs.

The workflow already wraps the documented public stream function, subscribes to
session events, and appends evidence through the committed run journal. Reuse
these boundaries rather than altering arguments, recording chunks twice, or
creating another scanner. The performance repair on the starting commit remains
untouched: alternating append/save still reads zero committed-log bytes in the
existing regression.

The dependency SDK is 0.85.1; the installed CLI package is 0.99.1. Both lack the
new helper. Core source is 1.0.0; its compiled producer module was absent during
this phase. Source execution can prove the contract but cannot attest that an
installed CLI or deployed extension loaded it. [QA](qa.md) separates the evidence.

## Read boundaries

Inspected the [recorder](../../src/request-recording.ts),
[agent](../../src/agent.ts), [model parser](../../src/model-spec.ts),
[recording and replay contract](../request-recording/implementation.md), activation
and health artifacts in that directory, and the
[actual SDK thinking test](../../tests/agent-thinking.test.ts).

The authoritative Core handoff and source were read only:

```text
/workspace/.forks/pi/docs/core-producer-runtime/implementation.md
/workspace/.forks/pi/packages/coding-agent/src/index.ts
/workspace/.forks/pi/packages/coding-agent/src/core/producer-observation.ts
/workspace/.forks/pi/packages/coding-agent/src/core/model-runtime.ts
/workspace/.forks/pi/packages/coding-agent/src/core/runtime-info.ts
```

No workflow launcher was available in this delegated child. Structured local
research, planning, implementation, and verification replace further delegation;
no other fork or root project file is written.
