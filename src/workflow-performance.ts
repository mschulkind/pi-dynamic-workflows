/** Opt-in process-local aggregate diagnostics. Never workflow/request evidence. */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";

const METRICS = [
  "cacheHit",
  "cacheMiss",
  "missAbsent",
  "missGeneration",
  "missSequence",
  "missIdentity",
  "missBytes",
  "missHash",
  "missStamp",
  "cacheOversize",
  "cacheEviction",
  "readBytes",
  "replayEntries",
  "hashCalls",
  "hashBytes",
  "hashMs",
  "cloneCalls",
  "cloneMs",
  "cellsCalls",
  "cellsMs",
  "read",
  "detail",
  "lazy",
  "save",
  "observation",
  "flushSkipped",
  "loopLagMs",
  "cpuMicros",
] as const;
export type PerformanceMetric = (typeof METRICS)[number];
export interface WorkflowPerformance {
  readonly active: boolean;
  add(metric: PerformanceMetric, amount?: number): void;
  now(): number;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** Absolute owner-only directory, fixed two-file retention, one in-flight write.
 * Call explicitly; the disabled path never constructs a recorder or a timer. */
export async function createWorkflowPerformance(
  directory: string,
  io: Pick<typeof import("node:fs/promises"), "mkdir" | "lstat" | "open" | "rename" | "unlink"> = {
    mkdir,
    lstat,
    open,
    rename,
    unlink,
  },
): Promise<WorkflowPerformance | undefined> {
  if (!isAbsolute(directory)) return undefined;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await io.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await io.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.())
      return undefined;
    lock = await io.open(join(directory, "workflow-perf.lock"), "wx", 0o600);
  } catch {
    return undefined;
  }
  const counts = Object.fromEntries(METRICS.map((key) => [key, 0])) as Record<PerformanceMetric, number>;
  let stopped = false;
  let writing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let slot = 0;
  let ticks = 0;
  let previousTime = performance.now();
  let previousCpu = process.cpuUsage();
  const deadline = previousTime + 600_000;
  const add = (metric: PerformanceMetric, amount = 1) => {
    // Runtime whitelist as well as static types: arbitrary metadata cannot enter.
    if (!stopped && !closing && Object.hasOwn(counts, metric) && Number.isFinite(amount) && amount >= 0)
      counts[metric] = Math.min(Number.MAX_SAFE_INTEGER, counts[metric] + amount);
  };
  const flush = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (writing) {
      add("flushSkipped");
      return writing;
    }
    const temporary = join(directory, `workflow-perf-${randomUUID()}.tmp`);
    writing = (async () => {
      try {
        const file = await io.open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify({ format: "workflow-perf-v1", counts }));
        } finally {
          await file.close();
        }
        await io.rename(temporary, join(directory, `workflow-perf-${slot++ % 2}.json`));
      } catch {
        stopped = true;
        clearInterval(timer);
        queueMicrotask(() => {
          void close();
        });
      } finally {
        await io.unlink(temporary).catch(() => {});
      }
    })().finally(() => {
      writing = undefined;
    });
    return writing;
  };
  const close = (): Promise<void> => {
    if (closing) return closing;
    clearInterval(timer);
    closing = (async () => {
      await writing;
      const finalWrite = flush();
      stopped = true;
      await finalWrite;
      await lock?.close().catch(() => {});
      await io.unlink(join(directory, "workflow-perf.lock")).catch(() => {});
    })();
    return closing;
  };
  const timer = setInterval(() => {
    const now = performance.now();
    const cpu = process.cpuUsage();
    add("loopLagMs", Math.max(0, now - previousTime - 5000));
    add("cpuMicros", Math.max(0, cpu.user + cpu.system - previousCpu.user - previousCpu.system));
    previousTime = now;
    previousCpu = cpu;
    if (++ticks >= 120 || now >= deadline) void close();
    else void flush();
  }, 5000);
  timer.unref();
  return {
    get active() {
      return !stopped && !closing;
    },
    add,
    now: () => performance.now(),
    flush,
    close,
  };
}

let diagnostics: WorkflowPerformance | undefined;
let initializing = false;
let initialization: Promise<void> | undefined;
let closed = false;
/** Environment opt-in is read once at the first store creation. No disabled IO. */
export function workflowPerformance(): WorkflowPerformance | undefined {
  if (!initializing) {
    initializing = true;
    const directory = process.env.PI_WORKFLOW_PERF_DIR;
    if (directory)
      initialization = createWorkflowPerformance(directory)
        .then(async (value) => {
          if (closed) await value?.close();
          else diagnostics = value;
        })
        .catch(() => {});
  }
  return diagnostics?.active ? diagnostics : undefined;
}

/** Session replacement/reload must not carry capture into another session. */
export function stopWorkflowPerformance(): Promise<void> | undefined {
  closed = true;
  initializing = true;
  const closing = diagnostics?.close();
  diagnostics = undefined;
  return closing ?? initialization;
}
