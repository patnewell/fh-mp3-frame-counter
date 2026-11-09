import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { finished, pipeline } from "node:stream/promises";
import { MIMEType } from "node:util";
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { countFrames } from "../mp3/count.ts";
import { describeUploadError, UploadError } from "./error.ts";

interface UploadSettings {
  readonly tempDirectory: string;
  readonly maxFileBytes: number;
}

export function registerUploadRoute(app: FastifyInstance, settings: UploadSettings): void {
  app.register(multipart, {
    limits: { files: 1, fields: 0, parts: 1, fileSize: settings.maxFileBytes, headerPairs: 32 },
  });
  app.setErrorHandler((error: unknown, request, reply) => {
    const problem = describeUploadError(error);
    // A rejected sender may still be writing. Flush the error before closing its connection.
    reply.header("connection", "close");
    reply.raw.once("finish", () => request.raw.destroy());
    return reply.code(problem.status).send({ error: problem.message });
  });
  app.post(
    "/file-upload",
    {
      onRequest: async (request) => validateMultipartHeaders(request),
      schema: {
        response: {
          200: {
            type: "object",
            required: ["frameCount"],
            additionalProperties: false,
            properties: { frameCount: { type: "integer", minimum: 1 } },
          },
        },
      },
    },
    async (request) => {
      const directory = await mkdtemp(join(settings.tempDirectory, "mp3-"));
      try {
        // The client filename is never used as a path or logged.
        const path = join(directory, "upload.mp3");
        await receiveUpload(request, path);
        return { frameCount: await countFrames(path) };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

function validateMultipartHeaders(request: FastifyRequest): void {
  const encoding = request.headers["content-encoding"];
  if (encoding !== undefined && encoding.toLowerCase() !== "identity") {
    throw new UploadError(415, "Content-Encoding must be absent or identity.");
  }
  let type: MIMEType;
  try {
    type = new MIMEType(request.headers["content-type"] ?? "");
  } catch {
    throw new UploadError(415, "Use multipart/form-data with one file field named file.");
  }
  if (type.essence !== "multipart/form-data") {
    throw new UploadError(415, "Use multipart/form-data with one file field named file.");
  }
  const boundary = type.params.get("boundary");
  // RFC 2046 bounds the delimiter and excludes a trailing space.
  if (!boundary || !/^[0-9A-Za-z'()+_,./:=? -]{1,70}$/.test(boundary) || boundary.endsWith(" ")) {
    throw new UploadError(400, "Provide a valid multipart boundary.");
  }
  // Pass one canonical parameter to prevent MIME/parser interpretation differences.
  request.headers["content-type"] = `multipart/form-data; boundary="${boundary}"`;
}

async function receiveUpload(request: FastifyRequest, path: string): Promise<void> {
  let received = false;
  for await (const part of request.parts()) {
    if (part.type !== "file" || part.fieldname !== "file") {
      if (part.type === "file") part.file.destroy();
      throw new UploadError(400, "Expected exactly one file field named file.");
    }
    await pipeline(part.file, createWriteStream(path, { flags: "wx", mode: 0o600 }));
    if (part.file.truncated) throw new UploadError(413, "The file exceeds the upload limit.");
    received = true;
  }
  // A closing multipart delimiter does not establish that the HTTP epilogue ended.
  const bodyComplete = finished(request.raw, { readable: true, writable: false, cleanup: true });
  request.raw.resume();
  await bodyComplete;
  if (!received) throw new UploadError(400, "Expected exactly one file field named file.");
}
