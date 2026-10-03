---
status: in-review
stage: BUILT
next: "Publish on the host and inspect newly recorded requests"
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
