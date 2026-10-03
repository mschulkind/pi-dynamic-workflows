import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type ExtensionAPI, type ExtensionUIContext, initTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { defaultPersistenceFs } from "../src/fs-persistence.js";
import { createRunPersistence, type PersistedRunState } from "../src/run-persistence.js";
import { installTaskPanel } from "../src/task-panel.js";
import type { WorkflowManager } from "../src/workflow-manager.js";
import { openWorkflowNavigator } from "../src/workflow-ui.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

type Disposable = Component & { dispose?(): void };
const theme = {
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
  bold: (text: string) => text,
};
function fixture(id: string, bytes = 0): PersistedRunState {
  return {
    runId: id,
    workflowName: id,
    script: "return 1",
    status: "completed",
    phases: ["phase"],
    agents: [{ id: 1, callId: `${id}:0`, label: "worker", phase: "phase", prompt: "synthetic", status: "done" }],
    journal: [{ index: 0, runId: id, hash: "synthetic", result: "x".repeat(bytes) }],
    logs: [],
    startedAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}
async function withFixture(fn: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "workflow-responsiveness-"));
  const home = mkdtempSync(join(tmpdir(), "workflow-responsiveness-home-"));
  try {
    await withFakeHomeAsync(home, () => fn(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}
function fakeUI() {
  let component: Disposable | undefined;
  let widgetFactory: ((tui: unknown, theme: unknown) => Disposable) | undefined;
  const tui = { requestRender() {}, terminal: { rows: 24 } };
  const ui = {
    notify() {},
    custom: async (
      factory: (tui: unknown, theme: unknown, bindings: unknown, done: () => void) => Disposable | Promise<Disposable>,
    ) => {
      component = await factory(tui, theme, {}, () => {});
    },
    setWidget: (_name: string, factory: typeof widgetFactory) => {
      widgetFactory = factory;
    },
  } as unknown as ExtensionUIContext;
  return {
    ui,
    component: () => {
      assert.ok(component);
      return component;
    },
    widget: () => {
      assert.ok(widgetFactory);
      return widgetFactory(tui, theme);
    },
  };
}

test("actual oversized overlay reads once cold and zero additional times across warm key/redraw loops", async (t) =>
  withFixture(async (directory) => {
    initTheme("dark");
    const real = defaultPersistenceFs();
    let reads = 0,
      bytes = 0;
    const persistence = createRunPersistence(directory, {
      readSync: ((...args: Parameters<typeof real.readSync>) => {
        const n = real.readSync(...args);
        reads++;
        bytes += n;
        return n;
      }) as typeof real.readSync,
    });
    persistence.save(fixture("oversized", 5 * 1024 * 1024));
    const manager = Object.assign(new EventEmitter(), {
      listRuns: () => persistence.list(),
      getRun: () => undefined,
    }) as unknown as WorkflowManager;
    const fake = fakeUI();
    await openWorkflowNavigator({} as ExtensionAPI, manager, fake.ui, { initialRunId: "oversized" });
    const component = fake.component();
    try {
      reads = 0;
      bytes = 0;
      assert.ok(component.render(100).length);
      assert.equal(reads, 1);
      assert.ok(bytes > 5 * 1024 * 1024);
      for (let i = 0; i < 20; i++) {
        component.handleInput?.("j");
        manager.emit("agentUpdate", {});
        component.render(100);
      }
      assert.equal(reads, 1);
      t.diagnostic(JSON.stringify({ coldReads: reads, coldEventBytes: bytes, warmAdditionalReads: 0, warmFrames: 20 }));
      // Same-head committed corruption must drop the selected snapshot in the actual overlay too.
      const log = join(persistence.getRunsDir(), "oversized.json.events.jsonl");
      writeFileSync(log, readFileSync(log, "utf8").replace('"label":"worker"', '"label":"broken"'));
      assert.equal(persistence.load("oversized"), null);
      assert.doesNotThrow(() => component.render(100));
      assert.ok(!component.render(100).join("\n").includes("worker"));
    } finally {
      component.dispose?.();
    }
  }));

test("actual multi-run panel/key/poll loops never hydrate histories", async (t) =>
  withFixture(async (directory) => {
    initTheme("dark");
    const polls: Array<() => void> = [];
    t.mock.method(globalThis, "setInterval", (fn: () => void) => {
      polls.push(fn);
      return { unref() {} };
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    const real = defaultPersistenceFs();
    let reads = 0,
      bytes = 0;
    const persistence = createRunPersistence(directory, {
      readSync: ((...args: Parameters<typeof real.readSync>) => {
        const n = real.readSync(...args);
        reads++;
        bytes += n;
        return n;
      }) as typeof real.readSync,
    });
    const live = new Map();
    for (let i = 0; i < 37; i++) {
      const state = fixture(`run-${i}`, 1024 * 1024);
      if (i < 12) {
        state.status = "running";
        state.agents[0].status = "running";
        live.set(state.runId, {
          status: "running",
          snapshot: { name: state.workflowName, phases: state.phases, agents: state.agents, logs: state.logs },
        });
      }
      persistence.save(state);
    }
    const manager = Object.assign(new EventEmitter(), {
      listRuns: () => persistence.list(),
      getRun: (id: string) => live.get(id),
    }) as unknown as WorkflowManager;
    const fake = fakeUI();
    installTaskPanel({} as ExtensionAPI, manager, fake.ui, { loadSettings: () => ({ progressPanelMode: "detailed" }) });
    const widget = fake.widget();
    await openWorkflowNavigator({} as ExtensionAPI, manager, fake.ui);
    const component = fake.component();
    try {
      reads = 0;
      bytes = 0;
      for (let i = 0; i < 100; i++) {
        for (const poll of polls) poll();
        component.handleInput?.(i % 2 ? "j" : "k");
        manager.emit("agentUpdate", {});
        assert.ok(widget.render(100).length);
        assert.ok(component.render(100).length);
      }
      assert.equal(reads, 0);
      assert.equal(bytes, 0);
      t.diagnostic(
        JSON.stringify({ runs: 37, liveRuns: 12, keyPollFrames: 100, eventReads: reads, eventBytes: bytes }),
      );
    } finally {
      widget.dispose?.();
      component.dispose?.();
    }
  }));
