import { readdir, readFile } from "node:fs/promises";
import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { fixturePath, formFor, withHttpApp } from "../helpers/http.ts";

function multipartBytes(bytes: Uint8Array, boundary = "mp3-boundary"): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

describe("multipart request contract", () => {
  it.each([
    "multipart/form-data; boundary=mp3-boundary",
    'MULTIPART/FORM-DATA; BOUNDARY="mp3-boundary"',
    'multipart/form-data ; boundary="mp3-boundary"',
    'multipart/form-data;\tboundary="mp3-boundary"',
    "multipart/form-data; charset=utf-8; boundary=mp3-boundary",
    "multipart/form-data; boundary=mp3-boundary; boundary=ignored",
  ])("normalizes valid MIME syntax: %s", async (contentType) => {
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: new Uint8Array(multipartBytes(await readFile(fixturePath("cbr-stereo-44100.mp3")))),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ frameCount: 21 });
    });
  });

  it.each([
    "multipart/form-data",
    'multipart/form-data; boundary=""',
    'multipart/form-data; boundary="ends-with-space "',
    'multipart/form-data; boundary="not;permitted"',
    `multipart/form-data; boundary=${"b".repeat(71)}`,
  ])("rejects an invalid delimiter before parsing: %s", async (contentType) => {
    await withHttpApp({}, async ({ url, directory }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: "invalid",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Provide a valid multipart boundary." });
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it.each([undefined, "invalid", "text/plain", "audio/mpeg"])(
    "rejects request type %s",
    async (contentType) => {
      await withHttpApp({}, async ({ url }) => {
        const response = await fetch(`${url}/file-upload`, {
          method: "POST",
          ...(contentType === undefined ? {} : { headers: { "content-type": contentType } }),
        });
        expect(response.status).toBe(415);
        expect(await response.json()).toEqual({ error: expect.any(String) });
      });
    },
  );

  it.each(["gzip", "br"])("rejects %s content encoding", async (encoding) => {
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        headers: { "content-encoding": encoding },
        body: formFor(await readFile(fixturePath("cbr-stereo-44100.mp3"))),
      });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    });
  });

  it("permits identity encoding and a quoted delimiter containing permitted punctuation", async () => {
    await withHttpApp({}, async ({ url }) => {
      const boundary = "a:b?c(d)' e";
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        headers: {
          "content-encoding": "identity",
          "content-type": `multipart/form-data; boundary="${boundary}"`,
        },
        body: new Uint8Array(
          multipartBytes(await readFile(fixturePath("cbr-stereo-44100.mp3")), boundary),
        ),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ frameCount: 21 });
    });
  });

  it("rejects an incomplete first part and disposes partial bytes", async () => {
    await withHttpApp({}, async ({ url, directory }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=b" },
        body: '--b\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\n\r\npartial',
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it("does not finish a response while the HTTP epilogue remains open", async () => {
    await withHttpApp({}, async ({ url, directory }) => {
      let responded = false;
      const outgoing = request(`${url}/file-upload`, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=mp3-boundary" },
      });
      const response = new Promise<string>((resolve, reject) => {
        outgoing.once("error", reject);
        outgoing.once("response", (incoming) => {
          responded = true;
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.once("error", reject);
          incoming.once("end", () => resolve(Buffer.concat(chunks).toString()));
        });
      });
      try {
        outgoing.write(multipartBytes(await readFile(fixturePath("cbr-stereo-44100.mp3"))));
        // Deliberately retain the HTTP body after its closing multipart delimiter.
        await delay(50);
        expect(responded).toBe(false);
        outgoing.end("epilogue");
        expect(await response).toBe('{"frameCount":21}');
        expect(await readdir(directory)).toEqual([]);
      } finally {
        outgoing.destroy();
      }
    });
  });
});
