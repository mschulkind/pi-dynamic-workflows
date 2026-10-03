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
import {
  DefaultResourceLoader,
  type LoadExtensionsResult,
  type ResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export const OPTIONAL_CHILD_EXTENSIONS_KEY = Symbol.for("pi.optional-child-extensions.v1");

/** This package's host name in the registry's per-host `paths`. */
export const PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST = "pi-dynamic-workflows";

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

function isLocalExtensionSpec(spec: string): boolean {
  return !spec.startsWith("builtin:") && !spec.startsWith("<") && !/^(?:npm|git|https?|ssh):/.test(spec);
}

function canonicalPath(spec: string, cwd: string): string {
  const absolute = resolve(cwd, spec);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function describe(error: unknown): string {
  // A thrown value can be anything, including a null-prototype object that
  // String() cannot convert, so describing it must not throw either.
  try {
    const text: unknown = error instanceof Error ? error.message : error;
    return typeof text === "string" ? text : String(text);
  } catch {
    return "<unprintable error>";
  }
}

/** A registry key as text. Keys can be anything a Map holds, including null-prototype objects. */
function describeKey(key: unknown): string {
  try {
    return typeof key === "symbol" ? key.toString() : String(key);
  } catch {
    return "<unprintable key>";
  }
}

function unreadable(error: unknown): OptionalChildExtensionResolution {
  return { extensions: [], diagnostics: [`optional child extension registry is unreadable: ${describe(error)}`] };
}

/**
 * Select this host's optional extensions for one child.
 *
 * `loadedPaths` are the extension paths the child already loads; an entry whose
 * canonical path matches one of them, or an earlier entry, is dropped so the
 * same file never loads twice. Never throws: whatever another extension put in
 * the registry, the worst outcome is a diagnostic.
 */
export function resolveOptionalChildExtensions(
  host: string,
  loadedPaths: readonly string[] = [],
  cwd: string = process.cwd(),
): OptionalChildExtensionResolution {
  try {
    return resolveFromRegistry(host, loadedPaths, cwd);
  } catch (error) {
    return unreadable(error);
  }
}

function resolveFromRegistry(
  host: string,
  loadedPaths: readonly string[],
  cwd: string,
): OptionalChildExtensionResolution {
  let registry: unknown;
  try {
    registry = (globalThis as Record<PropertyKey, unknown>)[OPTIONAL_CHILD_EXTENSIONS_KEY];
  } catch (error) {
    return unreadable(error);
  }
  if (registry === undefined) return { extensions: [], diagnostics: [] };
  let isMap: boolean;
  try {
    // A Proxy registry can throw from its getPrototypeOf trap.
    isMap = registry instanceof Map;
  } catch (error) {
    return unreadable(error);
  }
  if (!isMap) {
    return { extensions: [], diagnostics: ["optional child extension registry ignored: it is not a Map"] };
  }

  const seen = new Set<string>();
  for (const loaded of loadedPaths) {
    if (typeof loaded === "string" && loaded && isLocalExtensionSpec(loaded)) seen.add(canonicalPath(loaded, cwd));
  }
  const extensions: OptionalChildExtension[] = [];
  const diagnostics: string[] = [];
  let entries: unknown[];
  try {
    entries = [...(registry as Map<unknown, unknown>).entries()];
  } catch (error) {
    return unreadable(error);
  }
  for (const item of entries) {
    let id = "<unknown key>";
    try {
      const [key, entry] = item as [unknown, unknown];
      id = describeKey(key);
      if (!entry || typeof entry !== "object") {
        diagnostics.push(`optional child extension '${id}' ignored: its entry is not an object`);
        continue;
      }
      const { paths, path: fallback } = entry as OptionalChildExtensionEntry;
      const hostPath = paths && typeof paths === "object" ? paths[host] : undefined;
      const selected = hostPath ?? fallback;
      // An entry that names other hosts only is not for this host.
      if (selected === undefined) continue;
      if (typeof selected !== "string" || !selected || selected.includes("\0")) {
        diagnostics.push(`optional child extension '${id}' ignored: its path for '${host}' is not a non-empty string`);
        continue;
      }
      if (!isAbsolute(selected)) {
        diagnostics.push(`optional child extension '${id}' ignored: '${selected}' is not an absolute path`);
        continue;
      }
      let realPath: string;
      try {
        realPath = realpathSync(selected);
        if (!statSync(realPath).isFile()) throw new Error("not a file");
      } catch (error) {
        diagnostics.push(
          `optional child extension '${id}' not loaded: '${selected}' is not a readable file (${describe(error)})`,
        );
        continue;
      }
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      extensions.push({ id, path: selected, realPath });
    } catch (error) {
      diagnostics.push(`optional child extension '${id}' ignored: ${describe(error)}`);
    }
  }
  return { extensions, diagnostics };
}

type Handler = (...args: never[]) => unknown;

/** Minimal view of a pi `Extension` this module touches. */
interface LoadedExtensionLike {
  path: string;
  resolvedPath?: string;
  handlers: Map<string, Handler[]>;
}

/** Handler maps already isolated, so isolating twice is a no-op. */
const isolatedHandlerMaps = new WeakSet<object>();

const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

function isolatedHandler(event: string, handler: Handler, report: (event: string, error: unknown) => void): Handler {
  const fail = (error: unknown): undefined => {
    try {
      report(event, error);
    } catch {
      // A broken reporter must not turn a contained error back into a thrown one.
    }
    return undefined;
  };
  return (...args: never[]): unknown => {
    try {
      const result = handler(...args);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        return Promise.resolve(result).catch(fail);
      }
      return result;
    } catch (error) {
      return fail(error);
    }
  };
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
export function isolateOptionalExtensionHandlers(
  extension: LoadedExtensionLike,
  report: (event: string, error: unknown) => void,
): void {
  const map = extension.handlers;
  if (!(map instanceof Map) || isolatedHandlerMaps.has(map)) return;
  isolatedHandlerMaps.add(map);

  const wrappersByEvent = new Map<string, WeakMap<Handler, Handler>>();
  const originals = new WeakMap<Handler, Handler>();
  const viewsByEvent = new Map<string, WeakMap<Handler[], Handler[]>>();
  const rawArrays = new WeakMap<object, Handler[]>();

  const unwrap = (value: unknown): unknown =>
    typeof value === "function" ? (originals.get(value as Handler) ?? value) : value;
  const wrap = (event: string, value: unknown): unknown => {
    if (typeof value !== "function" || originals.has(value as Handler)) return value;
    let wrappers = wrappersByEvent.get(event);
    if (!wrappers) {
      wrappers = new WeakMap();
      wrappersByEvent.set(event, wrappers);
    }
    let wrapper = wrappers.get(value as Handler);
    if (!wrapper) {
      wrapper = isolatedHandler(event, value as Handler, report);
      wrappers.set(value as Handler, wrapper);
      originals.set(wrapper, value as Handler);
    }
    return wrapper;
  };
  const viewOf = (key: unknown, raw: unknown): unknown => {
    if (!Array.isArray(raw)) return raw;
    const event = String(key);
    // A frozen array cannot be proxied with different element values; it
    // cannot be added to either, so a wrapped copy is equivalent.
    if (Object.isFrozen(raw)) return raw.map((handler) => wrap(event, handler));
    let views = viewsByEvent.get(event);
    if (!views) {
      views = new WeakMap();
      viewsByEvent.set(event, views);
    }
    let view = views.get(raw);
    if (!view) {
      view = new Proxy(raw as Handler[], {
        get(target, property, receiver) {
          if (typeof property === "string" && ARRAY_INDEX.test(property)) return wrap(event, target[Number(property)]);
          if (property === "indexOf" || property === "lastIndexOf" || property === "includes") {
            const search = target[property] as (value: unknown, ...rest: unknown[]) => unknown;
            return (value: unknown, ...rest: unknown[]) => search.call(target, unwrap(value), ...rest);
          }
          return Reflect.get(target, property, receiver);
        },
        set(target, property, value) {
          return Reflect.set(target, property, unwrap(value));
        },
        defineProperty(target, property, descriptor) {
          return Reflect.defineProperty(
            target,
            property,
            "value" in descriptor ? { ...descriptor, value: unwrap(descriptor.value) } : descriptor,
          );
        },
      });
      views.set(raw, view);
      rawArrays.set(view, raw);
    }
    return view;
  };
  const toRaw = (value: unknown): unknown => {
    const raw = rawArrays.get(value as object);
    if (raw) return raw;
    if (Array.isArray(value) && !Object.isFrozen(value)) {
      for (let index = 0; index < value.length; index++) value[index] = unwrap(value[index]);
    }
    return value;
  };

  const { get, set, entries } = Map.prototype;
  function* viewEntries(): IterableIterator<[string, Handler[]]> {
    for (const [key, value] of entries.call(map) as IterableIterator<[string, Handler[]]>) {
      yield [key, viewOf(key, value) as Handler[]];
    }
  }
  function* viewValues(): IterableIterator<Handler[]> {
    for (const [, value] of viewEntries()) yield value;
  }
  const method = (value: unknown): PropertyDescriptor => ({ configurable: true, writable: true, value });
  Object.defineProperties(map, {
    get: method((key: string) => viewOf(key, get.call(map, key))),
    set: method((key: string, value: Handler[]) => {
      set.call(map, key, toRaw(value));
      return map;
    }),
    entries: method(viewEntries),
    [Symbol.iterator]: method(viewEntries),
    values: method(viewValues),
    forEach: method(
      (callback: (value: Handler[], key: string, owner: Map<string, Handler[]>) => void, thisArg?: unknown) => {
        for (const [key, value] of viewEntries()) callback.call(thisArg, value, key, map);
      },
    ),
  });
}

const warned = new Set<string>();

/**
 * Report a diagnostic once per process. A broken observer would otherwise warn
 * for every child of every run.
 */
export function warnOptionalChildExtension(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[workflow] ${message}`);
}

/** @internal Tests reset the once-per-process memory. */
export function resetOptionalChildExtensionWarnings(): void {
  warned.clear();
}

function isOptionalPath(extensionPath: string | undefined, optionalPaths: ReadonlySet<string>): boolean {
  if (!extensionPath) return false;
  if (optionalPaths.has(extensionPath)) return true;
  try {
    return optionalPaths.has(realpathSync(extensionPath));
  } catch {
    return false;
  }
}

/** Every path an optional extension may appear under in loader results. */
export function optionalPathSet(optional: readonly OptionalChildExtension[]): Set<string> {
  return new Set(optional.flatMap(({ path, realPath }) => [path, realPath]));
}

/**
 * Split a loader result into the optional extensions it carries and the rest,
 * isolating the optional extensions' handlers. Used as (part of) a loader's
 * `extensionsOverride`.
 */
export function partitionOptionalExtensions(
  result: LoadExtensionsResult,
  optionalPaths: ReadonlySet<string>,
): { rest: LoadExtensionsResult; optional: LoadExtensionsResult["extensions"] } {
  if (optionalPaths.size === 0) return { rest: result, optional: [] };
  const optional: LoadExtensionsResult["extensions"] = [];
  const rest: LoadExtensionsResult["extensions"] = [];
  for (const extension of result.extensions) {
    if (isOptionalPath(extension.resolvedPath, optionalPaths) || isOptionalPath(extension.path, optionalPaths)) {
      isolateOptionalExtensionHandlers(extension, (event, error) =>
        warnOptionalChildExtension(
          `optional child extension ${extension.path} failed in ${event}: ${describe(error)} (ignored)`,
        ),
      );
      optional.push(extension);
    } else {
      rest.push(extension);
    }
  }
  return { rest: { ...result, extensions: rest }, optional };
}

/** Warn about every load error of an optional extension; none of them is fatal. */
export function reportOptionalLoadErrors(result: LoadExtensionsResult, optionalPaths: ReadonlySet<string>): void {
  if (optionalPaths.size === 0) return;
  for (const { path, error } of result.errors) {
    if (isOptionalPath(path, optionalPaths)) {
      warnOptionalChildExtension(`optional child extension not loaded: ${path}: ${error}`);
    }
  }
}

/** The view's `extendResources`: resources an optional extension discovers never reach the shared loader. */
function dropExtendResources(paths: Parameters<ResourceLoader["extendResources"]>[0]): void {
  const count = (paths?.skillPaths?.length ?? 0) + (paths?.promptPaths?.length ?? 0) + (paths?.themePaths?.length ?? 0);
  if (count === 0) return;
  warnOptionalChildExtension(
    "optional child extension resources ignored: resources_discover results from an optional extension are not added to a shared loader",
  );
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
 * this child. Resources an optional extension discovers (`resources_discover`)
 * are dropped with a one-time warning rather than written into the shared
 * loader. The base loader must carry no extensions of its own: theirs would
 * be bound to the base runtime, which this view replaces; such a base is
 * returned unchanged with a warning.
 */
export async function withOptionalChildExtensions(
  base: ResourceLoader,
  optional: readonly OptionalChildExtension[],
  options: { cwd: string; agentDir: string },
): Promise<ResourceLoader> {
  if (optional.length === 0) return base;
  if (base.getExtensions().extensions.length > 0) {
    warnOptionalChildExtension(
      "optional child extensions skipped: this child's resource loader already carries extensions",
    );
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
  } catch (error) {
    warnOptionalChildExtension(`optional child extensions not loaded: ${describe(error)}`);
    return base;
  }
  let merged: LoadExtensionsResult | undefined;
  const view = (): LoadExtensionsResult => {
    if (merged) return merged;
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
      if (key === "getExtensions") return view;
      // The base is shared by every child for this cwd, and only optional
      // extensions run in this view, so anything they discover through
      // resources_discover would land in every sibling and later child.
      // Observers do not add capabilities: drop it.
      if (key === "extendResources") return dropExtendResources;
      if (key === "reload") {
        return async (...args: Parameters<ResourceLoader["reload"]>) => {
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
