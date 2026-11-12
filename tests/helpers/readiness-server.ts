import { once } from "node:events";
import { open, readdir } from "node:fs/promises";
import { setImmediate as nextTurn } from "node:timers/promises";

const { createApp } = (await import(
  new URL("../../dist/app.js", import.meta.url).href
)) as typeof import("../../src/app.ts");
const { readConfig } = (await import(
  new URL("../../dist/config.js", import.meta.url).href
)) as typeof import("../../src/config.ts");
const { runServer } = (await import(
  new URL("../../dist/server.js", import.meta.url).href
)) as typeof import("../../src/server.ts");

/** A real FIFO holds this isolated child's sole filesystem worker until the parent releases it. */
async function inspectProbeOwnership(): Promise<void> {
  const fifo = process.argv[2];
  if (!fifo) throw new Error("The readiness fixture requires its owned FIFO.");
  const config = readConfig(process.env);
  const application = createApp(config);
  application.app.addHook("preHandler", async (request) => {
    if (request.routeOptions.url === "/health/ready") {
      // The route starts its filesystem work before the next event-loop turn.
      setImmediate(() => record("fixture_probe_queued"));
    }
  });
  const closeRequested = once(process, "SIGUSR2");
  await runServer(application, config);
  const blockedOpen = open(fifo, "r");
  void blockedOpen.catch(() => undefined);
  record("fixture_worker_queued");
  await closeRequested;

  let closed = false;
  const listenerClosed = once(application.app.server, "close");
  const closing = application.app.close().then(() => {
    closed = true;
  });
  void closing.catch(() => undefined);
  await listenerClosed;
  await nextTurn(); // Let already-settled close hooks finish; the FIFO is still closed by the parent.
  record("fixture_close_observed", { closedBeforeRelease: closed });

  const file = await blockedOpen;
  await file.close();
  await closing;
  record("fixture_close_complete", {
    remainingEntries: (await readdir(config.tempDirectory)).length,
  });
}

function record(event: string, fields: Record<string, boolean | number> = {}): void {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

await inspectProbeOwnership();
