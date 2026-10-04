import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  type DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WorkflowAgent } from "../src/agent.js";
import { ChildApprovalScope } from "../src/child-approval.js";
import {
  isolateOptionalExtensionHandlers,
  OPTIONAL_CHILD_EXTENSIONS_KEY,
  type OptionalChildExtensionEntry,
  PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST,
  resetOptionalChildExtensionWarnings,
  resolveOptionalChildExtensions,
} from "../src/optional-child-extensions.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

type Root = Record<PropertyKey, unknown>;
type Privates = {
  resourceLoaders: Map<string, unknown>;
  getSharedResourceLoader(agentDir: string, cwd?: string, guarded?: boolean): Promise<DefaultResourceLoader>;
  getChildResourceLoader(agentDir: string, cwd: string, guarded: boolean): Promise<DefaultResourceLoader>;
};
interface ObserverLog {
  loads: number;
  events: Array<{ event: string; sessionId?: string; probes?: unknown[] }>;
}

const LOG_KEY = "pi-dw-test.optional-observer-log";
const PROVIDER = "fauxtest-optional";
const MODEL = `${PROVIDER}/faux-model`;

/**
 * A recorder like tok-stats' child entry. It also appends a session entry, so a
 * test can see that its extension actions stay bound to its own child.
 */
const observerSource = `export default function (pi) {
  const log = globalThis[Symbol.for(${JSON.stringify(LOG_KEY)})];
  log.loads += 1;
  const record = (event) => (_payload, ctx) => {
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    const probes = (ctx?.sessionManager?.getEntries?.() ?? [])
      .filter((entry) => entry.type === "custom" && entry.customType === "optional-probe")
      .map((entry) => entry.data?.sessionId);
    log.events.push({ event, sessionId, probes });
  };
  pi.on("session_start", record("session_start"));
  pi.on("before_agent_start", (_event, ctx) => {
    pi.appendEntry("optional-probe", { sessionId: ctx.sessionManager.getSessionId() });
  });
  pi.on("before_provider_request", record("before_provider_request"));
  pi.on("message_end", record("message_end"));
}
`;

const throwingSource = `export default function (pi) {
  for (const event of ["session_start", "before_provider_request", "message_end", "tool_call", "tool_result"]) {
    pi.on(event, () => { throw new Error("observer " + event + " exploded"); });
  }
}
`;

async function fauxRegistry(home: string, core: ReturnType<typeof createFauxCore>): Promise<ModelRegistry> {
  const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null });
  runtime.registerProvider(PROVIDER, {
    name: "Faux optional",
    baseUrl: "http://127.0.0.1:9/faux",
    apiKey: "faux-dummy-key-not-used",
    api: core.api,
    streamSimple: core.streamSimple as never,
    models: core.models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: false,
      input: ["text"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 4_096,
    })),
  });
  return new ModelRegistry(runtime);
}

/** A faux reply that first runs the child's real provider-request hook, as a real provider would. */
function replyThroughPayloadHook(text: string) {
  return async (
    _context: unknown,
    options: { onPayload?: (p: unknown, m: unknown) => unknown } | undefined,
    _state: unknown,
    model: unknown,
  ) => {
    await options?.onPayload?.({ probe: true }, model);
    return fauxAssistantMessage(text, { stopReason: "stop" });
  };
}

interface Fixture {
  home: string;
  cwd: string;
  agentDir: string;
  observer: string;
  log: ObserverLog;
  core: ReturnType<typeof createFauxCore>;
  warnings: string[];
}

