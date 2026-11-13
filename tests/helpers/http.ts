import { readFile } from "node:fs/promises";
import { type ClientRequest, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { type AppOptions, createApp } from "../../src/app.ts";
import type { UploadAdmission } from "../../src/upload/admission.ts";

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

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export function audioBytes(): Promise<Buffer> {
  return readFile(fixturePath("cbr-stereo-44100.mp3"));
}

export function formFor(bytes: Uint8Array, field = "file", filename = "upload.mp3"): FormData {
  const body = new FormData();
  body.append(field, new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), filename);
  return body;
}

/** Raw multipart bytes are needed for malformed or deliberately unfinished requests. */
export function multipart(
  bytes: Uint8Array,
  { filename = "client.mp3", boundary = BOUNDARY } = {},
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

/** The caller owns the request and must destroy it during cleanup. */
export function openHttpUpload(url: string, headers: Record<string, string> = {}): UploadExchange {
  const request = httpRequest(url, { method: "POST", agent: false, headers });
  const closed = new Promise<void>((resolve) =>
    request.once("socket", (socket) => socket.once("close", () => resolve())),
  );
  const response = new Promise<UploadResponse>((resolve, reject) => {
    request.once("error", reject);
    request.once("response", (incoming) => {
      text(incoming).then(
        (body) => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }),
        reject,
      );
    });
  });
  // Disconnect tests may destroy the request before awaiting its original rejection.
  void response.catch(() => undefined);
  return { request, response, closed };
}

interface RunningApp {
  readonly app: FastifyInstance;
  readonly url: string;
  readonly admission: UploadAdmission;
}

/** Each test owns its listener; cleanup also runs after assertion failures. */
export async function withHttpApp(
  options: AppOptions,
  check: (running: RunningApp) => Promise<void>,
): Promise<void> {
  const { app, admission } = createApp(options);
  try {
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    await check({ app, url, admission });
  } finally {
    await app.close();
  }
}
