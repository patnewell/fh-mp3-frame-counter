import { get } from "node:http";
import { readConfig } from "./config.ts";

try {
  const config = readConfig(process.env);
  if (config.port === 0) throw new Error("The healthcheck requires a fixed port.");
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host === "::" ? "::1" : config.host;
  const healthy = await new Promise<boolean>((resolve) => {
    const request = get(
      {
        host,
        port: config.port,
        path: "/health/ready",
        agent: false,
        // This absolute deadline also bounds a response that keeps trickling bytes.
        signal: AbortSignal.timeout(2000),
      },
      (response) => {
        response.once("end", () => resolve(response.statusCode === 200));
        response.once("error", () => resolve(false));
        response.resume();
      },
    );
    request.once("error", () => resolve(false));
  });
  process.exitCode = healthy ? 0 : 1;
} catch {
  process.exitCode = 1;
}
