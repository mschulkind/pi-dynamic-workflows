import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createCodingTools, ModelRegistry, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { WorkflowAgent } from "../dist/index.js";
import { compiledModuleUrl } from "./helpers/compiled-module.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

const slot = Symbol.for("@mschulkind/pi-child-approval");
const globals = globalThis as Record<symbol, unknown>;

test("original SDK child bash probe is blocked automatically with empty middleware", async () => {
  const home = mkdtempSync(join(tmpdir(), "dw-approval-"));
  const previous = globals[slot];
  const root = SessionManager.inMemory(home);
  let executed = 0;
  let evaluated = 0;
  let closed = 0;
  globals[slot] = {
    version: 1,
    lookupRoot: (owner?: object) => ({ status: owner === root ? "available" : "unavailable" }),
    openChildGuard: (owner: object) => {
      assert.equal(owner, root);
      return {
        evaluate: async (request: { toolName: string; input: unknown; cwd: string }) => {
          evaluated++;
          assert.equal(request.toolName, "bash");
          assert.deepEqual(request.input, {
            command: "bash -n <<'PROBE'\nsystemctl enable harmless-probe.service\nPROBE",
          });
          assert.equal(request.cwd, home);
          return { decision: "block", reason: "OFF: no manual UI" };
        },
        close: () => closed++,
      };
    },
  };
  try {
    await withFakeHomeAsync(home, async () => {
      const provider = "fauxtest-child-approval";
      const core = createFauxCore({ provider, models: [{ id: "local", contextWindow: 128_000, maxTokens: 4096 }] });
      const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null });
      runtime.registerProvider(provider, {
        baseUrl: "http://127.0.0.1:9/unused",
        apiKey: "unused",
        api: core.api,
        streamSimple: core.streamSimple as never,
        models: [
          {
            id: "local",
            name: "local",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 4096,
          },
        ],
      });
      const tools = createCodingTools(home).map((tool) =>
        tool.name !== "bash"
          ? tool
          : {
              ...tool,
              execute: async (...args: Parameters<typeof tool.execute>) => {
                executed++;
                return tool.execute(...args);
              },
            },
      );
      core.setResponses([
        fauxAssistantMessage(
          fauxToolCall("bash", { command: "bash -n <<'PROBE'\nsystemctl enable harmless-probe.service\nPROBE" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done", { stopReason: "stop" }),
      ]);
      const agent = new WorkflowAgent({
        cwd: home,
        tools,
        modelRegistry: new ModelRegistry(runtime),
        providerMiddlewareExtensions: [],
        ...{ parentSessionManager: root },
      });
      await agent.run("probe", { model: `${provider}/local` });
      assert.equal(executed, 0, "approval must precede actual original bash tool execution");
      assert.equal(evaluated, 1);
      assert.equal(closed, 1);
    });
  } finally {
    if (previous === undefined) delete globals[slot];
    else globals[slot] = previous;
    rmSync(home, { recursive: true, force: true });
  }
});

import { DefaultResourceLoader, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ChildApprovalScope = import("../dist/child-approval.js").ChildApprovalScope;
const { ChildApprovalScope } = await import(compiledModuleUrl("child-approval.js"));

type Request = {
  toolName: string;
  toolCallId: string;
  parentToolCallId?: string;
  input: Record<string, unknown>;
  cwd: string;
  signal?: AbortSignal;
};

async function fixture(
  fn: (f: {
    home: string;
    root: SessionManager;
    scope: ChildApprovalScope;
    calls: Request[];
    executions: string[];
    closed: string[];
    agent(options?: Partial<ConstructorParameters<typeof WorkflowAgent>[0]>): WorkflowAgent;
    run(agent: WorkflowAgent, tool?: string, input?: Record<string, unknown>, thread?: string): Promise<unknown>;
    evaluate: (request: Request) => Promise<unknown>;
    status: string;
    core: ReturnType<typeof createFauxCore>;
    registry: ModelRegistry;
    tool: ToolDefinition;
  }) => Promise<void>,
) {
  const home = mkdtempSync(join(tmpdir(), "dw-approval-fixture-"));
  const previous = globals[slot];
  const root = SessionManager.inMemory(home);
  const calls: Request[] = [],
    executions: string[] = [],
    closed: string[] = [];
  try {
    await withFakeHomeAsync(home, async () => {
      const provider = "fauxtest-child-approval-fixture";
      const core = createFauxCore({ provider, models: [{ id: "local", contextWindow: 128_000, maxTokens: 4096 }] });
      const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null });
      runtime.registerProvider(provider, {
        baseUrl: "http://127.0.0.1:9/unused",
        apiKey: "unused",
        api: core.api,
        streamSimple: core.streamSimple as never,
        models: [
          {
            id: "local",
            name: "local",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 4096,
          },
        ],
      });
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
      const scope = new ChildApprovalScope(root);
      const f = {
        home,
        root,
        scope,
        calls,
        executions,
        closed,
        core,
        registry: new ModelRegistry(runtime),
        tool,
        status: "available",
        evaluate: async (_request: Request): Promise<unknown> => ({ decision: "allow" }),
        agent: (options: Partial<ConstructorParameters<typeof WorkflowAgent>[0]> = {}) =>
          new WorkflowAgent({
            cwd: home,
            tools: [tool],
            modelRegistry: new ModelRegistry(runtime),
            childApprovalScope: scope,
            ...options,
          }),
        run: async (agent: WorkflowAgent, name = "generic", input: Record<string, unknown> = {}, thread?: string) => {
          core.setResponses([
            fauxAssistantMessage(fauxToolCall(name, input), { stopReason: "toolUse" }),
            fauxAssistantMessage("done", { stopReason: "stop" }),
          ]);
          return agent.run("synthetic task is not human authorization", { model: `${provider}/local`, thread });
        },
      };
      globals[slot] = {
        version: 1,
        lookupRoot: (owner?: object) => ({ status: owner === root ? f.status : "unavailable" }),
        openChildGuard: (owner: object, identity: { childId: string; sessionId: string; runId: string }) => {
          assert.equal(owner, root);
          assert.ok(identity.childId && identity.sessionId && identity.runId);
          return {
            evaluate: async (request: Request) => {
              calls.push(request);
              return f.evaluate(request);
            },
            close: () => closed.push(identity.childId),
          };
        },
      };
      await fn(f);
    });
  } finally {
    if (previous === undefined) delete globals[slot];
    else globals[slot] = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

test("generic custom tools follow live ON/OFF and config decisions on reused threads", async () =>
  fixture(async (f) => {
    const agent = f.agent();
    await f.run(agent, "generic", { value: "on" }, "thread");
    f.evaluate = async () => ({ decision: "block", reason: "OFF no UI" });
    await f.run(agent, "generic", { value: "off" }, "thread");
    f.evaluate = async () => ({ decision: "block", reason: "ON deny/ask config" });
    await f.run(agent, "generic", { value: "deny" }, "thread");
    f.evaluate = async () => ({ decision: "allow" });
    await f.run(agent, "generic", { value: "on-again" }, "thread");
    assert.deepEqual(f.executions, ["on", "on-again"]);
    assert.equal(f.calls.length, 4);
    assert.equal(f.closed.length, 4);
    assert.equal(new Set(f.closed).size, 1, "thread retains identity but each turn gets a new guard/runtime");
  }));

for (const change of ["missing", "replaced", "unavailable", "handoff", "mutation", "throw", "malformed"]) {
  test(`pending generic tool fails closed after ${change}`, async () =>
    fixture(async (f) => {
      f.evaluate = async (request) => {
        if (change === "missing") delete globals[slot];
        if (change === "replaced") globals[slot] = { ...(globals[slot] as object) };
        if (change === "unavailable") f.status = "unavailable";
        if (change === "handoff") f.scope.bind(SessionManager.inMemory());
        if (change === "mutation") request.input.value = "mutated";
        if (change === "throw") throw new Error("broken gate");
        return change === "malformed" ? {} : { decision: "allow" };
      };
      await f.run(f.agent(), "generic", { value: "requested" });
      assert.deepEqual(f.executions, []);
      assert.equal(f.closed.length, 1);
    }));
}

test("missing/stale/ambiguous policy denies admission; known no-gate and empty jail stay usable", async () =>
  fixture(async (f) => {
    const agent = f.agent();
    delete globals[slot];
    await f.run(agent);
    assert.equal(f.executions.length, 1);
    globals[slot] = {
      version: 1,
      lookupRoot: () => ({ status: "absent" }),
      openChildGuard: () => {
        throw new Error("not needed");
      },
    };
    await f.run(agent);
    assert.equal(f.executions.length, 2);
    globals[slot] = {
      version: 1,
      lookupRoot: () => ({ status: "unavailable" }),
      openChildGuard: () => {
        throw new Error("not needed");
      },
    };
    await assert.rejects(f.run(agent), /approval authority/);
    await assert.rejects(f.run(f.agent({ childApprovalScope: undefined })), /approval authority/);
    globals[slot] = { version: 9 };
    await assert.rejects(f.run(agent), /approval authority/);
  }));

test("once required, loss of registry cannot create a new ungated child", async () =>
  fixture(async (f) => {
    const agent = f.agent();
    await f.run(agent);
    delete globals[slot];
    await assert.rejects(f.run(agent), /approval authority/);
    assert.equal(f.executions.length, 1);
  }));

test("custom loader keeps middleware first, mandatory gate last, and rejects runtime reuse", async () =>
  fixture(async (f) => {
    const loader = new DefaultResourceLoader({
      cwd: f.home,
      agentDir: join(f.home, ".pi", "agent"),
      noExtensions: true,
      extensionFactories: [
        (pi) => {
          pi.on("tool_call", (event) => {
            event.input.value = "middleware-mutated";
          });
        },
      ],
    });
    await loader.reload();
    f.evaluate = async (request) => {
      assert.equal(request.input.value, "middleware-mutated");
      return { decision: "block", reason: "deny modified action" };
    };
    const agent = f.agent({ session: { resourceLoader: loader, sessionManager: SessionManager.inMemory(f.home) } });
    await f.run(agent, "generic", { value: "original" });
    assert.deepEqual(f.executions, []);
    await assert.rejects(f.run(agent), /fresh extension runtime/);
    assert.equal(f.closed.length, 2);
  }));

test("loader failure closes the guard and preserves setup failure", async () =>
  fixture(async (f) => {
    const loader = new DefaultResourceLoader({
      cwd: f.home,
      agentDir: join(f.home, ".pi", "agent"),
      noExtensions: true,
    });
    loader.getExtensions = () => {
      throw new Error("fixture loader failed");
    };
    await assert.rejects(f.run(f.agent({ session: { resourceLoader: loader } })), /fixture loader failed/);
    assert.equal(f.closed.length, 1);
  }));

// Pi 0.99 adds ctx.executeTool. Older hosts still enforce all their executable tool paths.
test("nested SDK calls cannot evade the final approval hook (native 0.99)", async (t) =>
  fixture(async (f) => {
    let nestedSupported = false;
    const nested: ToolDefinition = {
      name: "outer",
      label: "outer",
      description: "Nested test",
      parameters: Type.Object({}),
      execute: async (_id, _input, _signal, _update, context) => {
        const ctx = context as typeof context & {
          executeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
        };
        if (ctx.executeTool) {
          nestedSupported = true;
          await ctx.executeTool("generic", { value: "nested" });
        }
        return { content: [{ type: "text", text: "done" }], details: undefined };
      },
    };
    f.evaluate = async (request) =>
      request.toolName === "outer" ? { decision: "allow" } : { decision: "block", reason: "nested denied" };
    await f.run(f.agent({ tools: [nested, f.tool] }), "outer");
    if (process.env.DW_REQUIRE_NESTED) assert.equal(nestedSupported, true);
    if (!nestedSupported) {
      t.skip("ctx.executeTool unavailable on this SDK");
      return;
    }
    assert.deepEqual(
      f.calls.map((call) => call.toolName),
      ["outer", "generic"],
    );
    assert.deepEqual(f.executions, []);
  }));

test("concurrent actual children bind separate guards and close once each", async () =>
  fixture(async (f) => {
    let release!: () => void;
    let entered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrivals = 0;
    f.evaluate = async () => {
      if (++arrivals === 1) {
        entered();
        await barrier;
      } else release();
      return { decision: "allow" };
    };
    f.core.setResponses(
      Array.from({ length: 8 }, () => (context) => {
        const last = context.messages.at(-1);
        return last?.role === "toolResult"
          ? fauxAssistantMessage("done", { stopReason: "stop" })
          : fauxAssistantMessage(fauxToolCall("generic", { value: "concurrent" }), { stopReason: "toolUse" });
      }),
    );
    const agent = f.agent();
    const managers: string[] = [];
    const run = (thread: string) =>
      agent.run("concurrent task", {
        thread,
        model: "fauxtest-child-approval-fixture/local",
        onSessionCreated: ({ sessionId }) => managers.push(sessionId),
      });
    const first = run("first");
    try {
      await firstEntered;
      await Promise.all([first, run("second")]);
      assert.equal(f.calls.length, 2);
      assert.equal(f.executions.length, 2);
      assert.equal(f.closed.length, 2);
      assert.equal(new Set(f.closed).size, 2);
      assert.equal(new Set(managers).size, 2);
    } finally {
      release();
    }
  }));

test("bind failure closes guard once before child admission", async () =>
  fixture(async (f) => {
    const loader = new DefaultResourceLoader({
      cwd: f.home,
      agentDir: join(f.home, ".pi", "agent"),
      noExtensions: true,
      extensionFactories: [
        (pi) => {
          pi.on("session_start", () => {
            f.scope.bind(f.root);
          });
        },
      ],
    });
    await loader.reload();
    await assert.rejects(f.run(f.agent({ session: { resourceLoader: loader } })), /approval authority/);
    assert.equal(f.closed.length, 1);
    assert.deepEqual(f.executions, []);
  }));

import { pathToFileURL } from "node:url";

// Optional cross-fork contract verification, without a runtime dependency on Auto Mode.
// Run with DW_AUTOMODE_TEST_HELPERS pointing to the gate owner's test-helpers.ts.
test(
  "actual gate handoff: live mode/config changes reach original SDK child execution",
  {
    skip: !process.env.DW_AUTOMODE_TEST_HELPERS,
  },
  async () =>
    fixture(async (f) => {
      delete globals[slot];
      const { setupHookTest, baseConfig, createFakeCtx } = await import(
        pathToFileURL(process.env.DW_AUTOMODE_TEST_HELPERS as string).href
      );
      const config = baseConfig();
      const ctx = createFakeCtx([], { sessionManager: f.root, cwd: f.home });
      const h = await setupHookTest({ config, ctx });
      await h.emit("before_agent_start", { systemPrompt: "root", systemPromptOptions: { contextFiles: [] } }, ctx);
      try {
        const agent = f.agent();
        await f.run(agent, "generic", { value: "ON" }, "live");
        await h.commands.get("automode").handler("off", ctx);
        await f.run(agent, "generic", { value: "OFF" }, "live");
        const originalBash = createCodingTools(f.home).find((tool) => tool.name === "bash");
        assert.ok(originalBash);
        let bashExecuted = 0;
        const bashSpy = {
          ...originalBash,
          execute: async (...args: Parameters<typeof originalBash.execute>) => {
            bashExecuted++;
            return originalBash.execute(...args);
          },
        };
        await f.run(f.agent({ tools: [bashSpy] }), "bash", {
          command: "bash -n <<'PROBE'\nsystemctl enable harmless-probe.service\nPROBE",
        });
        assert.equal(bashExecuted, 0, "actual parent OFF blocks the original bash probe before execution");
        await h.commands.get("automode").handler("on", ctx);
        config.permissionDeny = [{ tool: "generic" }];
        await h.commands.get("automode").handler("reload", ctx);
        await f.run(agent, "generic", { value: "ON-deny" }, "live");
        assert.deepEqual(f.executions, ["ON"]);
        config.permissionDeny = [];
        await h.commands.get("automode").handler("reload", ctx);
        await f.run(agent, "generic", { value: "ON-allowed" }, "live");
        assert.deepEqual(f.executions, ["ON", "ON-allowed"]);
        await h.emit("session_shutdown", {}, ctx);
        await assert.rejects(f.run(agent), /approval authority/);
      } finally {
        await h.emit("session_shutdown", {}, ctx);
      }
    }),
);

test("failed gate admission cannot later fall back to missing-slot no-gate", async () =>
  fixture(async (f) => {
    const agent = f.agent();
    f.status = "unavailable";
    await assert.rejects(f.run(agent), /approval authority/);
    delete globals[slot];
    await assert.rejects(f.run(agent), /approval authority/);
    assert.deepEqual(f.executions, []);
  }));

for (const change of ["off-on", "reload", "model_select", "session_shutdown"]) {
  test(
    `actual gate rejects pending old-policy allow after ${change}`,
    {
      skip: !process.env.DW_AUTOMODE_TEST_HELPERS,
    },
    async () =>
      fixture(async (f) => {
        delete globals[slot];
        const { setupHookTest, createFakeCtx } = await import(
          pathToFileURL(process.env.DW_AUTOMODE_TEST_HELPERS as string).href
        );
        const ctx = createFakeCtx([], { sessionManager: f.root, cwd: f.home });
        let entered!: () => void;
        let finish!: (value: unknown) => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const h = await setupHookTest({
          ctx,
          classifier: () => {
            entered();
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
        });
        await h.emit("before_agent_start", { systemPrompt: "root", systemPromptOptions: { contextFiles: [] } }, ctx);
        const run = f.run(f.agent());
        try {
          await started;
          if (change === "off-on") {
            await h.commands.get("automode").handler("off", ctx);
            await h.commands.get("automode").handler("on", ctx);
          } else if (change === "reload") await h.commands.get("automode").handler("reload", ctx);
          else await h.emit(change, {}, ctx);
          finish({ decision: "allow", tier: "none", reason: "stale approval" });
          await run;
          assert.deepEqual(f.executions, []);
        } finally {
          finish?.({ decision: "block", tier: "none", reason: "cleanup" });
          await run.catch(() => {});
          await h.emit("session_shutdown", {}, ctx);
        }
      }),
  );
}

test("cancellation closes a pending guard once and prevents execution", async () =>
  fixture(async (f) => {
    const controller = new AbortController();
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.evaluate = async () => {
      entered();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { decision: "allow" };
    };
    f.core.setResponses([
      fauxAssistantMessage(fauxToolCall("generic", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("done", { stopReason: "stop" }),
    ]);
    const run = f.agent().run("cancel", { model: "fauxtest-child-approval-fixture/local", signal: controller.signal });
    try {
      await started;
      controller.abort();
      assert.equal(f.closed.length, 1, "closure is immediate, not delayed until provider finishes");
      finish();
      await assert.rejects(run, /aborted/);
      assert.equal(f.closed.length, 1);
      assert.deepEqual(f.executions, []);
    } finally {
      finish?.();
      await run.catch(() => {});
    }
  }));

import { WorkflowManager } from "../dist/index.js";

test("manager automatically propagates actual parent identity into nested workflow children", async () =>
  fixture(async (f) => {
    f.core.setResponses([
      fauxAssistantMessage(fauxToolCall("generic", { value: "manager-child" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done", { stopReason: "stop" }),
    ]);
    f.evaluate = async () => ({ decision: "block", reason: "parent OFF" });
    const manager = new WorkflowManager({
      cwd: f.home,
      modelRegistry: f.registry,
      mainModel: "fauxtest-child-approval-fixture/local",
      inheritMainModel: true,
    });
    manager.setParentSessionManager(f.root);
    const child = `export const meta = { name: "child", description: "child" };
return await agent("child", { model: "fauxtest-child-approval-fixture/local" });`;
    const script = `export const meta = { name: "parent", description: "parent" };
return await workflow(${JSON.stringify(child)});`;
    await manager.runSync(script, {}, { tools: [f.tool] });
    assert.deepEqual(f.executions, []);
    assert.equal(f.calls.length, 1);
    assert.equal(f.closed.length, 1);
  }));

test("two parents never exchange consent; handoff reacquires only explicitly bound destination", async () =>
  fixture(async (f) => {
    const other = SessionManager.inMemory(f.home);
    const modes = new Map<object, boolean>([
      [f.root, true],
      [other, false],
    ]);
    const owners: object[] = [];
    globals[slot] = {
      version: 1,
      lookupRoot: (root?: object) => ({ status: root && modes.has(root) ? "available" : "unavailable" }),
      openChildGuard: (root: object) => {
        owners.push(root);
        return {
          evaluate: async () => ({ decision: modes.get(root) ? "allow" : "block", reason: "OFF no UI" }),
          close: () => {},
        };
      },
    };
    const first = f.agent();
    const second = f.agent({ childApprovalScope: new ChildApprovalScope(other) });
    await f.run(first, "generic", { value: "first" }, "turn");
    await f.run(second, "generic", { value: "second" }, "turn");
    f.scope.bind(other);
    await f.run(first, "generic", { value: "adopted-off" }, "turn");
    modes.set(other, true);
    await f.run(first, "generic", { value: "destination-on" }, "turn");
    assert.deepEqual(f.executions, ["first", "destination-on"]);
    assert.deepEqual(owners, [f.root, other, other, other]);
  }));

test("injected runtime already bound by an ungated child cannot later become a guarded shared runtime", async () =>
  fixture(async (f) => {
    const bridge = globals[slot];
    delete globals[slot];
    const loader = new DefaultResourceLoader({
      cwd: f.home,
      agentDir: join(f.home, ".pi", "agent"),
      noExtensions: true,
    });
    await loader.reload();
    const agent = f.agent({ session: { resourceLoader: loader } });
    await f.run(agent);
    globals[slot] = bridge;
    await assert.rejects(f.run(agent), /fresh extension runtime/);
    assert.equal(f.executions.length, 1);
    assert.equal(f.closed.length, 1);
  }));
