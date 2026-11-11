import { mkdtemp, readFile, rm } from "node:fs/promises";
import { type ClientRequest, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { type AppOptions, createApp } from "../../src/app.ts";
import type { UploadOperations } from "../../src/upload/route.ts";

export const BOUNDARY = "lifecycle-boundary";

export interface UploadResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface UploadExchange {
  readonly request: ClientRequest;
  readonly response: Promise<UploadResponse>;
  readonly closed: Promise<void>;
}

interface RunningUploadApp {
  readonly app: FastifyInstance;
  readonly admission: ReturnType<typeof createApp>["admission"];
  readonly directory: string;
  open(headers?: Record<string, string>): UploadExchange;
}

export function barrier() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, release: () => resolve() };
}

/** Bound test observations while the test owner still releases every deliberately held operation. */
export async function within<T>(pending: Promise<T>, milliseconds = 2000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out waiting for lifecycle evidence.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function multipart(bytes: Uint8Array, filename = "client.mp3"): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

export function audioBytes(): Promise<Buffer> {
  return readFile(new URL("../fixtures/cbr-stereo-44100.mp3", import.meta.url));
}

/** Own sockets and the temporary parent even when an assertion or the app fails. */
export async function withUploadApp(
  options: AppOptions,
  operations: Partial<UploadOperations>,
  inspect: (service: RunningUploadApp) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "mp3-lifecycle-"));
  try {
    const { app, admission } = createApp(
      { timeoutMs: 5000, ...options, tempDirectory: directory },
      operations,
    );
    const clients = new Set<ClientRequest>();
    try {
      const url = await app.listen({ host: "127.0.0.1", port: 0 });
      await inspect({
        app,
        admission,
        directory,
        open: (headers) => openUpload(url, clients, headers),
      });
    } finally {
      for (const client of clients) client.destroy();
      app.server.closeAllConnections();
      await within(app.close());
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function openUpload(
  url: string,
  clients: Set<ClientRequest>,
  headers: Record<string, string> = {},
): UploadExchange {
  const request = httpRequest(`${url}/file-upload`, {
    method: "POST",
    agent: false,
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "transfer-encoding": "chunked",
      ...headers,
    },
  });
  clients.add(request);
  request.once("close", () => clients.delete(request));
  const closed = new Promise<void>((resolve) =>
    request.once("socket", (socket) => socket.once("close", () => resolve())),
  );
  const response = new Promise<UploadResponse>((resolve, reject) => {
    request.once("error", reject);
    request.once("response", (incoming) => {
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
  });
  // Deliberate disconnect tests observe the original rejection after destroying the request.
  void response.catch(() => undefined);
  return { request, response, closed };
}
