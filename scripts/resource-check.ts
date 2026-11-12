import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIB = 1024 * 1024;
const MEMORY_BUDGET = 256 * MIB;
const BLOCK_BYTES = 8777;
const REPETITIONS = Math.floor((512 * MIB) / BLOCK_BYTES) + 1;
const FILE_BYTES = BLOCK_BYTES * REPETITIONS;
const EXPECTED_FRAMES = 21 * REPETITIONS;
const DEADLINE_MS = 120_000;
const BOUNDARY = "resource-check-boundary";

/** Only a committed frame-only block is retained, on both producer and consumer sides. */
async function upload(base: string): Promise<{ bytes: number; frames: number; elapsedMs: number }> {
  const block = await readFile(new URL("../tests/fixtures/cbr-stereo-44100.mp3", import.meta.url));
  assert.equal(block.length, BLOCK_BYTES);
  assert.equal(
    createHash("sha256").update(block).digest("hex"),
    "52a02a2e1d196ae7c4c05180593578da4177b880c77c545f6ba449b2a17434e4",
  );
  const prefix = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="resource.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const outgoing = request(`${base}/file-upload`, {
    method: "POST",
    agent: false,
    signal: deadline,
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "content-length": String(prefix.length + FILE_BYTES + suffix.length),
    },
  });
  const response = new Promise<void>((resolve, reject) => {
    outgoing.once("error", reject);
    outgoing.once("response", (incoming) => {
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 4096) incoming.destroy(new Error("Oversized resource-test response."));
      });
      incoming.once("error", reject);
      incoming.once("end", () => {
        try {
          assert.equal(incoming.statusCode, 200);
          assert.deepEqual(JSON.parse(body), { frameCount: EXPECTED_FRAMES });
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
  void response.catch(() => undefined);
  const started = performance.now();
  try {
    outgoing.write(prefix);
    for (let repetition = 0; repetition < REPETITIONS; repetition++) {
      if (!outgoing.write(block)) await once(outgoing, "drain", { signal: deadline });
    }
    outgoing.end(suffix);
    await response;
    const live = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(2000) });
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "ok" });
    return { bytes: FILE_BYTES, frames: EXPECTED_FRAMES, elapsedMs: performance.now() - started };
  } finally {
    outgoing.destroy();
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function message(
  child: ChildProcess,
  predicate: (value: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
  const receive = (value: unknown): void => {
    if (record(value) && predicate(value)) resolve(value);
  };
  const exited = (): void =>
    reject(new Error("The measured server exited before its observation."));
  const failed = (error: Error): void => reject(error);
  const timeout = setTimeout(() => reject(new Error("Missing server memory observation.")), 10_000);
  child.on("message", receive);
  child.once("exit", exited);
  child.once("error", failed);
  try {
    return await promise;
  } finally {
    clearTimeout(timeout);
    child.off("message", receive);
    child.off("exit", exited);
    child.off("error", failed);
  }
}

/** Discover the port from the existing executable's normal startup event. */
async function serverPort(child: ChildProcess): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  let pending = "";
  const receive = (chunk: string): void => {
    pending += chunk;
    if (pending.length > 16 * 1024) {
      reject(new Error("Server startup output exceeded its observation bound."));
      return;
    }
    let boundary = pending.indexOf("\n");
    while (boundary !== -1) {
      const line = pending.slice(0, boundary);
      pending = pending.slice(boundary + 1);
      try {
        const value: unknown = JSON.parse(line);
        if (record(value) && value.event === "server_started" && typeof value.port === "number") {
          assert(Number.isInteger(value.port) && value.port > 0 && value.port <= 65_535);
          resolve(value.port);
        }
      } catch (error) {
        reject(error);
      }
      boundary = pending.indexOf("\n");
    }
  };
  const exited = (): void => reject(new Error("The existing server exited before startup."));
  const failed = (error: Error): void => reject(error);
  const timer = setTimeout(
    () => reject(new Error("Missing existing-server startup event.")),
    10_000,
  );
  child.stdout?.setEncoding("utf8").on("data", receive);
  child.once("exit", exited);
  child.once("error", failed);
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    child.stdout?.off("data", receive);
    child.stdout?.resume();
    child.off("exit", exited);
    child.off("error", failed);
  }
}

