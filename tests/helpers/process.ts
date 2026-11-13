import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { within } from "./async.ts";

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunningProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<ProcessResult>;
  output(): string;
  records(): Record<string, unknown>[];
  event(name: string): Promise<Record<string, unknown>>;
}

interface RunningServer {
  readonly process: RunningProcess;
  readonly port: number;
  readonly url: string;
}

interface ProcessSandbox {
  readonly cwd: string;
  start(entry: URL, environment?: NodeJS.ProcessEnv, args?: readonly string[]): RunningProcess;
  server(
    environment?: NodeJS.ProcessEnv,
    entry?: URL,
    args?: readonly string[],
  ): Promise<RunningServer>;
}

export const compiledServer = new URL("../../dist/server.js", import.meta.url);
export const compiledHealthcheck = new URL("../../dist/healthcheck.js", import.meta.url);

/** Every child runs outside the repository; finally owns termination and the isolated cwd. */
export async function withProcessSandbox(
  inspect: (sandbox: ProcessSandbox) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "mp3 process "));
  const children: RunningProcess[] = [];
  let results: PromiseSettledResult<ProcessResult>[] = [];
  const start = (entry: URL, environment: NodeJS.ProcessEnv = {}, args: readonly string[] = []) => {
    const child = observeProcess(
      spawn(process.execPath, [fileURLToPath(entry), ...args], {
        cwd,
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "0",
          MAX_UPLOADS: "4",
          REQUEST_TIMEOUT_MS: "5000",
          SHUTDOWN_GRACE_MS: "500",
          LOG_LEVEL: "info",
          ...environment,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }),
    );
    children.push(child);
    return child;
  };
  try {
    await inspect({
      cwd,
      start,
      server: async (environment = {}, entry = compiledServer, args = []) => {
        const process = start(entry, environment, args);
        const { port } = await process.event("server_started");
        if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new Error("The compiled server did not report its actual listening port.");
        }
        return { process, port, url: `http://127.0.0.1:${port}` };
      },
    });
  } finally {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    results = await Promise.allSettled(children.map(({ exited }) => within(exited, 5000)));
    await rm(cwd, { recursive: true, force: true });
  }
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

function observeProcess(child: ChildProcess): RunningProcess {
  let stdout = "";
  let stderr = "";
  let overflow = false;
  let closed = false;
  const append = (stream: "stdout" | "stderr", text: string): void => {
    if (stdout.length + stderr.length + text.length > 256 * 1024) {
      overflow = true;
      child.kill("SIGKILL");
    } else if (stream === "stdout") stdout += text;
    else stderr += text;
  };
  child.stdout?.setEncoding("utf8").on("data", (text: string) => append("stdout", text));
  child.stderr?.setEncoding("utf8").on("data", (text: string) => append("stderr", text));
  const exited = new Promise<ProcessResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      closed = true;
      if (overflow) reject(new Error("The child exceeded the bounded test log allowance."));
      else resolve({ code, signal, stdout, stderr });
    });
  });
  void exited.catch(() => undefined);
  const records = (): Record<string, unknown>[] =>
    // Ignore only the unfinished last line; malformed complete records must fail the test.
    stdout
      .split("\n")
      .slice(0, -1)
      .map((line) => {
        const value: unknown = JSON.parse(line);
        if (value === null || typeof value !== "object" || Array.isArray(value))
          throw new Error("The child wrote a non-object log record.");
        return value as Record<string, unknown>;
      });
  return {
    child,
    exited,
    output: () => stdout + stderr,
    records,
    event: (name) =>
      vi.waitUntil(
        () => {
          const record = records().find((value) => value.event === name);
          if (record) return record;
          // close follows stdio completion; exit can precede the last captured log chunk.
          if (closed) throw new Error(`Child exited before ${name}: ${stdout}${stderr}`);
          return undefined;
        },
        { timeout: 5000 },
      ),
  };
}
