import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { chmod, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { defaultPersistenceFs } from "../src/fs-persistence.js";
import { createRunRecordStore, runDetail } from "../src/run-record-store.js";
import { createWorkflowPerformance, workflowPerformance } from "../src/workflow-performance.js";

test("disabled diagnostics do not clock or start timers", (t) => {
  const previous = process.env.PI_WORKFLOW_PERF_DIR;
  delete process.env.PI_WORKFLOW_PERF_DIR;
  t.mock.method(performance, "now", () => {
    throw new Error("diagnostic clock accessed");
  });
  t.mock.method(globalThis, "setInterval", () => {
    throw new Error("diagnostic timer started");
  });
  assert.equal(workflowPerformance(), undefined);
  const store = createRunRecordStore(defaultPersistenceFs());
  assert.equal(store.read(join(tmpdir(), "absent-workflow-diagnostic-fixture.json")), null);
  const directory = mkdtempSync(join(tmpdir(), "workflow-perf-disabled-"));
  try {
    const path = join(directory, "run.json");
    store.save(path, {
      runId: "disabled",
      workflowName: "synthetic",
      script: "return 1",
      status: "running",
      phases: [],
      agents: [],
      logs: [],
      startedAt: "now",
      updatedAt: "now",
    });
    assert.equal(store.read(path)?.runId, "disabled");
    const preview = store.peek(path);
    assert.ok(preview);
    assert.equal(runDetail(preview).runId, "disabled");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  if (previous !== undefined) process.env.PI_WORKFLOW_PERF_DIR = previous;
});

test("recorder bounds growth, whitelists metadata, serializes asynchronously and closes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-perf-"));
  const recorder = await createWorkflowPerformance(directory);
  assert.ok(recorder);
  try {
    assert.equal(await createWorkflowPerformance(directory), undefined, "one writer per directory");
    for (let i = 0; i < 100_000; i++) {
      recorder.add("cacheHit");
      recorder.add("readBytes", 17);
      recorder.add("prompt-output-url-secret" as never);
    }
    const pending = recorder.flush();
    assert.equal((await readdir(directory)).filter((name) => name.endsWith(".json")).length, 0);
    await Promise.all([pending, recorder.flush(), recorder.flush()]);
    for (let i = 0; i < 5; i++) await recorder.flush();
    const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 2);
    for (const file of files) {
      const text = await readFile(join(directory, file), "utf8");
      assert.ok(text.length < 4096);
      assert.ok(!text.includes(directory));
      assert.ok(!text.includes("secret"));
      const snapshot = JSON.parse(text);
      assert.equal(snapshot.counts.cacheHit, 100_000);
      assert.equal(snapshot.counts.readBytes, 1_700_000);
      assert.ok(snapshot.counts.flushSkipped >= 1);
    }
    await recorder.close();
    assert.deepEqual((await readdir(directory)).sort(), files.sort());
  } finally {
    await recorder.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid directory and recorder IO failure are nonfatal", async () => {
  assert.equal(await createWorkflowPerformance("relative"), undefined);
  const directory = await mkdtemp(join(tmpdir(), "workflow-perf-failure-"));
  await chmod(directory, 0o755);
  assert.equal(await createWorkflowPerformance(directory), undefined);
  await chmod(directory, 0o700);
  const recorder = await createWorkflowPerformance(directory);
  assert.ok(recorder);
  await rm(directory, { recursive: true });
  await recorder.flush();
  recorder.add("cacheHit");
  await recorder.close();
});

