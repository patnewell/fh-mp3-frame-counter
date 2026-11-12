import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { type AppOptions, createApp } from "../../src/app.ts";
import type { UploadAdmission } from "../../src/upload/admission.ts";

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export function formFor(bytes: Uint8Array, field = "file", filename = "upload.mp3"): FormData {
  const body = new FormData();
  body.append(field, new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), filename);
  return body;
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
