import { type LoadExtensionsResult, type ResourceLoader } from "@earendil-works/pi-coding-agent";
export declare const OPTIONAL_CHILD_EXTENSIONS_KEY: unique symbol;
/** This package's host name in the registry's per-host `paths`. */
export declare const PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST = "pi-dynamic-workflows";
/** One registry value. `paths[host]` wins over `path` for that host. */
export interface OptionalChildExtensionEntry {
    paths?: Record<string, string>;
    path?: string;
}
export interface OptionalChildExtension {
    /** The registry key, for diagnostics. */
    id: string;
    /** The absolute path the entry named; this is the path the loader imports. */
    path: string;
    /** Its canonical path, used for deduplication and for matching loader results. */
    realPath: string;
}
export interface OptionalChildExtensionResolution {
    extensions: OptionalChildExtension[];
    /** Human-readable reasons an entry was skipped. Never fatal. */
    diagnostics: string[];
}
/**
 * Select this host's optional extensions for one child.
 *
 * `loadedPaths` are the extension paths the child already loads; an entry whose
 * canonical path matches one of them, or an earlier entry, is dropped so the
 * same file never loads twice. Never throws: whatever another extension put in
 * the registry, the worst outcome is a diagnostic.
 */
export declare function resolveOptionalChildExtensions(host: string, loadedPaths?: readonly string[], cwd?: string): OptionalChildExtensionResolution;
type Handler = (...args: never[]) => unknown;
/** Minimal view of a pi `Extension` this module touches. */
interface LoadedExtensionLike {
    path: string;
    resolvedPath?: string;
    handlers: Map<string, Handler[]>;
}
/**
 * Make an optional extension's event handlers unable to affect the child: a
 * handler that throws or rejects is reported and treated as returning nothing.
 * Pi already isolates most handler errors, but not all (a throwing `tool_call`
 * handler fails the tool call), and an observer must never change the run.
 * Handlers that succeed keep their return value and their sync/async shape.
 *
 * The wrapping happens when a handler is read, not once up front, so it also
 * covers handlers the extension registers later through `pi.on` (from
 * `session_start`, say). The map keeps pi's own handler arrays and the
 * original handlers in them: reads go through a view that hands out one
 * memoized wrapper per original, and writes through that view store the
 * original again. So pi's `on()` (`get`, `push`, `set`) and the unsubscribe
 * it returns (`get`, `indexOf`, `splice`, `delete`) keep working unchanged.
 */
export declare function isolateOptionalExtensionHandlers(extension: LoadedExtensionLike, report: (event: string, error: unknown) => void): void;
/**
 * Report a diagnostic once per process. A broken observer would otherwise warn
 * for every child of every run.
 */
export declare function warnOptionalChildExtension(message: string): void;
/** @internal Tests reset the once-per-process memory. */
export declare function resetOptionalChildExtensionWarnings(): void;
/** Every path an optional extension may appear under in loader results. */
export declare function optionalPathSet(optional: readonly OptionalChildExtension[]): Set<string>;
/**
 * Split a loader result into the optional extensions it carries and the rest,
 * isolating the optional extensions' handlers. Used as (part of) a loader's
 * `extensionsOverride`.
 */
export declare function partitionOptionalExtensions(result: LoadExtensionsResult, optionalPaths: ReadonlySet<string>): {
    rest: LoadExtensionsResult;
    optional: LoadExtensionsResult["extensions"];
};
/** Warn about every load error of an optional extension; none of them is fatal. */
export declare function reportOptionalLoadErrors(result: LoadExtensionsResult, optionalPaths: ReadonlySet<string>): void;
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
export declare function withOptionalChildExtensions(base: ResourceLoader, optional: readonly OptionalChildExtension[], options: {
    cwd: string;
    agentDir: string;
}): Promise<ResourceLoader>;
export {};