test("enabled storage metrics cover actual replay/hash/clone work without content", async () => {
  const { spawnSync } = await import("node:child_process");
  const directory = await mkdtemp(join(tmpdir(), "workflow-perf-integration-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import { workflowPerformance, stopWorkflowPerformance } from './src/workflow-performance.ts';
      import { createRunRecordStore, runDetail } from './src/run-record-store.ts';
      import { defaultPersistenceFs } from './src/fs-persistence.ts';
      import { join } from 'node:path';
      workflowPerformance();
      const deadline = Date.now() + 5000;
      while (!workflowPerformance() && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
      const metrics = workflowPerformance();
      if (!metrics) throw new Error('capture unavailable');
      const store = createRunRecordStore(defaultPersistenceFs());
      const path = join(process.env.PI_WORKFLOW_PERF_DIR, 'fixture.json');
      store.save(path, {runId:'secret-run', workflowName:'secret-name', script:'secret-prompt', status:'running',
        phases:[], logs:[], agents:[], startedAt:'now', updatedAt:'now', journal:[{index:0,hash:'fixture',result:'x'.repeat(5*1024*1024)}]});
      store.read(path);
      runDetail(store.peek(path));
      await metrics.flush();
      stopWorkflowPerformance();
      await metrics.close();
      if (workflowPerformance()) throw new Error('capture survived shutdown');
    `,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PI_WORKFLOW_PERF_DIR: directory },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const files = (await readdir(directory)).filter((name) => /^workflow-perf-\d.json$/.test(name));
    assert.ok(files.length > 0);
    for (const name of files) {
      const text = await readFile(join(directory, name), "utf8");
      assert.ok(!text.includes("secret"));
      const { counts } = JSON.parse(text);
      assert.equal(counts.read, 1);
      assert.equal(counts.detail, 1);
      assert.equal(counts.cacheMiss, 2);
      assert.ok(counts.readBytes > 10 * 1024 * 1024);
      assert.ok(counts.hashCalls >= 3);
      assert.equal(counts.cloneCalls, 2);
      assert.ok(counts.cellsCalls >= 3);
    }
    assert.ok(!(await readdir(directory)).includes("workflow-perf.lock"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cadence measures process CPU and timer lateness; deadline stops capture", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-perf-cadence-"));
  let callback: (() => void) | undefined;
  let cleared = false;
  t.mock.method(globalThis, "setInterval", (fn: () => void, delay: number) => {
    assert.equal(delay, 5000);
    callback = fn;
    return { unref() {} };
  });
  t.mock.method(globalThis, "clearInterval", () => {
    cleared = true;
  });
  let now = 0;
  let cpu = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.method(process, "cpuUsage", () => ({ user: cpu, system: 0 }));
  const recorder = await createWorkflowPerformance(directory);
  assert.ok(recorder);
  assert.ok(callback);
  try {
    now = 5100;
    cpu = 200;
    callback();
    await recorder.flush();
    const first = JSON.parse(await readFile(join(directory, "workflow-perf-0.json"), "utf8"));
    assert.equal(first.counts.loopLagMs, 100);
    assert.equal(first.counts.cpuMicros, 200);
    for (let i = 1; i < 120; i++) {
      now += 5000;
      callback();
    }
    await recorder.close();
    assert.equal(recorder.active, false);
    assert.equal(cleared, true);
    assert.ok((await readdir(directory)).length <= 2);
  } finally {
    await recorder.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("slow writer has one in-flight snapshot; shutdown waits without queue growth", async () => {
  const io = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "workflow-perf-slow-"));
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let writes = 0;
  const recorder = await createWorkflowPerformance(directory, {
    ...io,
    open: (async (...args: Parameters<typeof io.open>) => {
      const handle = await io.open(...args);
      if (!String(args[0]).endsWith(".tmp")) return handle;
      return {
        writeFile: async (text: string) => {
          writes++;
          started?.();
          await barrier;
          await handle.writeFile(text);
        },
        close: () => handle.close(),
      } as unknown as typeof handle;
    }) as typeof io.open,
  });
  assert.ok(recorder);
  try {
    const first = recorder.flush();
    await entered;
    for (let i = 0; i < 1000; i++) assert.equal(recorder.flush(), first);
    assert.equal(writes, 1);
    assert.equal((await readdir(directory)).filter((name) => name.endsWith(".tmp")).length, 1);
    const closing = recorder.close();
    assert.equal(recorder.active, false);
    assert.ok((await readdir(directory)).includes("workflow-perf.lock"));
    release?.();
    await closing;
    const files = await readdir(directory);
    assert.deepEqual(files.sort(), ["workflow-perf-0.json", "workflow-perf-1.json"]);
    const snapshot = JSON.parse(await readFile(join(directory, "workflow-perf-1.json"), "utf8"));
    assert.ok(snapshot.counts.flushSkipped >= 1000);
  } finally {
    release?.();
    await recorder.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("shutdown during asynchronous initialization cleans capture and never re-enables", async () => {
  const { spawnSync } = await import("node:child_process");
  const directory = await mkdtemp(join(tmpdir(), "workflow-perf-init-stop-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import { workflowPerformance, stopWorkflowPerformance } from './src/workflow-performance.ts';
      if (workflowPerformance()) throw new Error('initialization unexpectedly synchronous');
      await stopWorkflowPerformance();
      if (workflowPerformance()) throw new Error('capture resurrected');
    `,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PI_WORKFLOW_PERF_DIR: directory },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!(await readdir(directory)).includes("workflow-perf.lock"));
    assert.ok(!(await readdir(directory)).some((name) => name.endsWith(".tmp")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
