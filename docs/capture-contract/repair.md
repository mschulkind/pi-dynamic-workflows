---
status: in-review
stage: BUILT
next: Parent packed-Core and full landing gates; no deployment in this phase
---

# Serial integration repair

## Scope and result

The workflow implementation needed no further public API change. Its existing
namespace-based capability detection and passive subscription match Core's
finalized [capture contract](implementation.md). Earlier owner edits and source
history remain intact. Core and Yolo were not modified. No commit, push, deploy,
restart, install mutation, paid-provider traffic, or analytics/scanner edit ran.

The matt owner repaired the actual workflow glyph mismatch and migrated the
existing thinking-summary call to Core's capable public ModelRegistry boundary.
Auxiliary IDs identify intended summary generations, not assistant work or wire
attempts. Actual new summaries receive distinct IDs; cached/restored summaries
emit no dispatch. Unsupported SDKs retain unknown identity and one legacy call;
failed capable calls never add a legacy retry. Summary accounting and policy are
preserved. The root migration record owns that adapter's detailed evidence.

## Fresh evidence

- Three targeted workflow files passed: 25 tests with development SDK 0.85.1,
  then the same 25 with final public source Core, then compiled workflow with
  public source Core: zero skips on all three runs. Covers final dispatch
  identity, auxiliary isolation, unavailable reasoning, old-schema hydration,
  recording fallback, accounting, and the existing append/save performance check.
- Workflow TypeScript/stamped build passed twice. SHA-256 manifests for all 119
  distribution/frontend files matched byte for byte across the rebuild.
- Root adapter regression imported actual workflow source, then actual compiled
  delivery code. Both success/failure/pause checks passed. Raw failure payloads
  remain in detail, not hints. The fixture failed against the original adapter.
- The actual public Core/ModelRegistry faux-provider fixture passed: two distinct
  auxiliary logical IDs and dispatch IDs, owning-session attribution, passive
  callback failure isolation, and no cached/restored dispatch. No paid endpoint
  was reached. This is public source Core evidence, not packed compiled Core.
- Root's bounded migration runner passed 23 tests; summary TypeScript, installed
  extension loading, matt tests, Pi settings, pack lint, and whitespace passed.

Retained evidence:

```text
/workspace/.yolo/durable/producer-migration-fix/wf-targeted.log
/workspace/.yolo/durable/producer-migration-fix/wf-public-source.log
/workspace/.yolo/durable/producer-migration-fix/wf-public-compiled.log
/workspace/.yolo/durable/producer-migration-fix/wf-build.log
/workspace/.yolo/durable/producer-migration-fix/wf-rebuild.log
/workspace/.yolo/durable/producer-migration-fix/wf-dist-before.txt
/workspace/.yolo/durable/producer-migration-fix/wf-dist-after.txt
/workspace/.yolo/durable/producer-migration-fix/root-targeted.log
/workspace/.yolo/durable/producer-migration-fix/public-summary.log
```

The standalone public-summary harness initially attempted an unavailable shutdown
method; cleanup was corrected to the real public flush method and rerun. No
production API depended on that mistaken fixture call. The older-declaration
TypeScript check initially rejected an inline additive options field; a structural
options variable repaired compatibility without weakening runtime detection.

## Blocking parent gates

Full applicable source/package, Core build/check/suites and packed SDK/CLI loading,
workflow full release gate, Bun loading, root full checks, every selected pack's
host lint/render, real terminal rendering, and authorized install/reload behavior
remain parent work. The manifests establish reproducible workflow artifacts only;
they do not attest loaded Core or dependency-graph freshness. No new HTTP/SSE or
socket fixture evidence was generated here; earlier artifacts remain historical.

Automatic inspector enablement must remain disabled independently of every v1/v2
record. Yolo version 2 is observational only; withdrawn version 1 private claims,
read-only delivery, environment/configuration, and process namespaces cannot
supply security proof. Privileged mount-replacement resistance remains unproven.
Core's owner added permanent forged-record tests; this writer neither modifies
nor claims to rerun them. The incomplete Yolo patch must not be committed or
deployed. Production rollout remains unauthorized.
