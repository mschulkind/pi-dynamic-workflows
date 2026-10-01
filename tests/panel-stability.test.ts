import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Input, type Terminal, type TUI, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { installMixedFleet } from "../src/mixed-fleet.js";
import { installTaskPanel } from "../src/task-panel.js";
import type { WorkflowManager } from "../src/workflow-manager.js";

const slot = Symbol.for("pi.mixed-work.fleet.v1");
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;

class TestScreen extends TuiMainScreen {
  flush(): void {
    this.doRender();
  }
}

for (const width of [24, 120]) {
  test(`detailed panel retains its rows through Fleet acknowledgment and redraws at width ${width}`, (t) => {
    t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
    const emitter = new EventEmitter();
    const agent = {
      id: 1,
      label: "Inspect",
      prompt: "inspect",
      phase: "Scan",
      status: "running",
      model: "provider/model",
      tokenUsage: { input: 100, output: 100, total: 200, cost: 0 },
    };
    const snapshot = { name: "Audit", phases: ["Scan"], currentPhase: "Scan", agents: [agent], logs: [] };
    const run = {
      runId: "run-a",
      workflowName: "Audit",
      status: "running",
      agents: [agent],
      logs: [],
      startedAt: "2026-09-29T00:00:00Z",
    };
    const manager = Object.assign(emitter, {
      getSessionId: () => "session-a",
      listRuns: () => [run],
      getRun: () => ({ snapshot }),
      getSnapshot: () => snapshot,
    }) as unknown as WorkflowManager;
    const disposeBridge = installMixedFleet(manager, "session-a", async () => {});
    const editor = new Input();
    editor.setValue("unfinished user input");
    const below = new Container();
    const writes: string[] = [];
    const terminal = {
      columns: width,
      rows: 24,
      kittyProtocolActive: false,
      start() {},
      stop() {},
      async drainInput() {},
      write: (data: string) => writes.push(data),
      moveBy() {},
      hideCursor() {},
      showCursor() {},
      clearLine() {},
      clearFromCursor() {},
      clearScreen() {},
      setTitle() {},
      setProgress() {},
    } satisfies Terminal;
    const screen = new TestScreen(terminal);
    // Exercise Pi's actual differential renderer, including its optional
    // full-screen clearing on content shrink. No interactive terminal is opened.
    screen.setClearOnShrink(true);
    screen.addChild(editor);
    screen.addChild(below);
    screen.addChild({ render: () => ["Fleet roster", "footer"], invalidate() {} });
    let registrations = 0;
    let redraws = 0;
    let component: { render(width: number): string[]; invalidate(): void; dispose?(): void } | undefined;
    const ui = {
      setWidget(key: string, factory: (tui: TUI, theme: Theme) => typeof component, options: { placement: string }) {
        assert.equal(key, "workflow-tasks");
        assert.equal(options.placement, "belowEditor");
        registrations++;
        component = factory({ requestRender: () => redraws++ } as unknown as TUI, theme);
        assert.ok(component);
        below.addChild(component);
      },
    } as unknown as ExtensionUIContext;
    installTaskPanel(null as unknown as ExtensionAPI, manager, ui);
    try {
      assert.ok(component);
      const initial = screen.render(width);
      screen.flush();
      const initialRedraws = screen.fullRedraws;
      const panelHeight = component.render(width).length;
      assert.equal(panelHeight, 5);
      const entry = (globalThis as Record<symbol, { accepted: boolean }>)[slot];
      // Fleet accepts after registration/refresh, releases on UI teardown, and
      // accepts again. The workflow widget must not trade its detail for a summary.
      for (const accepted of [true, true, false, true, false]) {
        entry.accepted = accepted;
        agent.tokenUsage.output += 100;
        agent.tokenUsage.total += 100;
        emitter.emit("tokenUsage", { runId: run.runId });
        t.mock.timers.tick(2000);
        component.invalidate();
        const lines = screen.render(width);
        screen.flush();
        assert.equal(screen.fullRedraws, initialRedraws, "updates stay differential instead of clearing the screen");
        assert.equal(component.render(width).length, panelHeight, `accepted=${accepted}`);
        assert.equal(lines.length, initial.length);
        assert.ok(lines.some((line) => line.includes("[1] ● Inspect")));
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        assert.equal(editor.getValue(), "unfinished user input");
        assert.equal("handleInput" in component, false, "panel remains passive");
      }
      const final = screen.render(width);
      assert.notDeepEqual(final, initial, "token updates are still visible");
      assert.ok(final.some((line) => line.includes("tok/s out")) || width === 24);
      assert.ok(writes.length > 1, "the actual terminal writer received updates");
      assert.ok(
        writes.every((write) => !write.includes("\u001b[2J")),
        "no screen clears after acknowledgment",
      );
      assert.equal(registrations, 1, "redraws do not replace or reorder widgets");
      assert.equal(redraws, 10, "manager events and detailed timer both repaint");
      component.dispose?.();
      const before = redraws;
      emitter.emit("tokenUsage", { runId: run.runId });
      t.mock.timers.tick(2000);
      assert.equal(redraws, before, "disposal releases listeners and timer");
    } finally {
      component?.dispose?.();
      disposeBridge();
    }
  });
}
