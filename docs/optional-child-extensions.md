# Optional child extensions

An optional child extension is an observer, such as a metrics recorder, that a host adds to every child session it
creates. It is a cross-package convention shared with pi-subagents, so an extension registers without importing either
package:

```ts
const key = Symbol.for("pi.optional-child-extensions.v1");
const registry = (globalThis[key] ??= new Map());
registry.set("my-recorder", {
  paths: { "pi-dynamic-workflows": "/abs/child-workflow.ts", "pi-subagents": "/abs/child-subagent.ts" },
  path: "/abs/child.ts", // used by a host the entry does not name in `paths`
});
```

Whoever registers first creates the `Map`. Every workflow child loads `paths["pi-dynamic-workflows"] ?? path` of every
entry. An entry that names only other hosts is skipped. The one exception is an SDK caller that injects its own
`session.resourceLoader`: that loader is used as given.

## Rules

- **Observers, not capabilities.** Entries load regardless of the default `noExtensions: true` and of the
  `providerMiddlewareExtensions` allowlist, and after the allowlisted middleware. The recursive-orchestration exclusion
  does not apply to them either: the registrant is trusted in-process code and decides what it registers.
- **Deduplication.** An entry whose realpath matches an allowlisted middleware path, or an earlier entry, is skipped.
- **Fail-open.** A non-`Map` registry (including a Proxy that throws when inspected), a key that cannot be printed, a
  malformed entry, a relative or missing path, an import or factory error, and a throwing or rejecting handler never
  fail a child. Each becomes a `[workflow]` warning, printed once per process. Handlers are wrapped so that even a
  throwing `tool_call` handler, which Pi itself does not isolate, cannot block a tool. The wrapping applies when Pi
  reads a handler, so it also covers handlers registered later through `pi.on` (for example from `session_start`), and
  the unsubscribe function `pi.on` returns keeps working.
- **Timing.** The registry is read when each child session is created, and entries load with the child's extensions,
  before `session_start`. The child's extensions are bound with `bindExtensions({})`, so `ctx.hasUI` is false.

## Shared resource loaders stay shared

Without middleware, workflow children share one extension-free resource loader per directory (#109): skills, prompts,
and context files are loaded once. Optional extensions do not change that. Each child gets a view of the shared loader
whose `getExtensions()` adds the child's optional extensions, loaded by a second loader that discovers nothing else
(in-memory settings, no skills, prompts, themes, or context files). The child's extension runtime is that per-child
runtime, so actions such as `pi.appendEntry` stay bound to their own child.

When middleware is configured, or a child is guarded by
[child approval](child-approval.md), the loader is already session-local; entries are added to it directly.

## Module state

Pi caches an extension module's factory per process, and workflow children do not reset that cache. Two children call
the same factory, but share the module's top-level state. Keep per-session state inside the factory.
