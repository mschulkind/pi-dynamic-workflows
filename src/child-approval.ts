import type { Extension, ExtensionContext, ResourceLoader, ToolCallEvent } from "@earendil-works/pi-coding-agent";

const SLOT = Symbol.for("@mschulkind/pi-child-approval");
type Identity = { childId: string; sessionId: string; runId: string };
type Request = {
  toolName: string;
  toolCallId: string;
  parentToolCallId?: string;
  input: Record<string, unknown>;
  cwd: string;
  signal?: AbortSignal;
};
type Guard = { evaluate(request: Request): Promise<unknown>; close(): void };
type Bridge = {
  version: 1;
  lookupRoot(root?: object): { status: "absent" | "available" | "unavailable" };
  openChildGuard(root: object, identity: Identity): Guard;
};
const failure = () => new Error("Workflow child approval authority unavailable or invalid");
const usedRuntimes = new WeakSet<object>();

/** Record even ungated bindings so an injected runtime cannot later be reused for a guarded child. */
export function noteChildRuntime(loader: ResourceLoader): void {
  usedRuntimes.add(loader.getExtensions().runtime);
}

/** Trusted host scope, never supplied by workflow script arguments. Replacement revokes existing children. */
export class ChildApprovalScope {
  private required = false;
  private bridge?: Bridge;
  private readonly children = new Set<() => void>();
  constructor(private root?: object) {}

  bind(root?: object): void {
    // Even same-object reload invalidates pending decisions; new children resolve live authority.
    for (const close of this.children) close();
    this.root = root;
  }

  open(identity: Identity, signal?: AbortSignal): ChildApprovalAttachment | undefined {
    if (signal?.aborted) throw failure();
    const candidate = (globalThis as Record<symbol, unknown>)[SLOT];
    if (candidate === undefined) {
      if (this.required || this.bridge) throw failure();
      return undefined;
    }
    if (!candidate || typeof candidate !== "object") {
      this.required = true;
      throw failure();
    }
    const bridge = candidate as Bridge;
    if (
      bridge.version !== 1 ||
      typeof bridge.lookupRoot !== "function" ||
      typeof bridge.openChildGuard !== "function"
    ) {
      this.required = true;
      throw failure();
    }
    if (this.bridge && this.bridge !== bridge) throw failure();
    let status: string | undefined;
    try {
      status = bridge.lookupRoot(this.root)?.status;
    } catch {
      this.required = true;
      throw failure();
    }
    if (status === "absent" && !this.required) return undefined;
    if (status !== "available" || !this.root) {
      this.required = true;
      throw failure();
    }
    this.required = true;
    this.bridge = bridge;
    const root = this.root;
    const guard = bridge.openChildGuard(root, Object.freeze({ ...identity }));
    if (!guard || typeof guard.evaluate !== "function" || typeof guard.close !== "function") {
      try {
        guard?.close?.();
      } catch {
        /* preserve admission failure */
      }
      throw failure();
    }
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.children.delete(close);
      signal?.removeEventListener("abort", close);
      try {
        guard.close();
      } catch {
        /* cleanup must preserve the original failure */
      }
    };
    this.children.add(close);
    signal?.addEventListener("abort", close, { once: true });
    if (signal?.aborted) close();
    const current = () =>
      !closed &&
      this.root === root &&
      (globalThis as Record<symbol, unknown>)[SLOT] === bridge &&
      bridge.lookupRoot(root)?.status === "available";
    return {
      close,
      attach(loader, sessionManager) {
        let bound = false;
        const base = loader.getExtensions();
        if (!base?.runtime || usedRuntimes.has(base.runtime))
          throw new Error("Guarded children require a fresh extension runtime");
        usedRuntimes.add(base.runtime);
        const extension: Extension = {
          path: "workflow:child-approval",
          resolvedPath: "workflow:child-approval",
          sourceInfo: { path: "workflow:child-approval", source: "inline", scope: "temporary", origin: "top-level" },
          handlers: new Map(),
          tools: new Map(),
          messageRenderers: new Map(),
          commands: new Map(),
          flags: new Map(),
          shortcuts: new Map(),
        };
        extension.handlers.set("session_start", [
          async (_event, context) => {
            if ((context as ExtensionContext).sessionManager !== sessionManager) throw failure();
            bound = true;
          },
        ]);
        extension.handlers.set("tool_call", [
          async (raw, context) => {
            const event = raw as ToolCallEvent & { parentToolCallId?: string };
            const ctx = context as ExtensionContext;
            const block = (reason = "Workflow child approval failed closed") => ({ block: true, reason });
            try {
              if (
                !bound ||
                ctx.sessionManager !== sessionManager ||
                !current() ||
                ctx.signal?.aborted ||
                signal?.aborted
              )
                return block();
              const request = {
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                parentToolCallId: event.parentToolCallId,
                input: event.input,
                cwd: ctx.cwd,
                signal: ctx.signal && signal ? AbortSignal.any([ctx.signal, signal]) : (ctx.signal ?? signal),
              };
              const before = JSON.stringify([
                request.toolName,
                request.toolCallId,
                request.parentToolCallId,
                request.cwd,
                request.input,
              ]);
              const result = (await guard.evaluate(request)) as { decision?: unknown; reason?: unknown } | null;
              if (
                !current() ||
                ctx.signal?.aborted ||
                before !==
                  JSON.stringify([event.toolName, event.toolCallId, event.parentToolCallId, ctx.cwd, event.input])
              )
                return block();
              if (result?.decision === "allow") return undefined;
              return block(
                result?.decision === "block" && typeof result.reason === "string" ? result.reason : undefined,
              );
            } catch {
              return block();
            }
          },
        ]);
        extension.handlers.set("session_shutdown", [async () => close()]);
        const result = { ...base, extensions: [...base.extensions, extension] };
        // Bind other methods to the original loader (classes may use private state).
        const wrapped = new Proxy(loader, {
          get(target, key) {
            if (key === "getExtensions") return () => result;
            // Reloading this snapshot could lose middleware/authority; deny rather than rebind it silently.
            if (key === "reload")
              return async () => {
                throw new Error("Guarded child resource reload is unsupported");
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return {
          loader: wrapped,
          verify: () => {
            if (!bound || !current()) throw failure();
          },
        };
      },
    };
  }
}

export interface ChildApprovalAttachment {
  close(): void;
  attach(loader: ResourceLoader, sessionManager: object): { loader: ResourceLoader; verify(): void };
}
