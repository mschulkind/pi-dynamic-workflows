/**
 * Run tests against an installed pi instead of this repo's devDependency.
 *
 * node_modules pins one @earendil-works/pi-coding-agent; the pi that actually
 * loads this package is whichever one is installed (`npm i -g`). This loader
 * hook resolves every bare `@earendil-works/*` import to that installation:
 * `pi-coding-agent` itself, and its sibling packages (pi-ai, pi-agent-core,
 * pi-tui) from the copies it ships with, so the test and pi share one module
 * graph. Everything else resolves as usual.
 *
 *   PI_CODING_AGENT_PACKAGE=<dir>   the pi-coding-agent package directory
 *                                   (default: `$(npm root -g)/@earendil-works/pi-coding-agent`)
 *
 * Used by `npm run test:deployed-pi`. The hooks themselves are in
 * deployed-pi-hooks.mjs, which runs on the loader thread.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";

function piPackageDir() {
  const explicit = process.env.PI_CODING_AGENT_PACKAGE;
  if (explicit) return explicit;
  const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  return join(root, "@earendil-works", "pi-coding-agent");
}

const dir = piPackageDir();
const manifest = join(dir, "package.json");
if (!existsSync(manifest)) throw new Error(`deployed-pi-loader: no pi-coding-agent at ${dir}`);
const { version } = JSON.parse(readFileSync(manifest, "utf8"));
process.env.PI_DEPLOYED_PI_VERSION = version;
console.error(`[deployed-pi] @earendil-works/pi-coding-agent ${version} from ${dir}`);

register(new URL("./deployed-pi-hooks.mjs", import.meta.url), { data: { dir } });
