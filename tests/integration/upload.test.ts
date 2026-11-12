import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fixturePath, formFor, withHttpApp } from "../helpers/http.ts";
import { ape, id3, id3v1 } from "../helpers/mp3.ts";

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
    ["free-format-stereo-48000.mp3", 22],
  ] as const)("counts %s through a real HTTP socket", async (file, count) => {
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        body: formFor(await readFile(fixturePath(file))),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await response.json()).toEqual({ frameCount: count });
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

  it("counts real audio wrapped in paired ID3 envelopes and stacked terminal tags", async () => {
    const audio = await readFile(fixturePath("cbr-stereo-44100.mp3"));
    const bytes = Buffer.concat([
      id3(Buffer.from("leading metadata"), 4, true),
      audio,
      id3(Buffer.from("terminal metadata"), 4, true),
      id3v1(),
    ]);
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, { method: "POST", body: formFor(bytes) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ frameCount: 21 });
    });
  });

  it("maps a mismatched appended ID3 footer to HTTP 400 and still accepts the original audio", async () => {
    const audio = await readFile(fixturePath("cbr-stereo-44100.mp3"));
    const tag = id3(Buffer.from("metadata"), 4, true);
    tag[tag.length - 1] = 0;
    await withHttpApp({}, async ({ url }) => {
      const invalid = await fetch(`${url}/file-upload`, {
        method: "POST",
        body: formFor(Buffer.concat([audio, tag])),
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: expect.any(String) });
      const valid = await fetch(`${url}/file-upload`, { method: "POST", body: formFor(audio) });
      expect(valid.status).toBe(200);
      expect(await valid.json()).toEqual({ frameCount: 21 });
    });
  });

  it.each([
    { name: "leading APEv2", leading: true, version: 2000 },
    { name: "terminal APEv1", leading: false, version: 1000 },
    { name: "terminal APEv2", leading: false, version: 2000 },
  ])("accepts a $name envelope around real audio", async ({ leading, version }) => {
    const audio = await readFile(fixturePath("cbr-stereo-44100.mp3"));
    const tag = ape(Buffer.from("envelope payload"), leading, version);
    const bytes = Buffer.concat(leading ? [tag, audio] : [audio, tag]);
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, { method: "POST", body: formFor(bytes) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ frameCount: 21 });
    });
  });

  it("rejects an APE descriptor with nonzero reserved bytes", async () => {
    const audio = await readFile(fixturePath("cbr-stereo-44100.mp3"));
    const tag = ape();
    tag[tag.length - 1] = 1;
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        body: formFor(Buffer.concat([audio, tag])),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    });
  });

  it("rejects an isolated unresolved free-format frame without a partial count", async () => {
    const audio = await readFile(fixturePath("free-format-stereo-48000.mp3"));
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        body: formFor(audio.subarray(0, 1200)),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    });
  });

  it.each(invalidScenarios)("rejects %s input with safe JSON", async (scenario) => {
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, {
        method: "POST",
        body: await invalidForm(scenario),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    });
  });

  it("rejects an empty multipart form", async () => {
    await withHttpApp({}, async ({ url }) => {
      const response = await fetch(`${url}/file-upload`, { method: "POST", body: new FormData() });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    });
  });

  it.each(["field", "extra-file", "extra-field"])(
    "enforces the %s multipart limit",
    async (kind) => {
      await withHttpApp({}, async ({ url }) => {
        const form =
          kind === "field" ? new FormData() : formFor(await readFile(fixturePath("sample.mp3")));
        if (kind === "extra-file") form.append("file", new Blob(["extra"]), "second.mp3");
        else form.append(kind === "field" ? "file" : "extra", "value");
        const response = await fetch(`${url}/file-upload`, { method: "POST", body: form });
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ error: expect.any(String) });
      });
    },
  );

  it("returns 413 for oversized data, then still accepts a permitted upload", async () => {
    const bytes = await readFile(fixturePath("cbr-stereo-44100.mp3"));
    await withHttpApp({ maxFileBytes: bytes.length }, async ({ url }) => {
      const oversized = await fetch(`${url}/file-upload`, {
        method: "POST",
        body: formFor(Buffer.concat([bytes, Buffer.of(0)])),
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toEqual({ error: expect.any(String) });
      const accepted = await fetch(`${url}/file-upload`, { method: "POST", body: formFor(bytes) });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ frameCount: 21 });
    });
  });
});
