---
status: in-review
stage: BUILT
next: "Human rollout and authorized real production verification"
---

# Recording implementation is locally verified

**Status:** 2026-10-04. MEASURED by local faux-SDK tests; review defects have regression coverage; see [QA](qa.md) for landing verification. [Scope](implementation.md) and [QA](qa.md) own behavior and evidence.

- [x] Recheck persistent sessions versus compact history before instrumentation.
- [x] Write and observe failing regressions before the recording implementation.
- [x] Add metadata-only public event observer and committed persistence append.
- [x] Attribute nested frames, attempts, threads, retries, and non-request replay.
- [x] Wire supported default-on recording and explicit opt-out.
- [x] Verify targeted tests and source quality; preserve uncommitted source for review.
- [x] Address independent review: synthetic message/invocation identity, transient initialization, coherent warm append cache.
- [x] Run full local gates, verify tracked build consistency, and validate installed/built SDK compatibility.
- [ ] Human deployment and any permitted real-provider verification (outside this task).


## Activation repair follow-up

- [x] Observe same-version retention and silent rejection/callback regressions fail before repair.
- [x] Add deterministic compiled identity, source-generation identity, and frontend cached-graph fallback without changing Pi core or scanner.
- [x] Preserve compatible manager/effort identity and existing replacement/cwd/TTL/version/pending-delivery safety.
- [x] Add bounded local health diagnostics; keep defaults, aggregates, transcripts, and model-context exclusions unchanged.
- [x] Add targeted frontend, sink, initialization/callback, fallback, healthy, and opt-out coverage; move recording fixtures outside Git repositories.
- [x] Reproduce and repair partial-cache identity mislabeling with complete compiled module-URL isolation.
- [x] Verify real compiled in-flight promise preservation, pending delivery, and changed/legacy journal pause/resume.
- [x] Complete the full-suite sweep, focused gate repairs, contributor checks, deterministic rebuild, and SDK matrix; see QA for exact results/skips.
- [x] Review source, tests, docs, and generated distribution as one coherent activation/diagnostics outcome for landing.
- [ ] Authorized real production activation/hydration check after human publication and process refresh.
