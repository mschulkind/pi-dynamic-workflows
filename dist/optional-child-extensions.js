/**
 * Optional child extensions: a cross-package, fail-open registry of observer
 * extensions that a host adds to every child session it creates.
 *
 * The convention is shared with pi-subagents and owned by neither package, so
 * it lives on `globalThis` under a `Symbol.for` key that any extension can reach
 * without importing this module:
 *
 *   globalThis[Symbol.for("pi.optional-child-extensions.v1")]
 *     = Map<id, { paths?: { [host]: absolutePath }, path?: absolutePath }>
 *
 * Whoever registers first creates the Map. This host loads
 * `paths["pi-dynamic-workflows"] ?? path` of every entry into each workflow
 * child, regardless of the `providerMiddlewareExtensions` allowlist and of the
 * default `noExtensions: true`: entries are observers (metrics, recording), not
 * capabilities.
 *
 * Nothing about an entry can fail a child. A malformed registry, a malformed
 * entry, a relative or missing path, a load error, and a throwing handler all
 * become one-time `[workflow]` warnings.
 */
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager, } from "@earendil-works/pi-coding-agent";
export const OPTIONAL_CHILD_EXTENSIONS_KEY = Symbol.for("pi.optional-child-extensions.v1");
/** This package's host name in the registry's per-host `paths`. */
export const PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST = "pi-dynamic-workflows";
function isLocalExtensionSpec(spec) {
    return !spec.startsWith("builtin:") && !spec.startsWith("<") && !/^(?:npm|git|https?|ssh):/.test(spec);
}
function canonicalPath(spec, cwd) {
    const absolute = resolve(cwd, spec);
    try {
        return realpathSync(absolute);
    }
    catch {
        return absolute;
    }
}
function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Select this host's optional extensions for one child.
 *
 * `loadedPaths` are the extension paths the child already loads; an entry whose
 * canonical path matches one of them, or an earlier entry, is dropped so the
 * same file never loads twice. Never throws.
 */
export function resolveOptionalChildExtensions(host, loadedPaths = [], cwd = process.cwd()) {
    let registry;
    try {
        registry = globalThis[OPTIONAL_CHILD_EXTENSIONS_KEY];
    }
    catch (error) {
        return { extensions: [], diagnostics: [`optional child extension registry is unreadable: ${describe(error)}`] };
    }
    if (registry === undefined)
        return { extensions: [], diagnostics: [] };
    if (!(registry instanceof Map)) {
        return { extensions: [], diagnostics: ["optional child extension registry ignored: it is not a Map"] };
    }
    const seen = new Set();
    for (const loaded of loadedPaths) {
        if (typeof loaded === "string" && loaded && isLocalExtensionSpec(loaded))
            seen.add(canonicalPath(loaded, cwd));
    }
    const extensions = [];
    const diagnostics = [];
    let entries;
    try {
        entries = [...registry.entries()];
    }
    catch (error) {
        return { extensions: [], diagnostics: [`optional child extension registry is unreadable: ${describe(error)}`] };
    }
    for (const [key, entry] of entries) {
        const id = String(key);
        try {
            if (!entry || typeof entry !== "object") {
                diagnostics.push(`optional child extension '${id}' ignored: its entry is not an object`);
                continue;
            }
            const { paths, path: fallback } = entry;
            const hostPath = paths && typeof paths === "object" ? paths[host] : undefined;
            const selected = hostPath ?? fallback;
            // An entry that names other hosts only is not for this host.
            if (selected === undefined)
                continue;
            if (typeof selected !== "string" || !selected || selected.includes("\0")) {
                diagnostics.push(`optional child extension '${id}' ignored: its path for '${host}' is not a non-empty string`);
                continue;
            }
            if (!isAbsolute(selected)) {
                diagnostics.push(`optional child extension '${id}' ignored: '${selected}' is not an absolute path`);
                continue;
            }
            let realPath;
            try {
                realPath = realpathSync(selected);
                if (!statSync(realPath).isFile())
                    throw new Error("not a file");
            }
            catch (error) {
                diagnostics.push(`optional child extension '${id}' not loaded: '${selected}' is not a readable file (${describe(error)})`);
                continue;
            }
            if (seen.has(realPath))
                continue;
            seen.add(realPath);
            extensions.push({ id, path: selected, realPath });
        }
        catch (error) {
            diagnostics.push(`optional child extension '${id}' ignored: ${describe(error)}`);
        }
    }
    return { extensions, diagnostics };
}
/**
 * Make an optional extension's event handlers unable to affect the child: a
 * handler that throws or rejects is reported and treated as returning nothing.
 * Pi already isolates most handler errors, but not all (a throwing `tool_call`
 * handler fails the tool call), and an observer must never change the run.
 * Handlers that succeed keep their return value and their sync/async shape.
 */
