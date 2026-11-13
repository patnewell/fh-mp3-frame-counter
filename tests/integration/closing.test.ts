import { once } from "node:events";
import { connect, type Socket } from "node:net";
import { expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { within } from "../helpers/async.ts";
import { audioBytes, BOUNDARY, multipart } from "../helpers/http.ts";

it("keeps the upload error contract for a pipelined request after application close begins", async () => {
  const { app, admission } = createApp();
  const firstReady = Promise.withResolvers<void>();
  const releaseFirst = Promise.withResolvers<void>();
  const secondReady = Promise.withResolvers<void>();
  let responses = 0;
  let output = "";
  let socket: Socket | undefined;
  let closing: Promise<void> | undefined;

  // Hold the first response after the application's onSend hook, keeping this socket active.
  app.addHook("onSend", async (_request, _reply, payload) => {
    if (++responses === 1) {
      firstReady.resolve();
      await releaseFirst.promise;
    } else secondReady.resolve();
    return payload;
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("No listening TCP port.");
    socket = connect({ host: "127.0.0.1", port: address.port });
    socket.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    const disconnected = once(socket, "close");
    void disconnected.catch(() => undefined);
    await within(once(socket, "connect"));
    const body = multipart(await audioBytes());
    const request = Buffer.concat([
      Buffer.from(
        `POST /file-upload HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=${BOUNDARY}\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n`,
      ),
      body,
    ]);
    socket.write(request);
    await within(firstReady.promise);
    closing = app.close();
    void closing.catch(() => undefined);
    await expect.poll(() => admission.accepting, { timeout: 2000 }).toBe(false);
    socket.write(request);
    // Fastify's default closing shortcut bypasses onSend and changes the response contract.
    await within(secondReady.promise);
    releaseFirst.resolve();
    await within(Promise.all([disconnected, closing]));

    const messages = output.split("HTTP/1.1 ").slice(1);
    expect(messages).toHaveLength(2);
    const [firstHeaders, firstBody] = (messages[0] ?? "").split("\r\n\r\n");
    const [secondHeaders, secondBody] = (messages[1] ?? "").split("\r\n\r\n");
    expect(firstHeaders).toMatch(/^200 OK\r\n/);
    expect(JSON.parse(firstBody ?? "")).toEqual({ frameCount: 21 });
    expect(secondHeaders).toMatch(/^503 Service Unavailable\r\n/);
    expect(secondHeaders).toMatch(/\r\nretry-after: 1(?:\r\n|$)/i);
    expect(secondHeaders).toMatch(/\r\nconnection: close(?:\r\n|$)/i);
    expect(JSON.parse(secondBody ?? "")).toEqual({ error: "The service is draining." });
    expect(admission.active).toBe(0);
  } finally {
    releaseFirst.resolve();
    socket?.destroy();
    app.server.closeAllConnections();
    await within(closing ?? app.close());
  }
});
