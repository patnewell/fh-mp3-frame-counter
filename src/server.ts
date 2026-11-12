import { type Application, createApp } from "./app.ts";
import { type RuntimeConfig, readConfig } from "./config.ts";
import { logEvent } from "./logging.ts";

/** Start the real listener and one process-owned shutdown sequence. */
export async function runServer(
  { app, admission }: Application,
  config: RuntimeConfig,
): Promise<void> {
  let stopping = false;
  const removeSignals = (): void => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  };

  function stop(): void {
    if (stopping) return;
    stopping = true;
    admission.stop();
    logEvent(app.log, { event: "shutdown_started", activeUploads: admission.active });
    void shutdown();
  }

  async function shutdown(): Promise<void> {
    let finalTimer: NodeJS.Timeout | undefined;
    // Both timers remain referenced: an unsettled parser promise alone cannot keep Node alive.
    const graceTimer = setTimeout(() => {
      logEvent(app.log, { event: "shutdown_forced", activeUploads: admission.active });
      finalTimer = setTimeout(() => {
        logEvent(app.log, { event: "shutdown_failed" });
        process.exit(1);
      }, 1000);
      // Closing active responses invokes the existing request cancellation and stream release paths.
      app.server.closeAllConnections();
    }, config.shutdownGraceMs);
    try {
      await app.close();
      logEvent(app.log, { event: "server_stopped" });
      process.exitCode = 0;
    } catch {
      logEvent(app.log, { event: "shutdown_failed" });
      process.exit(1);
    } finally {
      clearTimeout(graceTimer);
      clearTimeout(finalTimer);
      removeSignals();
    }
  }

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await app.listen({ host: config.host, port: config.port });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("The service has no TCP listening address.");
    }
    logEvent(app.log, { event: "server_started", port: address.port });
  } catch (error) {
    removeSignals();
    await app.close().catch(() => undefined);
    throw error;
  }
}

if (import.meta.main) {
  try {
    const config = readConfig(process.env);
    await runServer(createApp(config), config);
  } catch {
    // Configuration can fail before a logger exists; this fixed record contains no supplied values.
    process.stderr.write('{"event":"startup_failed"}\n');
    process.exitCode = 1;
  }
}
