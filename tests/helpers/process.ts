import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { type ClientRequest, type IncomingHttpHeaders, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
  readonly directory: string;
  start(entry: URL, environment?: NodeJS.ProcessEnv, args?: readonly string[]): RunningProcess;
  server(
    environment?: NodeJS.ProcessEnv,
    entry?: URL,
    args?: readonly string[],
  ): Promise<RunningServer>;
}

export const compiledServer = new URL("../../dist/server.js", import.meta.url);
export const compiledHealthcheck = new URL("../../dist/healthcheck.js", import.meta.url);

/** A bounded observation does not transfer ownership of the underlying process or socket. */
export async function withinProcess<T>(pending: Promise<T>, milliseconds = 5000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out observing a child process.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Every child runs outside the repository; finally owns termination and private files. */
export async function withProcessSandbox(
  inspect: (sandbox: ProcessSandbox) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "mp3 process "));
  const directory = join(cwd, "private uploads");
  const children: RunningProcess[] = [];
  let results: PromiseSettledResult<ProcessResult>[] = [];
  await mkdir(directory);
  const start = (entry: URL, environment: NodeJS.ProcessEnv = {}, args: readonly string[] = []) => {
    const child = observeProcess(
      spawn(process.execPath, [fileURLToPath(entry), ...args], {
        cwd,
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "0",
          MAX_FILE_BYTES: "104857600",
          MAX_UPLOADS: "4",
          REQUEST_TIMEOUT_MS: "5000",
          SHUTDOWN_GRACE_MS: "500",
          LOG_LEVEL: "info",
          UPLOAD_TEMP_DIR: directory,
          ...environment,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    children.push(child);
    return child;
  };
  try {
    await inspect({
      cwd,
      directory,
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
    results = await Promise.allSettled(children.map(({ exited }) => withinProcess(exited)));
    await rm(cwd, { recursive: true, force: true });
  }
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

function observeProcess(child: ChildProcess): RunningProcess {
  let stdout = "";
  let stderr = "";
  let overflow = false;
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
      if (overflow) reject(new Error("The child exceeded the bounded test log allowance."));
      else resolve({ code, signal, stdout, stderr });
    });
  });
  void exited.catch(() => undefined);
  const records = (): Record<string, unknown>[] =>
    stdout.split("\n").flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return value !== null && typeof value === "object" && !Array.isArray(value)
          ? [value as Record<string, unknown>]
          : [];
      } catch {
        return []; // The final chunk may contain an incomplete JSON line.
      }
    });
  return {
    child,
    exited,
    output: () => stdout + stderr,
    records,
    event: async (name) => {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      const inspect = (): void => {
        const record = records().find((value) => value.event === name);
        if (record) resolve(record);
        else if (child.exitCode !== null || child.signalCode !== null)
          reject(new Error(`Child exited before ${name}: ${stdout}${stderr}`));
      };
      child.stdout?.on("data", inspect);
      child.on("close", inspect);
      inspect();
      try {
        return await withinProcess(promise);
      } finally {
        child.stdout?.off("data", inspect);
        child.off("close", inspect);
      }
    },
  };
}

export interface ProcessUpload {
  readonly request: ClientRequest;
  readonly response: Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>;
}

/** Raw HTTP permits deliberately unfinished bodies and explicit transport framing. */
export function openProcessUpload(
  url: string,
  headers: Record<string, string> = {},
): ProcessUpload {
  const outgoing = request(url, { method: "POST", agent: false, headers });
  const response = new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      outgoing.once("error", reject);
      outgoing.once("response", (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => {
          body += chunk;
        });
        incoming.once("error", reject);
        incoming.once("end", () =>
          resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }),
        );
      });
    },
  );
  void response.catch(() => undefined);
  return { request: outgoing, response };
}
