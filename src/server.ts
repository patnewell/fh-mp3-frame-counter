import { type Application, createApp } from "./app.ts";
import { type RuntimeConfig, readConfig } from "./config.ts";

const SHUTDOWN_SETTLEMENT_MS = 1_000;

/**
 * Start listening and register process-owned shutdown handlers.
 * Resolves once listening; signal handlers manage the remaining server lifetime.
 * Application close hooks keep shutdown waiting for owned upload work to settle.
 */
export async function runServer(
  { app, admission }: Application,
  config: RuntimeConfig,
): Promise<void> {
  let shutdownStarted = false;

  function removeSignalHandlers(): void {
    process.off("SIGINT", handleShutdownSignal);
    process.off("SIGTERM", handleShutdownSignal);
  }

  function handleShutdownSignal(): void {
    // Repeated signals must not restart either shutdown deadline.
    if (shutdownStarted) return;
    shutdownStarted = true;
    admission.stop();
    app.log.info({ event: "shutdown_started", activeUploads: admission.active });
    // Node does not await signal listeners; shutdown handles close failures itself.
    void shutdown();
  }

  async function shutdown(): Promise<void> {
    let settlementTimer: NodeJS.Timeout | undefined;
    // Keep both timers referenced: a pending parser promise alone cannot keep Node alive.
    const graceTimer = setTimeout(() => {
      app.log.warn({ event: "shutdown_forced", activeUploads: admission.active });
      settlementTimer = setTimeout(() => {
        app.log.error({ event: "shutdown_failed" });
        process.exit(1);
      }, SHUTDOWN_SETTLEMENT_MS);
      // Destroying active sockets triggers upload cancellation; settlement still has its own bound.
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
      clearTimeout(settlementTimer);
      removeSignalHandlers();
    }
  }

  process.on("SIGINT", handleShutdownSignal);
  process.on("SIGTERM", handleShutdownSignal);
  try {
    await app.listen({ host: config.host, port: config.port });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("The service has no TCP listening address.");
    }
    // PORT=0 chooses an ephemeral port, so report the actual bound port.
    app.log.info({ event: "server_started", port: address.port });
  } catch (error) {
    removeSignalHandlers();
    // Attempt cleanup without replacing the original startup failure.
    await app.close().catch(() => undefined);
    throw error;
  }
}

// Importing runServer must not read the environment or open a second listener.
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
