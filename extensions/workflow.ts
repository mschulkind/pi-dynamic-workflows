// Resolve the host SDK through Pi's loader, but load our compiled ESM graph
// with import semantics. Requiring the graph makes import-only SDK subpaths
// fall through the host's prefix aliases as invalid file-system paths.
const host = await import("@earendil-works/pi-coding-agent");
const extension = await import(
  "../dist/pi-extension.js?workflowBuild=sha256:29c2c2a9bf931d4bdf4c3f8cd30bda919963490b5665ee3959f68c834c37f974"
);
// Every internal compiled dependency edge has this same build query.
// Stamped with the complete graph, not inferred from later disk/git state.
const expectedBuildIdentity = "sha256:29c2c2a9bf931d4bdf4c3f8cd30bda919963490b5665ee3959f68c834c37f974";
if (extension.WORKFLOW_RUNTIME_BUILD_IDENTITY !== expectedBuildIdentity) {
  extension.rejectLoadedWorkflowRuntime?.();
  throw new Error(
    "Workflow compiled graph is stale or unavailable. Restart Pi to load this build; affected work uses pause/journal recovery (legacy handoffs expire safely).",
  );
}
extension.installHostSessionCapture(host.AgentSession);
export const sessionFileCwd = extension.sessionFileCwd;
export default extension.default;
