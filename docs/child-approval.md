# Workflow child approval

The runtime automatically inherits a registered parent Auto Mode authority.
This is independent of `providerMiddlewareExtensions`, tool selection, child
settings, or injected resource loaders. It does not load a second Auto Mode
extension or enable Auto Mode in an otherwise ungated jail.

## Ownership and API

**ChildApprovalBridgeV1** (coined in the integration design) is a process-local
callback interface connecting a root session's approval policy to cooperating
SDK children. It is not a sandbox. Auto Mode owns the policy and consent;
workflows own attachment and cleanup.

The shared slot and consumed operations are:

```typescript
Symbol.for("@mschulkind/pi-child-approval")
// version: 1
lookupRoot(parentSessionManager) // absent | available | unavailable
openChildGuard(parentSessionManager, { childId, sessionId, runId })
guard.evaluate({ toolName, toolCallId, parentToolCallId?, input, cwd, signal? })
guard.close()
```

V1 provides no trusted execution identity: a tool name or inside-cwd path
cannot prove that the executor is a native builtin. The adapter sends neither
builtin provenance assertions nor exemption hints. The repaired Auto Mode gate
classifies delegated native tools and custom name collisions alike; root-only
implicit exemptions do not extend to children. Explicit permissions still apply.

Only explicit `allow` continues execution. Blocking decisions, exceptions,
malformed responses, missing required authority, and incompatible registries
block execution or reject admission. The parent key is the actual session-manager
object, never a filename, cwd, child task, or most recently registered parent.
The packages do not need to share an imported module instance.

The Pi extension supplies this identity automatically through the manager's
host-owned scope. Nested workflows, retries, background runs, and resumed runs
use that scope; each child turn opens its own guard. Standalone SDK hosts supply
`WorkflowAgentOptions.parentSessionManager`; manager hosts call
`setParentSessionManager` for explicit lifecycle handoff. The internal
`childApprovalScope` carries this authority across run frames. Neither is a
workflow-script argument or a model-facing tool parameter. Explicit
`session.sessionManager` supplies the **child**, not the parent identity.

## Enforcement and lifecycle

A synthetic hook-only extension is appended **last** to the final resource
loader before SDK creation and extension binding. Successful binding is checked
against the actual child session manager before prompting. Earlier middleware
input mutations are therefore reviewed; earlier blocks remain final.
All model-issued tools, including custom and structured-output tools, pass
through Pi's tool hooks. Native Pi 0.99 nested `ctx.executeTool()` calls pass
through the same hook and retain their nested parent-call attribution.

Guarded loaders are session-local, even with empty middleware settings.
An injected loader cannot omit the final hook. Its extension runtime must be
fresh: reuse of a runtime previously used by this workflow module is rejected,
not repaired by copying extension arrays with shared session-bound closures.
Guarded child resource reload is unsupported and rejects rather than discarding
the hook. Extension-free, ungated loaders retain their existing sharing behavior.

Every decision rechecks registry identity, root availability, cancellation,
child binding, and action identity after awaiting the gate. Auto Mode remains
responsible for live mode/configuration/session overrides and policy revisions;
it invalidates pending grants on changes, including ON→OFF→ON. Child OFF or
ON ask decisions have no manual approval transport and deny, even if the parent
has UI. No fabricated UI or workflow checkpoint default supplies consent.

Parent shutdown and session-start handoff immediately close existing guards,
including same-object reload. Retained runs acquire the explicitly bound
destination authority for subsequent children; already admitted children remain
revoked, not silently reauthorized. Setup/bind failure, cancellation, thread-turn
completion, and shutdown close guards idempotently. Missing or unavailable
required authority never degrades into an ungated retry.

Instruction evidence comes only from the destination root
`before_agent_start` event with structured `systemPromptOptions.contextFiles`.
Before that snapshot exists, delegated calls requiring classification block
without invoking the classifier. Child prompts cannot refresh it. An explicit
root-owned empty array is valid; absent options are not a fresh snapshot.

## No gate and limitations

A missing slot preserves ordinary behavior only before the scope has required a
gate. An explicit `absent` lookup for an identified parent also preserves ordinary
behavior. Without parent identity, an ambient registry must positively report
absence; ambiguous ownership is rejected. An unavailable or invalid registry is
not absence, even if the slot disappears after failed admission.

This protects cooperating Pi tool pipelines, not arbitrary executable code:
trusted extensions, injected tools, providers, workflow JavaScript, and SDK hosts
can execute operating-system actions directly. Direct subprocess execution inside
a custom tool is covered by approval of that tool's complete input, not by separate
approval of each implementation statement. Custom agent runners replacing
`WorkflowAgent` own their own enforcement. The runtime cannot prove an injected
extension runtime was never bound by unrelated code outside this module.

A grant does not cover mutations after the final hook returns, or revoke an
operating-system action already executing. Middleware and loaders must remain
trusted. Policy files follow Auto Mode's reload semantics; there is no filesystem
watcher. Registering a new gate does not retroactively guard children admitted
while their parent had no gate. Process-local callbacks do not protect against
malicious extensions replacing global state. Operating-system isolation is a
separate boundary.

## Verification

[Child approval tests](../tests/child-approval.test.ts) import the committed
production runtime and use actual SDK sessions,
local fake providers, and execution spies. The original reproduction wraps the
original bash tool and runs only a syntax-checking `bash -n` probe; the service
command in its heredoc is never executed.

The normal suite exercises attachment without requiring Auto Mode as a dependency.
Cross-fork verification additionally loads the committed gate owner's test helpers
with local classifier callbacks. The
[production execution test](../tests/child-approval-production.test.ts) loads the
actual gate extension into real SDK root sessions and obtains instruction
snapshots from actual root prompts, not helper-emitted events. It verifies
custom `read`/`write`/`edit` collisions and original native implementations with
execution spies, then switches the parent from project A to B before B prompts.
On native Pi, an allowed outer tool also calls a custom `read` through
`ctx.executeTool`; the actual gate classifies and blocks that nested executor.
Pi versions exposing `AgentSessionRuntime` use its actual `switchSession`
operation; older SDKs fall back to disposal and recreation. No classifier receives A instructions after handoff.

Run the cross-fork checks after building the committed output:

```bash
npm run build
DW_AUTOMODE_TEST_HELPERS=/path/to/pi-automode/tests/test-helpers.ts \
  npx tsx --test tests/child-approval*.test.ts tests/middleware-isolation.test.ts
```

Run this against native Pi 0.99 with `DW_REQUIRE_NESTED=1` to require nested-call
coverage rather than skipping it on older hosts. No cloud calls are required.
The native integration checks include live ON/OFF/configuration, stale pending
mode/reload/model/shutdown decisions, custom loaders, concurrency, cancellation,
thread reuse, nested workflows/tools, separate parent identities, and cleanup.
