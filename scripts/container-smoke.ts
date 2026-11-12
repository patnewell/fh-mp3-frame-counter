import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

interface ContainerInspection {
  readonly Config: {
    readonly User: string;
    readonly Env: string[];
    readonly StopTimeout: number;
    readonly Healthcheck: { readonly Test: string[] };
  };
  readonly HostConfig: {
    readonly ReadonlyRootfs: boolean;
    readonly Init: boolean;
    readonly CapDrop: string[];
    readonly SecurityOpt: string[];
    readonly Memory: number;
    readonly NanoCpus: number;
    readonly PidsLimit: number;
    readonly Tmpfs?: Readonly<Record<string, string>> | null;
  };
  readonly Mounts: readonly { readonly Destination: string; readonly RW: boolean }[];
  readonly NetworkSettings: {
    readonly Ports: Readonly<
      Record<string, { readonly HostIp: string; readonly HostPort: string }[]>
    >;
  };
  readonly State: {
    readonly Running: boolean;
    readonly ExitCode: number;
    readonly OOMKilled: boolean;
    readonly Health?: { readonly Status: string };
  };
}

/** Use argument arrays throughout: native Windows paths and shell metacharacters stay literal. */
function dockerOutput(args: string[], timeout = 20_000) {
  return promisify(execFile)("docker", args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
}

async function docker(args: string[], timeout?: number): Promise<string> {
  return (await dockerOutput(args, timeout)).stdout.trim();
}

async function inspect(name: string, timeout?: number): Promise<ContainerInspection> {
  const [container] = JSON.parse(
    await docker(["container", "inspect", name], timeout),
  ) as ContainerInspection[];
  assert(container, "Docker did not return the owned container.");
  return container;
}

async function waitForHealth(name: string): Promise<ContainerInspection> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const container = await inspect(name, Math.max(1, deadline - Date.now()));
    assert(container.State.Running, "The container exited before becoming healthy.");
    if (container.State.Health?.Status === "healthy") return container;
    await delay(250);
  }
  throw new Error("The container did not become healthy within 30 seconds.");
}

function assertDeployment(container: ContainerInspection): string {
  const policy = container.HostConfig;
  assert.equal(container.Config.User, "node:node");
  assert.equal(container.Config.StopTimeout, 15);
  assert.deepEqual(container.Config.Healthcheck.Test, ["CMD", "node", "dist/healthcheck.js"]);
  assert(container.Config.Env.includes("NODE_OPTIONS=--max-old-space-size=256"));
  assert.equal(policy.ReadonlyRootfs, true);
  assert.equal(policy.Init, true);
  assert(policy.CapDrop.includes("ALL"));
  assert(
    policy.SecurityOpt.some(
      (option) => option === "no-new-privileges" || option === "no-new-privileges:true",
    ),
  );
  assert.equal(policy.Memory, 1024 * 1024 * 1024);
  assert.equal(policy.NanoCpus, 1_000_000_000);
  assert.equal(policy.PidsLimit, 128);
  assert.deepEqual(Object.keys(policy.Tmpfs ?? {}), [], "The service must not require a tmpfs.");
  assert.deepEqual(container.Mounts, [], "The service must not require an upload storage mount.");
  const bindings = container.NetworkSettings.Ports["3000/tcp"];
  assert.equal(bindings?.length, 1);
  const binding = bindings?.[0];
  assert(binding && binding.HostIp === "127.0.0.1");
  const port = Number(binding.HostPort);
  assert(Number.isInteger(port) && port > 0 && port <= 65_535);
  return `http://127.0.0.1:${port}`;
}

async function assertRuntime(name: string): Promise<void> {
  const version = (await readFile(new URL("../.nvmrc", import.meta.url), "utf8")).trim();
  assert.equal(await docker(["exec", name, "node", "--version"]), `v${version.replace(/^v/, "")}`);
  assert.notEqual(await docker(["exec", name, "id", "-u"]), "0");
  const ownership = await docker([
    "exec",
    name,
    "stat",
    "-c",
    "%u:%g:%a",
    "/app",
    "/app/package.json",
    "/app/dist/server.js",
    "/app/node_modules",
  ]);
  for (const entry of ownership.split("\n")) {
    const [user, group, mode] = entry.split(":");
    assert.equal(user, "0");
    assert.equal(group, "0");
    assert(mode && (Number.parseInt(mode, 8) & 0o022) === 0);
  }
  const payload = await docker(["exec", name, "ls", "-A1", "/app"]);
  assert.deepEqual(payload.split("\n").sort(), ["dist", "node_modules", "package.json"]);
  for (const dependency of ["fastify", "@fastify/multipart"])
    await docker(["exec", name, "test", "-f", `/app/node_modules/${dependency}/package.json`]);
  for (const tool of ["typescript", "vitest", "@biomejs/biome"])
    await docker(["exec", name, "test", "!", "-e", `/app/node_modules/${tool}`]);
  const status = await docker(["exec", name, "cat", "/proc/1/status"]);
  assert.match(status, /^CapEff:\s+0+$/m);
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  // A Linux image supplies these tools even when Docker is invoked from macOS or Windows.
  await assert.rejects(
    docker(["exec", "--user", "0", name, "touch", "/app/unexpected-write"]),
    /Read-only file system/,
  );
}

