# Repair plan

## Decisions

1. Extend cached verified identity with sequence and run identity. Keep
   generation, bytes, hash and event-file stamps as mandatory matches.
2. Copy preview value descriptors and summaries while preserving lazy getters.
   Give copies an opaque private revision token, independent of mutable fields.
3. Select navigator detail fields in one operation-local hydration and clone.
   Do not retain oversized records in the storage cache. Keep the navigator's
   single selected snapshot and journal result fallback semantics.
4. Include change time in preview file matching, without extra stat calls.
5. Measure owned storage functions, not global JSON or SDK monkeypatches.
   Use fixed numeric aggregate keys and asynchronous, bounded local output.
6. Rebuild tracked compiled modules and frontend identity together.

## Verification sequence

Observe failing regressions before the corresponding repairs, then run
storage/request-recording and navigator/reload/telemetry suites. Run build,
short checks, documentation/context/guidance/release verification. The parent
owns the full landing gate; this phase makes no commits or deployments.

[Implementation](implementation.md) records the resulting boundaries and
[QA](qa.md) records observed evidence, rather than treating this plan as proof.
