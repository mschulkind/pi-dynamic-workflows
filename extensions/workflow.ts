// Resolve the host SDK through Pi's loader, but load our compiled ESM graph
// with import semantics. Requiring the graph makes import-only SDK subpaths
// fall through the host's prefix aliases as invalid file-system paths.
const host = await import("@earendil-works/pi-coding-agent");
const extension = await import(
  "../dist/pi-extension.js?workflowBuild=sha256:2d8e7cb7c269cf9a1336216b3646528b36ffc8595d2e268c10a1117614f035c7"
);
// Every internal compiled dependency edge has this same build query.
// Stamped with the complete graph, not inferred from later disk/git state.
const expectedBuildIdentity = "sha256:2d8e7cb7c269cf9a1336216b3646528b36ffc8595d2e268c10a1117614f035c7";
if (extension.WORKFLOW_RUNTIME_BUILD_IDENTITY !== expectedBuildIdentity) {
  extension.rejectLoadedWorkflowRuntime?.();
  throw new Error(
    "Workflow compiled graph is stale or unavailable. Restart Pi to load this build; affected work uses pause/journal recovery (legacy handoffs expire safely).",
  );
}
extension.installHostSessionCapture(host.AgentSession);
export const sessionFileCwd = extension.sessionFileCwd;
export default extension.default;
