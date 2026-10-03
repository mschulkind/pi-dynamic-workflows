import { WORKFLOW_RUNTIME_BUILD_IDENTITY } from "../../dist/runtime-build.js";

/** Internal compiled fixtures must use the same module URLs as the shipped
 * frontend. Mixing unqualified roots with qualified dependencies duplicates
 * module-local state and does not exercise one production generation. */
export function compiledModuleUrl(name: string): string {
  return new URL(`../../dist/${name}?workflowBuild=${WORKFLOW_RUNTIME_BUILD_IDENTITY}`, import.meta.url).href;
}
