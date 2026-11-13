import { type Application, createApp } from "./app.ts";
import { type RuntimeConfig, readConfig } from "./config.ts";

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
    app.log.info({ event: "shutdown_started", activeUploads: admission.active });
    void shutdown();
  }

  async function shutdown(): Promise<void> {
    let finalTimer: NodeJS.Timeout | undefined;
    // Both timers remain referenced: an unsettled parser promise alone cannot keep Node alive.
    const graceTimer = setTimeout(() => {
      app.log.warn({ event: "shutdown_forced", activeUploads: admission.active });
      finalTimer = setTimeout(() => {
        app.log.error({ event: "shutdown_failed" });
        process.exit(1);
      }, 1000);
      // Closing active responses invokes the existing request cancellation and stream release paths.
      app.server.closeAllConnections();
    }, config.shutdownGraceMs);
    try {
      await app.close();
      app.log.info({ event: "server_stopped" });
      process.exitCode = 0;
    } catch (error) {
      app.log.error({ event: "shutdown_failed", err: error });
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
    app.log.info({ event: "server_started", port: address.port });
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
  } catch (error) {
    // Configuration can fail before the application logger exists.
    process.stderr.write(`${JSON.stringify({ event: "startup_failed", error: String(error) })}\n`);
    process.exitCode = 1;
  }
}