async function assertHttp(base: string): Promise<void> {
  for (const [path, expected] of [
    ["/health/live", { status: "ok" }],
    ["/health/ready", { status: "ready" }],
  ] as const) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
  const sample = await readFile(new URL("../tests/fixtures/sample.mp3", import.meta.url));
  const form = new FormData();
  form.set("file", new Blob([sample], { type: "audio/mpeg" }), "sample.mp3");
  const response = await fetch(`${base}/file-upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  assert.deepEqual(await response.json(), { frameCount: 6090 });
  const live = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(2000) });
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: "ok" });
}

async function assertCleanStop(name: string): Promise<void> {
  const logs = await docker(["logs", name]);
  const events = logs
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const record = JSON.parse(line) as { readonly event?: unknown };
      return record.event;
    });
  assert.deepEqual(
    events.filter(
      (event) =>
        event === "shutdown_started" ||
        event === "server_stopped" ||
        event === "shutdown_forced" ||
        event === "shutdown_failed",
    ),
    ["shutdown_started", "server_stopped"],
  );
}

/** A unique label permits cleanup even if create/build succeeded before their CLI invocation failed. */
async function removeOwned(label: string): Promise<void> {
  const failures: unknown[] = [];
  for (const kind of ["container", "image"] as const) {
    try {
      const listed = await docker([kind, "ls", "--all", "--quiet", "--filter", `label=${label}`]);
      const identifiers = [...new Set(listed.split("\n").filter(Boolean))];
      if (identifiers.length) {
        await docker([kind, "rm", ...(kind === "container" ? ["--force"] : []), ...identifiers]);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Owned Docker resources could not all be removed.");
}

async function main(): Promise<void> {
  try {
    assert.equal(await docker(["info", "--format", "{{.OSType}}"]), "linux");
  } catch (cause) {
    throw new Error("A running Linux Docker engine is required; the container smoke did not run.", {
      cause,
    });
  }
  const identity = randomUUID();
  const name = `mp3-frame-counter-smoke-${identity}`;
  const image = `mp3-frame-counter-smoke:${identity}`;
  const label = `dev.mp3-frame-counter.smoke=${identity}`;
  let failure: unknown;
  try {
    console.log("Building the pinned production image.");
    await docker(
      ["build", "--label", label, "--tag", image, fileURLToPath(new URL("../", import.meta.url))],
      600_000,
    );
    await docker([
      "create",
      "--name",
      name,
      "--label",
      label,
      "--read-only",
      "--memory",
      "1g",
      "--cpus",
      "1",
      "--pids-limit",
      "128",
      "--init",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--stop-timeout",
      "15",
      "--publish",
      "127.0.0.1::3000",
      image,
    ]);
    await docker(["start", name]);
    const base = assertDeployment(await waitForHealth(name));
    await assertRuntime(name);
    await assertHttp(base);
    await docker(["exec", name, "node", "dist/healthcheck.js"]);
    await docker(["stop", "--time", "15", name]);
    const stopped = await inspect(name);
    assert.equal(stopped.State.Running, false);
    assert.equal(stopped.State.OOMKilled, false);
    assert.equal(stopped.State.ExitCode, 0);
    await assertCleanStop(name);
  } catch (error) {
    failure = error;
    const logs = await dockerOutput(["logs", "--tail", "80", name]).catch(() => undefined);
    if (logs) console.error(logs.stdout, logs.stderr);
  } finally {
    try {
      await removeOwned(label);
    } catch (error) {
      failure = failure
        ? new AggregateError([failure, error], "Container smoke and cleanup failed.")
        : error;
    }
  }
  if (failure) throw failure;
  console.log(
    "Container smoke passed: sample 6090, probes, no upload storage, runtime policy and clean stop.",
  );
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
