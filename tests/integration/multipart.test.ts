import { readFile } from "node:fs/promises";
import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { countFrames } from "../../src/mp3/count.ts";
import { within } from "../helpers/async.ts";
import { audioBytes, fixturePath, formFor, multipart, withHttpApp } from "../helpers/http.ts";
import { withUploadApp } from "../helpers/upload-lifecycle.ts";

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
        body: new Uint8Array(multipart(await audioBytes(), { boundary: "mp3-boundary" })),
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
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: "invalid",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Provide a valid multipart boundary." });
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
        body: new Uint8Array(multipart(await audioBytes(), { boundary })),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ frameCount: 21 });
    });
  });

  it("rejects an incomplete first part", async () => {
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=b" },
        body: '--b\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\n\r\npartial',
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    });
  });

  it("does not finish a response while the HTTP epilogue remains open", async () => {
    const parsed = Promise.withResolvers<void>();
    await withUploadApp(
      {},
      {
        count: async (input, signal) => {
          const result = await countFrames(input, signal);
          parsed.resolve();
          return result;
        },
      },
      async (service) => {
        let bodyCompleteAtResponse: boolean | undefined;
        // Client receipt can lag behind sending. Check HTTP completion at the server's finish event.
        service.app.server.once("request", (request, response) => {
          response.once("finish", () => {
            bodyCompleteAtResponse = request.complete;
          });
        });
        const upload = service.open();
        const responded = vi.fn();
        upload.request.once("response", responded);
        upload.request.write(multipart(await audioBytes()));
        await within(parsed.promise);
        // Let the route continue after parsing while HTTP EOF is still withheld.
        await nextTurn();
        expect(responded).not.toHaveBeenCalled();
        expect(service.admission.active).toBe(1);
        upload.request.end("epilogue");
        const response = await within(upload.response);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ frameCount: 21 });
        expect(bodyCompleteAtResponse).toBe(true);
      },
    );
  });
});
