import { createApp } from "./app.ts";

const { app } = createApp();
try {
  await app.listen({
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
  });
} catch {
  process.stderr.write("Service startup failed.\n");
  await app.close();
  process.exitCode = 1;
}
