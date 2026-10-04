// Resolve the host SDK through Pi's loader, but load our compiled ESM graph
// with import semantics. Requiring the graph makes import-only SDK subpaths
// fall through the host's prefix aliases as invalid file-system paths.
const host = await import("@earendil-works/pi-coding-agent");
const extension = await import(
  "../dist/pi-extension.js?workflowBuild=sha256:a69b5e91659669855309b6c77731dbf09ab85d2f958ebca01e47c86fd6a2615f"
);
// Every internal compiled dependency edge has this same build query.
// Stamped with the complete graph, not inferred from later disk/git state.
const expectedBuildIdentity = "sha256:a69b5e91659669855309b6c77731dbf09ab85d2f958ebca01e47c86fd6a2615f";
if (extension.WORKFLOW_RUNTIME_BUILD_IDENTITY !== expectedBuildIdentity) {
  extension.rejectLoadedWorkflowRuntime?.();
  throw new Error(
    "Workflow compiled graph is stale or unavailable. Restart Pi to load this build; affected work uses pause/journal recovery (legacy handoffs expire safely).",
  );
}
extension.installHostSessionCapture(host.AgentSession);
export const sessionFileCwd = extension.sessionFileCwd;
export default extension.default;