async function nativeCheck(): Promise<Record<string, unknown>> {
  const entrypoint = fileURLToPath(new URL("../dist/server.js", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      "--max-old-space-size=128",
      "--import",
      new URL("./resource-monitor.ts", import.meta.url).href,
      entrypoint,
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        MAX_FILE_BYTES: String(FILE_BYTES),
        MAX_UPLOADS: "1",
        REQUEST_TIMEOUT_MS: String(DEADLINE_MS),
        SHUTDOWN_GRACE_MS: "500",
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  let peakRss = 0;
  let samples = 0;
  let diagnostic = "";
  child.stderr?.setEncoding("utf8").on("data", (text: string) => {
    diagnostic = `${diagnostic}${text}`.slice(-16 * 1024);
  });
  child.on("message", (value: unknown) => {
    if (record(value) && value.event === "memory" && typeof value.peakRssBytes === "number") {
      peakRss = Math.max(peakRss, value.peakRssBytes);
      samples++;
    }
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  try {
    const port = await serverPort(child);
    assert.equal(
      child.spawnargs.at(-1),
      fileURLToPath(new URL("../dist/server.js", import.meta.url)),
      "Measure the existing server entrypoint, not a separate application bootstrap.",
    );
    const baseline = await message(child, (value) => value.event === "memory");
    assert.equal(baseline.entrypoint, entrypoint);
    const result = await upload(`http://127.0.0.1:${port}`);
    const measured = message(child, (value) => value.event === "memory" && value.final === true);
    child.send("measure");
    assert.equal((await measured).entrypoint, entrypoint);
    assert(samples > 0 && peakRss > 0, "Server RSS must be observed, not inferred from heap size.");
    assert(peakRss < MEMORY_BUDGET, `Server peak RSS ${peakRss} exceeded ${MEMORY_BUDGET}.`);
    return {
      ...result,
      serverEntrypoint: entrypoint,
      serverBaselineRssBytes: baseline.rssBytes,
      serverPeakRssBytes: peakRss,
      serverRssCeilingBytes: MEMORY_BUDGET,
      memoryObservation:
        "Isolated server process RSS samples and OS high-water maxRSS, not JS heap.",
      samples,
      survived: true,
    };
  } catch (error) {
    throw new Error(`Native resource check failed. ${diagnostic}`, { cause: error });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Measured server did not close after termination.")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function docker(args: string[], timeout = 20_000): Promise<string> {
  const result = await promisify(execFile)("docker", args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 2 * MIB,
    windowsHide: true,
  });
  return result.stdout.trim();
}

function memoryBytes(text: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB)\s*\//.exec(text);
  assert(match, `Unexpected docker stats memory observation: ${text}`);
  const scale = { B: 1, KiB: 1024, MiB: MIB, GiB: 1024 * MIB };
  const unit = match[2] as keyof typeof scale;
  return Number(match[1]) * scale[unit];
}

async function containerCheck(): Promise<Record<string, unknown>> {
  assert.equal(await docker(["info", "--format", "{{.OSType}}"]), "linux");
  const identity = randomUUID();
  const name = `mp3-resource-${identity}`;
  const image = `mp3-resource:${identity}`;
  const label = `dev.mp3-frame-counter.resource=${identity}`;
  let sampling = false;
  let sampleLoop: Promise<void> | undefined;
  const observations: number[] = [];
  let failure: unknown;
  let measurement: Record<string, unknown> | undefined;
  try {
    await docker(["build", "--label", label, "--tag", image, ROOT], 600_000);
    await docker([
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      label,
      "--read-only",
      "--init",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--cpus",
      "1",
      "--memory",
      "256m",
      "--memory-swap",
      "256m",
      "--pids-limit",
      "128",
      "--stop-timeout",
      "15",
      "--env",
      "NODE_OPTIONS=--max-old-space-size=128",
      "--env",
      `MAX_FILE_BYTES=${FILE_BYTES}`,
      "--env",
      `REQUEST_TIMEOUT_MS=${DEADLINE_MS}`,
      "--env",
      "MAX_UPLOADS=1",
      "--publish",
      "127.0.0.1::3000",
      image,
    ]);
    const inspection = JSON.parse(await docker(["inspect", name])) as {
      HostConfig: {
        ReadonlyRootfs: boolean;
        Memory: number;
        Tmpfs?: Record<string, string> | null;
      };
      Mounts: unknown[];
      NetworkSettings: { Ports: Record<string, { HostPort: string }[]> };
    }[];
    const container = inspection[0];
    assert(container);
    assert.equal(container.HostConfig.ReadonlyRootfs, true);
    assert.equal(container.HostConfig.Memory, MEMORY_BUDGET);
    assert.deepEqual(container.HostConfig.Tmpfs ?? {}, {});
    assert.deepEqual(container.Mounts, []);
    const port = container.NetworkSettings.Ports["3000/tcp"]?.[0]?.HostPort;
    assert(port && /^\d+$/.test(port));
    const base = `http://127.0.0.1:${port}`;
    const readyDeadline = Date.now() + 30_000;
    while (true) {
      const ready = await fetch(`${base}/health/ready`, {
        signal: AbortSignal.timeout(1000),
      }).catch(() => undefined);
      if (ready?.status === 200) {
        assert.deepEqual(await ready.json(), { status: "ready" });
        break;
      }
      await ready?.body?.cancel();
      assert(Date.now() < readyDeadline, "Container failed to become ready.");
      await delay(100);
    }
    sampling = true;
    sampleLoop = (async () => {
      while (sampling) {
        const usage = await docker(
          ["stats", "--no-stream", "--format", "{{.MemUsage}}", name],
          5000,
        );
        if (observations.length < 256) observations.push(memoryBytes(usage));
        await delay(100);
      }
    })();
    void sampleLoop.catch(() => undefined);
    const result = await upload(base);
    sampling = false;
    await sampleLoop;
    assert(observations.length > 0);
    await docker(["stop", "--time", "15", name]);
    const state = JSON.parse(await docker(["inspect", "--format", "{{json .State}}", name])) as {
      OOMKilled: boolean;
      ExitCode: number;
    };
    assert.equal(state.OOMKilled, false);
    assert.equal(state.ExitCode, 0);
    measurement = {
      ...result,
      enforcedContainerMemoryBytes: MEMORY_BUDGET,
      maximumSampledContainerMemoryBytes: Math.max(...observations),
      memoryObservation:
        "docker stats reported container memory; sampled values are not an RSS high-water mark.",
      samples: observations.length,
      readOnlyRoot: true,
      writableUploadMounts: 0,
      survived: true,
    };
  } catch (error) {
    failure = error;
  } finally {
    sampling = false;
    await sampleLoop?.catch(() => undefined);
    const cleanupErrors: unknown[] = [];
    for (const kind of ["container", "image"] as const) {
      try {
        const identifiers = (
          await docker([kind, "ls", "--all", "--quiet", "--filter", `label=${label}`])
        )
          .split("\n")
          .filter(Boolean);
        if (identifiers.length)
          await docker([kind, "rm", ...(kind === "container" ? ["--force"] : []), ...identifiers]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length)
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...cleanupErrors],
        "Resource check cleanup failed.",
      );
  }
  if (failure) throw failure;
  assert(measurement);
  return measurement;
}

const containerMode = process.argv.includes("--container");
assert(process.argv.slice(2).every((arg) => arg === "--container"));
const pinnedNode = (await readFile(new URL("../.nvmrc", import.meta.url), "utf8")).trim();
assert.equal(
  process.version,
  `v${pinnedNode}`,
  "Use the pinned Node runtime for resource evidence.",
);
const actualStartedAtUtc = new Date().toISOString();
const revision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
const workingTree = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(revision.status, 0);
assert.equal(workingTree.status, 0);
let report: Record<string, unknown>;
try {
  const result = await (containerMode ? containerCheck() : nativeCheck());
  report = { status: "passed", ...result };
} catch (error) {
  const unavailable = containerMode && record(error) && error.code === "ENOENT";
  report = {
    status: unavailable ? "unavailable" : "failed",
    error: error instanceof Error ? error.message : "Resource check failed.",
  };
  console.error(error);
  process.exitCode = 1;
}
report = {
  ...report,
  mode: containerMode ? "container" : "native",
  revision: revision.stdout.trim(),
  workingTreeDirty: workingTree.stdout.length > 0,
  actualStartedAtUtc,
  actualFinishedAtUtc: new Date().toISOString(),
  runtime: process.version,
  fileBytes: FILE_BYTES,
  repetitions: REPETITIONS,
  independentExpectedFrames: EXPECTED_FRAMES,
  clientPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  qualification:
    "A resource regression for this lazy input; not a production throughput benchmark or measured comparison with the old implementation.",
};
await mkdir(new URL("../reports/", import.meta.url), { recursive: true });
await writeFile(
  new URL(`../reports/resources-${containerMode ? "container" : "native"}.json`, import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report));
