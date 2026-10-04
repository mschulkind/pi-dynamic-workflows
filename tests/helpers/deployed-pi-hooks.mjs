/**
 * Loader-thread hooks for deployed-pi-loader.mjs: resolve every bare
 * `@earendil-works/*` import to the installed pi named by `data.dir`.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let piDir;

export function initialize(data) {
  piDir = data?.dir;
}

export async function resolve(specifier, context, nextResolve) {
  if (piDir && specifier.startsWith("@earendil-works/")) {
    // pi-coding-agent resolves from its own directory's parent; its siblings
    // from inside it, where npm installed the versions it was built with.
    const self =
      specifier === "@earendil-works/pi-coding-agent" || specifier.startsWith("@earendil-works/pi-coding-agent/");
    const parentURL = pathToFileURL(self ? join(piDir, "..", "..", "index.js") : join(piDir, "index.js")).href;
    return nextResolve(specifier, { ...context, parentURL });
  }
  return nextResolve(specifier, context);
}
