import { setImmediate as nextTurn } from "node:timers/promises";

// This entrypoint runs the compiled implementation, never a source-module substitute.
const { createApp } = (await import(
  new URL("../../dist/app.js", import.meta.url).href
)) as typeof import("../../src/app.ts");
const { readConfig } = (await import(
  new URL("../../dist/config.js", import.meta.url).href
)) as typeof import("../../src/config.ts");
const { countFrames } = (await import(
  new URL("../../dist/mp3/count.js", import.meta.url).href
)) as typeof import("../../src/mp3/count.ts");
const { runServer } = (await import(
  new URL("../../dist/server.js", import.meta.url).href
)) as typeof import("../../src/server.ts");

async function runFixture(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "hang" && mode !== "late-failure") throw new Error("Unknown disposal fixture mode.");
  const config = readConfig(process.env);
  let uploadSignal: AbortSignal | undefined;
  const application = createApp(config, {
    count: async (path, signal) => {
      uploadSignal = signal;
      return countFrames(path, signal);
    },
    dispose: async (directory) => {
      process.stdout.write(`${JSON.stringify({ event: "fixture_disposal_started" })}\n`);
      if (mode === "hang") {
        // No timer or IPC handle masks a shutdown timer that was incorrectly unref'ed.
        await new Promise<void>(() => undefined);
      } else {
        if (!uploadSignal) throw new Error("The fixture has no received upload.");
        if (!uploadSignal.aborted) {
          await new Promise<void>((resolve) =>
            uploadSignal?.addEventListener("abort", () => resolve(), { once: true }),
          );
        }
        await nextTurn(); // Let the deadline response precede the deliberately late failure.
        throw new Error(`PRIVATE_DISPOSAL_FAILURE ${directory}`);
      }
    },
  });
  await runServer(application, config);
}

await runFixture();
