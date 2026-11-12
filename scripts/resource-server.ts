import { setInterval } from "node:timers";

// This isolated measurement harness executes compiled application code.
const { createApp } = (await import(
  new URL("../dist/app.js", import.meta.url).href
)) as typeof import("../src/app.ts");
const { readConfig } = (await import(
  new URL("../dist/config.js", import.meta.url).href
)) as typeof import("../src/config.ts");
const { runServer } = (await import(
  new URL("../dist/server.js", import.meta.url).href
)) as typeof import("../src/server.ts");

const config = readConfig(process.env);
const application = createApp(config);
let timer: NodeJS.Timeout | undefined;

function measure(final = false): void {
  if (process.connected) {
    process.send?.(
      {
        event: "memory",
        rssBytes: process.memoryUsage().rss,
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
        final,
      },
      () => undefined,
    );
  }
}

application.app.addHook("onClose", async () => {
  clearInterval(timer);
  if (process.connected) process.disconnect();
});
await runServer(application, config);
const address = application.app.server.address();
if (address === null || typeof address === "string") throw new Error("No resource-test port.");
process.send?.({ event: "ready", port: address.port });
measure();
timer = setInterval(measure, 25);
timer.unref();
process.on("message", (message: unknown) => {
  if (message === "measure") measure(true);
});