async function withFixture(fn: (fixture: Fixture) => Promise<void>): Promise<void> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "pi-dw-optional-home-")));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-dw-optional-cwd-")));
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  const observer = join(home, "observer.mjs");
  writeFileSync(observer, observerSource);
  const log: ObserverLog = { loads: 0, events: [] };
  const savedRegistry = (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY];
  delete (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY];
  (globalThis as Root)[Symbol.for(LOG_KEY)] = log;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  resetOptionalChildExtensionWarnings();
  const core = createFauxCore({
    provider: PROVIDER,
    models: [{ id: "faux-model", name: "Faux Model", contextWindow: 128_000, maxTokens: 4_096 }],
  });
  try {
    await withFakeHomeAsync(home, () => fn({ home, cwd, agentDir, observer, log, core, warnings }));
  } finally {
    console.warn = originalWarn;
    resetOptionalChildExtensionWarnings();
    if (savedRegistry === undefined) delete (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY];
    else (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY] = savedRegistry;
    delete (globalThis as Root)[Symbol.for(LOG_KEY)];
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

function register(entries: Record<string, OptionalChildExtensionEntry | unknown>): void {
  (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY] = new Map(Object.entries(entries));
}

test("runs against the pi it was asked to (npm run test:deployed-pi)", {
  skip: !process.env.PI_DEPLOYED_PI_VERSION,
}, () => {
  // tests/helpers/deployed-pi-loader.mjs redirects @earendil-works/* to an installed pi.
  const resolved = import.meta.resolve("@earendil-works/pi-coding-agent");
  assert.equal(resolved.startsWith(new URL("../node_modules/", import.meta.url).href), false, resolved);
});

test("the registry key and host name are the shared convention", () => {
  assert.equal(OPTIONAL_CHILD_EXTENSIONS_KEY, Symbol.for("pi.optional-child-extensions.v1"));
  assert.equal(PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST, "pi-dynamic-workflows");
});

test("resolution selects paths[host] over path, dedupes by realpath, and fails open", async () => {
  await withFixture(async ({ home, observer }) => {
    const other = join(home, "other.mjs");
    writeFileSync(other, "export default () => {};\n");
    const link = join(home, "observer-link.mjs");
    symlinkSync(observer, link);
    register({
      specific: { paths: { "pi-dynamic-workflows": observer, "pi-subagents": "/nonexistent.mjs" }, path: other },
      elsewhere: { paths: { "pi-subagents": other } },
      duplicate: { path: link },
      fallback: { path: other },
      relative: { path: "relative.mjs" },
      missing: { path: join(home, "missing.mjs") },
      broken: null,
    });
    const resolved = resolveOptionalChildExtensions(PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST);
    assert.deepEqual(
      resolved.extensions.map(({ id, path }) => [id, path]),
      [
        ["specific", observer],
        ["fallback", other],
      ],
    );
    const text = resolved.diagnostics.join("\n");
    assert.match(text, /'relative'.*not an absolute path/);
    assert.match(text, /'missing'.*not a readable file/);
    assert.match(text, /'broken'.*not an object/);
    // A path the child already loads, named through a symlink, is not loaded again.
    assert.deepEqual(
      resolveOptionalChildExtensions(PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST, [link]).extensions.map(({ id }) => id),
      ["fallback"],
    );
    (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY] = ["not", "a", "map"];
    assert.match(resolveOptionalChildExtensions(PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST).diagnostics[0] ?? "", /not a Map/);
  });
});

test("without a registry a child uses the shared loader itself, unchanged", async () => {
  await withFixture(async ({ home, cwd, agentDir, log, core }) => {
    const agent = new WorkflowAgent({ cwd, modelRegistry: await fauxRegistry(home, core) });
    const privates = agent as unknown as Privates;
    const shared = await privates.getSharedResourceLoader(agentDir, cwd);
    assert.equal(await privates.getChildResourceLoader(agentDir, cwd, false), shared);
    register({});
    assert.equal(await privates.getChildResourceLoader(agentDir, cwd, false), shared, "an empty Map is no registry");
    core.setResponses([fauxAssistantMessage("plain", { stopReason: "stop" })]);
    assert.equal(await agent.run("task", { model: MODEL }), "plain");
    assert.equal(log.loads, 0);
  });
});

test("a registered observer loads into each workflow child, bound to that child, and the loader stays shared", async () => {
  await withFixture(async ({ home, cwd, agentDir, observer, log, core, warnings }) => {
    register({ observer: { path: observer } });
    const agent = new WorkflowAgent({ cwd, modelRegistry: await fauxRegistry(home, core) });
    const privates = agent as unknown as Privates;
    core.setResponses([replyThroughPayloadHook("first"), replyThroughPayloadHook("second")]);
    const sessions: string[] = [];
    const results = await Promise.all([
      agent.run("first", { model: MODEL, onSessionCreated: ({ sessionId }) => sessions.push(sessionId) }),
      agent.run("second", { model: MODEL, onSessionCreated: ({ sessionId }) => sessions.push(sessionId) }),
    ]);
    assert.deepEqual(results.sort(), ["first", "second"]);
    assert.equal(log.loads, 2, "one observer instance per child");
    for (const sessionId of sessions) {
      const own = log.events.filter((entry) => entry.sessionId === sessionId);
      assert.equal(own[0]?.event, "session_start", "the observer sees session_start first");
      assert.ok(
        own.some(({ event }) => event === "before_provider_request"),
        "it sees the child's provider request",
      );
      assert.ok(own.some(({ event }) => event === "message_end"));
      // appendEntry from the observer landed in its own child, never the sibling's.
      const last = own.at(-1);
      assert.deepEqual(last?.probes, [sessionId]);
    }
    // The #109 sharing survives: one shared loader for the directory, and the
    // child views are distinct per child but delegate to it.
    assert.equal(privates.resourceLoaders.size, 1);
    const shared = await privates.getSharedResourceLoader(agentDir, cwd);
    const view = await privates.getChildResourceLoader(agentDir, cwd, false);
    assert.notEqual(view, shared);
    const sentinel = { skills: [], diagnostics: [] };
    shared.getSkills = () => sentinel;
    assert.equal(view.getSkills(), sentinel, "skills come from the shared loader");
    assert.equal(shared.getExtensions().extensions.length, 0, "the shared loader itself stays extension-free");
    assert.deepEqual(
      view.getExtensions().extensions.map(({ path }) => path),
      [observer],
    );
    assert.deepEqual(warnings, []);
  });
});

test("the observer selects its pi-dynamic-workflows path and bypasses the middleware allowlist", async () => {
  await withFixture(async ({ home, cwd, agentDir, observer, log, core }) => {
    const subagentOnly = join(home, "subagent-observer.mjs");
    writeFileSync(subagentOnly, "export default () => { throw new Error('wrong host'); };\n");
    writeFileSync(
      join(agentDir, "extensions", "allowed-adapter.js"),
      "export default function (pi) { globalThis[Symbol.for('pi-dw-test.adapter')] = true; }",
    );
    register({ observer: { paths: { "pi-dynamic-workflows": observer, "pi-subagents": subagentOnly } } });
    for (const allowlist of [["allowed-adapter"], ["not-installed"]]) {
      log.loads = 0;
      log.events = [];
      const agent = new WorkflowAgent({
        cwd,
        modelRegistry: await fauxRegistry(home, core),
        providerMiddlewareExtensions: allowlist,
      });
      const loader = await (agent as unknown as Privates).getChildResourceLoader(agentDir, cwd, false);
      const paths = loader.getExtensions().extensions.map(({ path }) => path);
      assert.equal(paths.at(-1), observer, "the observer loads after the middleware");
      assert.equal(paths.includes(subagentOnly), false);
      core.setResponses([replyThroughPayloadHook("done")]);
      assert.equal(await agent.run("task", { model: MODEL }), "done");
      assert.ok(
        log.events.some(({ event }) => event === "before_provider_request"),
        JSON.stringify(allowlist),
      );
    }
  });
});

test("an observer that is also allowlisted middleware loads once", async () => {
  await withFixture(async ({ home, cwd, agentDir, log, core }) => {
    const middleware = join(agentDir, "extensions", "shared-observer.js");
    writeFileSync(middleware, observerSource);
    const link = join(home, "shared-observer-link.js");
    symlinkSync(middleware, link);
    register({ observer: { path: link } });
    const agent = new WorkflowAgent({
      cwd,
      modelRegistry: await fauxRegistry(home, core),
      providerMiddlewareExtensions: ["shared-observer"],
    });
    core.setResponses([fauxAssistantMessage("done", { stopReason: "stop" })]);
    assert.equal(await agent.run("task", { model: MODEL }), "done");
    assert.equal(log.loads, 1);
    const loader = await (agent as unknown as Privates).getChildResourceLoader(agentDir, cwd, false);
    assert.deepEqual(
      loader.getExtensions().extensions.map(({ path }) => path),
      [middleware],
    );
  });
});

test("a missing file or a throwing factory fails open with a one-time warning", async () => {
  await withFixture(async ({ home, cwd, observer, log, core, warnings }) => {
    const broken = join(home, "broken.mjs");
    writeFileSync(broken, "export default () => { throw new Error('factory exploded'); };\n");
    register({ missing: { path: join(home, "missing.mjs") }, broken: { path: broken }, observer: { path: observer } });
    for (const allowlist of [undefined, ["unrelated"]]) {
      resetOptionalChildExtensionWarnings();
      warnings.length = 0;
      log.loads = 0;
      const agent = new WorkflowAgent({
        cwd,
        modelRegistry: await fauxRegistry(home, core),
        providerMiddlewareExtensions: allowlist,
      });
      core.setResponses([
        fauxAssistantMessage("one", { stopReason: "stop" }),
        fauxAssistantMessage("two", { stopReason: "stop" }),
      ]);
      assert.equal(await agent.run("one", { model: MODEL }), "one");
      assert.equal(await agent.run("two", { model: MODEL }), "two");
      assert.equal(log.loads, 2, "a healthy observer still loads beside broken ones");
      const text = warnings.join("\n");
      assert.equal(warnings.filter((w) => w.includes("'missing'")).length, 1, "warned once, not per child");
      assert.match(text, /\[workflow\] optional child extension 'missing' not loaded/);
      assert.match(text, /optional child extension not loaded: .*broken\.mjs.*factory exploded/);
    }
  });
});

test("a throwing observer cannot fail its child, even from tool_call", async () => {
  await withFixture(async ({ home, cwd, core, warnings }) => {
    const throwing = join(home, "throwing.mjs");
    writeFileSync(throwing, throwingSource);
    writeFileSync(join(cwd, "note.txt"), "readable\n");
    register({ throwing: { path: throwing } });
    const agent = new WorkflowAgent({ cwd, modelRegistry: await fauxRegistry(home, core) });
    let toolResult: { isError?: boolean } | undefined;
    core.setResponses([
      async (_context, options, _state, model) => {
        await options?.onPayload?.({ probe: true }, model);
        return fauxAssistantMessage(fauxToolCall("read", { path: "note.txt" }), { stopReason: "toolUse" });
      },
      (context) => {
        toolResult = context.messages.find((message) => message.role === "toolResult") as typeof toolResult;
        return fauxAssistantMessage("survived", { stopReason: "stop" });
      },
    ]);
    assert.equal(await agent.run("read the note", { model: MODEL }), "survived");
    assert.ok(toolResult, "the tool ran");
    assert.equal(toolResult.isError, false, "a throwing tool_call observer did not block the tool");
    const text = warnings.join("\n");
    for (const event of ["session_start", "before_provider_request", "message_end", "tool_call", "tool_result"]) {
      assert.match(text, new RegExp(`failed in ${event}: observer ${event} exploded \\(ignored\\)`));
    }
  });
});

test("isolateOptionalExtensionHandlers keeps successful results and the sync shape", async () => {
  const reported: string[] = [];
  const handlers = new Map<string, Array<(...args: never[]) => unknown>>([
    ["context", [() => ({ messages: ["kept"] })]],
    ["provider_stream_event", [() => undefined]],
    ["message_end", [async () => Promise.reject(new Error("rejected"))]],
  ]);
  const extension = { path: "/x/observer.mjs", handlers };
  isolateOptionalExtensionHandlers(extension, (event, error) =>
    reported.push(`${event}: ${error instanceof Error ? error.message : String(error)}`),
  );
  assert.deepEqual(extension.handlers.get("context")?.[0]?.(), { messages: ["kept"] });
  assert.equal(extension.handlers.get("provider_stream_event")?.[0]?.(), undefined);
  assert.equal(await extension.handlers.get("message_end")?.[0]?.(), undefined);
  assert.deepEqual(reported, ["message_end: rejected"]);
});

test("resolution never throws on registries that resist being read, and keeps the healthy entries", async () => {
  await withFixture(async ({ home, observer }) => {
    const other = join(home, "other.mjs");
    writeFileSync(other, "export default () => {};\n");
    // A key String() cannot convert: one bad key must not hide the good entries.
    (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY] = new Map<unknown, unknown>([
      [Object.create(null), { path: observer }],
      ["good", { path: other }],
    ]);
    assert.deepEqual(
      resolveOptionalChildExtensions(PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST).extensions.map(({ id, path }) => [id, path]),
      [
        ["<unprintable key>", observer],
        ["good", other],
      ],
    );
    // A Proxy registry whose getPrototypeOf trap throws defeats `instanceof Map`.
    (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY] = new Proxy(new Map(), {
      getPrototypeOf() {
        throw new Error("prototype trap");
      },
    });
    const trapped = resolveOptionalChildExtensions(PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST);
    assert.deepEqual(trapped.extensions, []);
    assert.match(trapped.diagnostics[0] ?? "", /registry is unreadable: prototype trap/);
    // An entry getter that throws a value String() cannot convert.
    const nullThrower = {
      get path(): string {
        throw Object.create(null);
      },
    };
    register({ "null-throw": nullThrower, good: { path: other } });
    const thrown = resolveOptionalChildExtensions(PI_DYNAMIC_WORKFLOWS_OPTIONAL_HOST);
    assert.deepEqual(
      thrown.extensions.map(({ id }) => id),
      ["good"],
    );
    assert.match(thrown.diagnostics.join("\n"), /'null-throw' ignored: <unprintable error>/);
  });
});

test("a child still runs when the registry throws a null-prototype object from getPrototypeOf", async () => {
  await withFixture(async ({ home, cwd, core, warnings }) => {
    (globalThis as Root)[OPTIONAL_CHILD_EXTENSIONS_KEY] = new Proxy(new Map(), {
      getPrototypeOf() {
        throw Object.create(null);
      },
    });
    const agent = new WorkflowAgent({ cwd, modelRegistry: await fauxRegistry(home, core) });
    core.setResponses([fauxAssistantMessage("ran", { stopReason: "stop" })]);
    assert.equal(await agent.run("task", { model: MODEL }), "ran");
    assert.match(warnings.join("\n"), /registry is unreadable: <unprintable error>/);
  });
});

type HandlerList = Array<(...args: never[]) => unknown>;
interface HandlerOwner {
  handlers: Map<string, HandlerList>;
}

/**
 * pi's `on()` and the unsubscribe it returns, as pi 1.0.1 writes them
 * (core/extensions/loader.js): `get`, `push`, `set`; then `get`, `indexOf`,
 * `splice`, `delete`. The runner reads `handlers.get(event)?.slice()`.
 */
function piOn(extension: HandlerOwner, event: string, handler: (...args: never[]) => unknown): () => void {
  const registeredHandler = (...args: never[]) => handler(...args);
  const list = extension.handlers.get(event) ?? [];
  list.push(registeredHandler);
  extension.handlers.set(event, list);
  return () => {
    const handlers = extension.handlers.get(event);
    if (!handlers) return;
    const index = handlers.indexOf(registeredHandler);
    if (index === -1) return;
    handlers.splice(index, 1);
    if (handlers.length === 0) extension.handlers.delete(event);
  };
}
const snapshot = (extension: HandlerOwner, event: string) => extension.handlers.get(event)?.slice() ?? [];

test("isolateOptionalExtensionHandlers covers handlers registered later, as pi.on does from session_start", async () => {
  const reported: string[] = [];
  const extension = { path: "/x/observer.mjs", handlers: new Map<string, HandlerList>() };
  piOn(extension, "session_start", () => {
    piOn(extension, "tool_call", () => {
      throw new Error("late tool_call exploded");
    });
    piOn(extension, "message_end", async () => {
      throw new Error("late message_end exploded");
    });
  });
  isolateOptionalExtensionHandlers(extension, (event, error) => reported.push(`${event}: ${(error as Error).message}`));
  for (const handler of snapshot(extension, "session_start")) await handler();
  assert.equal(snapshot(extension, "tool_call").length, 1);
  for (const handler of snapshot(extension, "tool_call")) assert.equal(handler(), undefined);
  for (const handler of snapshot(extension, "message_end")) assert.equal(await handler(), undefined);
  assert.deepEqual(reported, ["tool_call: late tool_call exploded", "message_end: late message_end exploded"]);
  // One wrapper per original handler, and the map still holds pi's arrays of originals.
  assert.equal(extension.handlers.get("tool_call")?.[0], extension.handlers.get("tool_call")?.[0]);
  const raw = Map.prototype.get.call(extension.handlers, "tool_call") as HandlerList;
  assert.throws(() => raw[0]?.(), /late tool_call exploded/);
});

test("isolateOptionalExtensionHandlers keeps pi's unsubscribe working, before and after isolation", () => {
  const fired: string[] = [];
  const extension = { path: "/x/observer.mjs", handlers: new Map<string, HandlerList>() };
  const offEarly = piOn(extension, "message_end", () => fired.push("early"));
  const offKept = piOn(extension, "message_end", () => fired.push("kept"));
  isolateOptionalExtensionHandlers(extension, () => {});
  const offLate = piOn(extension, "message_end", () => fired.push("late"));
  const offOnly = piOn(extension, "turn_end", () => fired.push("only"));
  offEarly();
  offLate();
  offOnly();
  for (const handler of snapshot(extension, "message_end")) handler();
  assert.deepEqual(fired, ["kept"], "off() removed the handlers it registered, and only those");
  assert.equal(extension.handlers.has("turn_end"), false, "the last off() deletes the event");
  offKept();
  assert.equal(extension.handlers.has("message_end"), false);
  // Isolating twice wraps once, and a throwing reporter is contained too.
  isolateOptionalExtensionHandlers(extension, () => {
    throw new Error("reporter broke");
  });
  piOn(extension, "tool_call", () => {
    throw new Error("boom");
  });
  assert.equal(snapshot(extension, "tool_call")[0]?.(), undefined);
});

test("a late-registered throwing tool_call cannot block a workflow child's tool, and pi's off() still works", async () => {
  await withFixture(async ({ home, cwd, log, core, warnings }) => {
    const late = join(home, "late.mjs");
    writeFileSync(
      late,
      `export default function (pi) {
  const log = globalThis[Symbol.for(${JSON.stringify(LOG_KEY)})];
  log.loads += 1;
  const off = pi.on("message_end", () => { log.events.push({ event: "unsubscribed message_end" }); });
  pi.on("session_start", () => {
    // pi < 1.0 returns no unsubscribe from on().
    if (typeof off === "function") off();
    else log.events.push({ event: "no off()" });
    pi.on("tool_call", () => { throw new Error("late tool_call exploded"); });
    pi.on("message_end", () => { log.events.push({ event: "late message_end" }); });
  });
}
`,
    );
    writeFileSync(join(cwd, "note.txt"), "readable\n");
    register({ late: { path: late } });
    const agent = new WorkflowAgent({ cwd, modelRegistry: await fauxRegistry(home, core) });
    let toolResult: { isError?: boolean } | undefined;
    core.setResponses([
      fauxAssistantMessage(fauxToolCall("read", { path: "note.txt" }), { stopReason: "toolUse" }),
      (context) => {
        toolResult = context.messages.find((message) => message.role === "toolResult") as typeof toolResult;
        return fauxAssistantMessage("survived", { stopReason: "stop" });
      },
    ]);
    assert.equal(await agent.run("read the note", { model: MODEL }), "survived");
    assert.equal(log.loads, 1);
    assert.ok(toolResult, "the tool ran");
    assert.equal(toolResult.isError, false, "a late throwing tool_call observer did not block the tool");
    assert.match(warnings.join("\n"), /failed in tool_call: late tool_call exploded \(ignored\)/);
    const events = log.events.map(({ event }) => event);
    // pi >= 1.0 (the deployed one; see test:deployed-pi) returns an unsubscribe.
    if (process.env.PI_DEPLOYED_PI_VERSION) assert.equal(events.includes("no off()"), false);
    if (!events.includes("no off()")) {
      assert.equal(events.includes("unsubscribed message_end"), false, "off() removed the handler");
    }
    assert.ok(events.includes("late message_end"), "a late handler still fires");
  });
});

test("an optional extension's resources_discover never writes into the shared loader", async () => {
  await withFixture(async ({ home, cwd, agentDir, log, core, warnings }) => {
    const promptDir = join(home, "discovered-prompts");
    mkdirSync(promptDir, { recursive: true });
    writeFileSync(join(promptDir, "leaked.md"), "---\ndescription: leaked\n---\nleaked prompt\n");
    const discover = join(home, "discover.mjs");
    writeFileSync(
      discover,
      `export default function (pi) {
  globalThis[Symbol.for(${JSON.stringify(LOG_KEY)})].loads += 1;
  pi.on("resources_discover", () => ({ promptPaths: [${JSON.stringify(promptDir)}] }));
}
`,
    );
    register({ discover: { path: discover } });
    const agent = new WorkflowAgent({ cwd, modelRegistry: await fauxRegistry(home, core) });
    const privates = agent as unknown as Privates;
    const shared = await privates.getSharedResourceLoader(agentDir, cwd);
    const before = shared.getPrompts().prompts.map(({ name }) => name);
    core.setResponses([
      fauxAssistantMessage("one", { stopReason: "stop" }),
      fauxAssistantMessage("two", { stopReason: "stop" }),
    ]);
    assert.equal(await agent.run("one", { model: MODEL }), "one");
    assert.equal(await agent.run("two", { model: MODEL }), "two");
    assert.equal(log.loads, 2, "the extension loaded and ran in both children");
    assert.equal(await privates.getSharedResourceLoader(agentDir, cwd), shared, "still the one shared loader");
    assert.deepEqual(
      shared.getPrompts().prompts.map(({ name }) => name),
      before,
      "the shared loader's prompts are unchanged",
    );
    assert.equal(before.includes("leaked"), false);
    assert.equal(
      warnings.filter((warning) => warning.includes("resources_discover")).length,
      1,
      "dropped with a one-time warning",
    );
  });
});

const APPROVAL_SLOT = Symbol.for("@mschulkind/pi-child-approval");

/** A real ChildApprovalScope whose attachments are recorded, so a test can inspect the loader a guarded child got. */
class RecordingApprovalScope extends ChildApprovalScope {
  readonly attached: ResourceLoader[] = [];
  override open(...args: Parameters<ChildApprovalScope["open"]>): ReturnType<ChildApprovalScope["open"]> {
    const attachment = super.open(...args);
    if (!attachment) return attachment;
    return {
      close: () => attachment.close(),
      attach: (loader, sessionManager) => {
        const result = attachment.attach(loader, sessionManager);
        this.attached.push(result.loader);
        return result;
      },
    };
  }
}

test("a guarded child loads observers after the middleware, keeps approval last, and a throwing observer cannot bypass it", async () => {
  await withFixture(async ({ home, cwd, agentDir, observer, log, core }) => {
    const middleware = join(agentDir, "extensions", "allowed-adapter.js");
    writeFileSync(middleware, "export default function (pi) { pi.on('tool_call', () => undefined); }\n");
    const throwing = join(home, "throwing.mjs");
    writeFileSync(throwing, throwingSource);
    register({ observer: { path: observer }, throwing: { path: throwing } });

    const root = SessionManager.inMemory(home);
    const decisions: string[] = [];
    const saved = (globalThis as Root)[APPROVAL_SLOT];
    (globalThis as Root)[APPROVAL_SLOT] = {
      version: 1,
      lookupRoot: (owner?: object) => ({ status: owner === root ? "available" : "unavailable" }),
      openChildGuard: () => ({
        evaluate: async (request: { input: { value?: string } }) => {
          decisions.push(request.input.value ?? "");
          return request.input.value === "deny"
            ? { decision: "block", reason: "denied by test" }
            : { decision: "allow" };
        },
        close: () => {},
      }),
    };
    try {
      const executions: string[] = [];
      const tool: ToolDefinition = {
        name: "generic",
        label: "generic",
        description: "Execution spy",
        parameters: Type.Object({ value: Type.Optional(Type.String()) }),
        execute: async (_id, input) => {
          executions.push(input.value ?? "generic");
          return { content: [{ type: "text", text: "executed" }], details: undefined };
        },
      };
      const scope = new RecordingApprovalScope(root);
      const agent = new WorkflowAgent({
        cwd,
        tools: [tool],
        modelRegistry: await fauxRegistry(home, core),
        providerMiddlewareExtensions: ["allowed-adapter"],
        childApprovalScope: scope,
      });
      const sessions: string[] = [];
      for (const value of ["deny", "allow"]) {
        core.setResponses([
          fauxAssistantMessage(fauxToolCall("generic", { value }), { stopReason: "toolUse" }),
          fauxAssistantMessage("done", { stopReason: "stop" }),
        ]);
        assert.equal(
          await agent.run(value, { model: MODEL, onSessionCreated: ({ sessionId }) => sessions.push(sessionId) }),
          "done",
        );
      }

      // (b)+(c): approval decided both calls; the denied one never ran, despite the throwing observer.
      assert.deepEqual(decisions, ["deny", "allow"]);
      assert.deepEqual(executions, ["allow"]);

      // (a): middleware, then observers, then the approval gate, in every guarded child.
      assert.equal(scope.attached.length, 2);
      for (const loader of scope.attached) {
        const extensions = loader.getExtensions().extensions;
        assert.deepEqual(
          extensions.map(({ path }) => path),
          [middleware, observer, throwing, "workflow:child-approval"],
        );
        const withToolCall = extensions.filter(({ handlers }) => (handlers.get("tool_call")?.length ?? 0) > 0);
        assert.equal(withToolCall.at(-1)?.path, "workflow:child-approval", "approval is the last tool_call handler");
      }
      for (const sessionId of sessions) {
        const own = log.events.filter((entry) => entry.sessionId === sessionId).map(({ event }) => event);
        assert.equal(own[0], "session_start", "the observer sees the guarded child's session_start");
        assert.ok(own.includes("message_end"));
      }
      assert.equal(log.loads, 2);
    } finally {
      if (saved === undefined) delete (globalThis as Root)[APPROVAL_SLOT];
      else (globalThis as Root)[APPROVAL_SLOT] = saved;
    }
  });
});