export function isolateOptionalExtensionHandlers(extension, report) {
    for (const [event, handlers] of extension.handlers) {
        extension.handlers.set(event, handlers.map((handler) => {
            const isolated = (...args) => {
                try {
                    const result = handler(...args);
                    if (result && typeof result.then === "function") {
                        return Promise.resolve(result).catch((error) => {
                            report(event, error);
                            return undefined;
                        });
                    }
                    return result;
                }
                catch (error) {
                    report(event, error);
                    return undefined;
                }
            };
            return isolated;
        }));
    }
}
const warned = new Set();
/**
 * Report a diagnostic once per process. A broken observer would otherwise warn
 * for every child of every run.
 */
export function warnOptionalChildExtension(message) {
    if (warned.has(message))
        return;
    warned.add(message);
    console.warn(`[workflow] ${message}`);
}
/** @internal Tests reset the once-per-process memory. */
export function resetOptionalChildExtensionWarnings() {
    warned.clear();
}
function isOptionalPath(extensionPath, optionalPaths) {
    if (!extensionPath)
        return false;
    if (optionalPaths.has(extensionPath))
        return true;
    try {
        return optionalPaths.has(realpathSync(extensionPath));
    }
    catch {
        return false;
    }
}
/** Every path an optional extension may appear under in loader results. */
export function optionalPathSet(optional) {
    return new Set(optional.flatMap(({ path, realPath }) => [path, realPath]));
}
/**
 * Split a loader result into the optional extensions it carries and the rest,
 * isolating the optional extensions' handlers. Used as (part of) a loader's
 * `extensionsOverride`.
 */
export function partitionOptionalExtensions(result, optionalPaths) {
    if (optionalPaths.size === 0)
        return { rest: result, optional: [] };
    const optional = [];
    const rest = [];
    for (const extension of result.extensions) {
        if (isOptionalPath(extension.resolvedPath, optionalPaths) || isOptionalPath(extension.path, optionalPaths)) {
            isolateOptionalExtensionHandlers(extension, (event, error) => warnOptionalChildExtension(`optional child extension ${extension.path} failed in ${event}: ${describe(error)} (ignored)`));
            optional.push(extension);
        }
        else {
            rest.push(extension);
        }
    }
    return { rest: { ...result, extensions: rest }, optional };
}
/** Warn about every load error of an optional extension; none of them is fatal. */
export function reportOptionalLoadErrors(result, optionalPaths) {
    if (optionalPaths.size === 0)
        return;
    for (const { path, error } of result.errors) {
        if (isOptionalPath(path, optionalPaths)) {
            warnOptionalChildExtension(`optional child extension not loaded: ${path}: ${error}`);
        }
    }
}
/**
 * Give one child a view of an extension-free shared resource loader that also
 * carries the child's optional extensions, without giving up the sharing.
 *
 * The shared loader's skills, prompts, themes, and context files stay shared;
 * only the optional extensions load per child, through a second loader that
 * discovers nothing else (in-memory settings, no skills, prompts, themes, or
 * context files). The child's extension runtime is that per-child loader's
 * fresh runtime, so extension actions such as `pi.appendEntry` stay bound to
 * this child. The base loader must carry no extensions of its own: theirs would
 * be bound to the base runtime, which this view replaces; such a base is
 * returned unchanged with a warning.
 */
export async function withOptionalChildExtensions(base, optional, options) {
    if (optional.length === 0)
        return base;
    if (base.getExtensions().extensions.length > 0) {
        warnOptionalChildExtension("optional child extensions skipped: this child's resource loader already carries extensions");
        return base;
    }
    const optionalPaths = optionalPathSet(optional);
    const overlay = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: options.agentDir,
        settingsManager: SettingsManager.inMemory(),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: optional.map(({ path }) => path),
        extensionsOverride: (result) => {
            const { rest, optional: loaded } = partitionOptionalExtensions(result, optionalPaths);
            return { ...rest, extensions: [...rest.extensions, ...loaded] };
        },
    });
    try {
        await overlay.reload();
    }
    catch (error) {
        warnOptionalChildExtension(`optional child extensions not loaded: ${describe(error)}`);
        return base;
    }
    let merged;
    const view = () => {
        if (merged)
            return merged;
        const shared = base.getExtensions();
        const own = overlay.getExtensions();
        reportOptionalLoadErrors(own, optionalPaths);
        merged = {
            ...shared,
            extensions: [...shared.extensions, ...own.extensions],
            errors: [...shared.errors, ...own.errors],
            runtime: own.runtime,
        };
        return merged;
    };
    view();
    return new Proxy(base, {
        get(target, key) {
            if (key === "getExtensions")
                return view;
            if (key === "reload") {
                return async (...args) => {
                    await target.reload(...args);
                    await overlay.reload();
                    merged = undefined;
                };
            }
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
