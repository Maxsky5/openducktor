import { expect, spyOn, test } from "bun:test";
import { REMOTE_CONNECTION_HEADER } from "@openducktor/contracts";
import { createBrowserRemoteTransport } from "../../frontend/src/lib/remote/transport";

test("canceling terminal setup closes the pending WebSocket", async () => {
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  let finishRequest!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    finishRequest = resolve;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requestStarted();
      return response;
    },
  });
  const close = spyOn(WebSocket.prototype, "close");
  const owner = new AbortController();
  const canceled = new Error("The user changed hosts.");
  try {
    const setup = createBrowserRemoteTransport()
      .openTerminal(
        `ws://127.0.0.1:${server.port}/terminal`,
        { [REMOTE_CONNECTION_HEADER]: crypto.randomUUID() },
        owner.signal,
        () => {},
        () => {},
      )
      .catch((cause: unknown) => cause);
    await started;
    owner.abort(canceled);
    expect(await setup).toBe(canceled);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    finishRequest(new Response(null, { status: 403 }));
    close.mockRestore();
    await server.stop(true);
  }
});
