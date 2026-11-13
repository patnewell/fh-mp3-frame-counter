import type { ClientRequest } from "node:http";
import type { FastifyInstance } from "fastify";
import { type AppOptions, createApp } from "../../src/app.ts";
import type { UploadOperations } from "../../src/upload/route.ts";
import { within } from "./async.ts";
import { BOUNDARY, openHttpUpload, type UploadExchange } from "./http.ts";

interface RunningUploadApp {
  readonly app: FastifyInstance;
  readonly admission: ReturnType<typeof createApp>["admission"];
  open(headers?: Record<string, string>): UploadExchange;
}

/** Own sockets and the listening app even when an assertion or the app fails. */
export async function withUploadApp(
  options: AppOptions,
  operations: Partial<UploadOperations>,
  inspect: (service: RunningUploadApp) => Promise<void>,
): Promise<void> {
  const { app, admission } = createApp({ timeoutMs: 5000, ...options }, operations);
  const clients = new Set<ClientRequest>();
  try {
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    await inspect({
      app,
      admission,
      open: (headers) => {
        const upload = openHttpUpload(`${url}/file-upload`, {
          "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
          "transfer-encoding": "chunked",
          ...headers,
        });
        clients.add(upload.request);
        upload.request.once("close", () => clients.delete(upload.request));
        return upload;
      },
    });
  } finally {
    for (const client of clients) client.destroy();
    app.server.closeAllConnections();
    await within(app.close());
  }
}
