import { type Application, createApp } from "./app.ts";
import { readConfig } from "./config.ts";

let application: Application | undefined;
try {
  const config = readConfig(process.env);
  application = createApp(config);
  await application.app.listen({ host: config.host, port: config.port });
} catch {
  process.stderr.write("Service startup failed.\n");
  await application?.app.close().catch(() => undefined);
  process.exitCode = 1;
}
