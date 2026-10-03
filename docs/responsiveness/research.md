# Responsiveness repair scope

## Evidence and limits

The preceding read-only audit ran against main at `c0b34a1`. Its durable
report and reproduction fixtures remain outside this checkout:

```text
/workspace/.yolo/durable/responsiveness-workflow-audit/audit.md
/workspace/.yolo/durable/responsiveness-workflow-audit/metrics-final.json
/workspace/.yolo/durable/responsiveness-workflow-audit/metrics-ui.json
```

It reproduced eight event-log replays for one oversized cold phase selection,
mutable list previews, inconsistent warm/cold sequence validation, and
coarse-mtime preview reuse. List/panel frames read zero event bytes. Observation
growth amplified saves, and large result rendering stalled independently.

There was no JavaScript CPU profile of the slow target. These mechanisms are
not a diagnosis of its stall. Historical runs had no workflow performance
capture; its absence cannot establish that a mechanism was inactive.

## Selected work

Repair only the cold selection amplification and independently reproduced
cache/preview correctness defects. Add private, opt-in storage measurements.
Keep the existing storage format, caps, full reads, delivery markers, request
metadata, leases, retention, and accounting contracts.

Save-delta APIs, authenticated checkpoints, large-body viewport rendering,
live-summary redesign, and core UI instrumentation are deferred. Raising a
cache cap or hiding active work is not a remedy.

## Defined terms

**Hydration** follows the existing storage vocabulary: reconstructing a full
run from its committed log prefix, not merely reading its routing fields.
A **preview** is a routing/status view with lazy detail fields, not evidence
that a replay is valid. The [storage protocol](../run-storage.md) defines the
commit and recovery behavior.
