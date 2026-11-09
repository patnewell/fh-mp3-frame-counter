import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fixturePath, formFor, withHttpApp } from "../helpers/http.ts";

const invalidScenarios = [
  "unsupported-mpeg2",
  "empty",
  "junk",
  "truncated",
  "wrong-field",
] as const;

async function invalidForm(scenario: (typeof invalidScenarios)[number]): Promise<FormData> {
  switch (scenario) {
    case "unsupported-mpeg2":
      return formFor(await readFile(fixturePath("unsupported-mpeg2-22050.mp3")));
    case "empty":
      return formFor(new Uint8Array());
    case "junk":
      return formFor(new TextEncoder().encode("private invalid content"));
    case "truncated":
      return formFor((await readFile(fixturePath("cbr-stereo-44100.mp3"))).subarray(0, -1));
    case "wrong-field":
      return formFor(await readFile(fixturePath("cbr-stereo-44100.mp3")), "audio");
  }
}

describe("MP3 upload API", () => {
  it.each([
    ["sample.mp3", 6090],
    ["cbr-stereo-44100.mp3", 21],
    ["cbr-mono-32000-tags.mp3", 15],
    ["vbr-stereo-48000.mp3", 23],
  ] as const)("counts %s through a real HTTP socket", async (file, count) => {
    await withHttpApp({}, async ({ url, directory }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        body: formFor(await readFile(fixturePath(file))),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await response.json()).toEqual({ frameCount: count });
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it("uses content rather than the filename or advertised file MIME", async () => {
    await withHttpApp({}, async ({ url }) => {
      const form = new FormData();
      form.append(
        "file",
        new Blob([await readFile(fixturePath("cbr-stereo-44100.mp3"))], { type: "text/plain" }),
        "../../private.txt",
      );
      const response = await fetch(`${url}/file-upload`, { method: "POST", body: form });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ frameCount: 21 });
    });
  });

  it.each(invalidScenarios)(
    "rejects %s input with safe JSON and disposes its file",
    async (scenario) => {
      await withHttpApp({}, async ({ url, directory }) => {
        const response = await fetch(`${url}/file-upload`, {
          method: "POST",
          body: await invalidForm(scenario),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: expect.any(String) });
        expect(await readdir(directory)).toEqual([]);
      });
    },
  );

  it("rejects an empty multipart form", async () => {
    await withHttpApp({}, async ({ url, directory }) => {
      const response = await fetch(`${url}/file-upload`, { method: "POST", body: new FormData() });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it.each(["field", "extra-file", "extra-field"])(
    "enforces the %s multipart limit",
    async (kind) => {
      await withHttpApp({}, async ({ url, directory }) => {
        const form =
          kind === "field" ? new FormData() : formFor(await readFile(fixturePath("sample.mp3")));
        if (kind === "extra-file") form.append("file", new Blob(["extra"]), "second.mp3");
        else form.append(kind === "field" ? "file" : "extra", "value");
        const response = await fetch(`${url}/file-upload`, { method: "POST", body: form });
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ error: expect.any(String) });
        expect(await readdir(directory)).toEqual([]);
      });
    },
  );

  it("returns 413 for oversized data, then still accepts a permitted upload", async () => {
    const bytes = await readFile(fixturePath("cbr-stereo-44100.mp3"));
    await withHttpApp({ maxFileBytes: bytes.length }, async ({ url, directory }) => {
      const oversized = await fetch(`${url}/file-upload`, {
        method: "POST",
        body: formFor(Buffer.concat([bytes, Buffer.of(0)])),
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toEqual({ error: expect.any(String) });
      expect(await readdir(directory)).toEqual([]);
      const accepted = await fetch(`${url}/file-upload`, { method: "POST", body: formFor(bytes) });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ frameCount: 21 });
    });
  });

  it("reports storage failure without revealing paths and recovers when storage returns", async () => {
    await withHttpApp({}, async ({ url, directory }) => {
      await rm(directory, { recursive: true });
      const bytes = await readFile(fixturePath("cbr-stereo-44100.mp3"));
      const failed = await fetch(`${url}/file-upload`, { method: "POST", body: formFor(bytes) });
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: "The upload could not be processed." });
      await mkdir(directory);
      const recovered = await fetch(`${url}/file-upload`, { method: "POST", body: formFor(bytes) });
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toEqual({ frameCount: 21 });
    });
  });
});
