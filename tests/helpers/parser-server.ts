import { setImmediate as nextTurn } from "node:timers/promises";

// Exercise compiled process/shutdown code with only the existing parser operation seam.
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

const mode = process.argv[2];
if (mode !== "hang" && mode !== "late-failure" && mode !== "observe")
  throw new Error("Unknown parser fixture mode.");
const config = readConfig(process.env);
const application = createApp(config, {
  count: async (input, signal) => {
    // Observe entry to interrupt a blocked read; other modes first reach valid file EOF.
    if (mode === "observe") {
      process.stdout.write(`${JSON.stringify({ event: "fixture_parser_started" })}\n`);
      return countFrames(input, signal);
    }
    const count = await countFrames(input, signal);
    process.stdout.write(`${JSON.stringify({ event: "fixture_parser_started" })}\n`);
    if (mode === "hang") {
      // No child timer or IPC handle masks an incorrectly unreferenced shutdown timer.
      await new Promise<void>(() => undefined);
      return count;
    }
    if (!signal.aborted) {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    }
    await nextTurn(); // The deadline response must precede the deliberately late failure.
    throw new Error("PRIVATE_PARSER_FAILURE");
  },
});
await runServer(application, config);
