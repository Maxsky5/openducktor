import { afterEach, expect, spyOn, test, type Mock } from "bun:test";
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

const hostUrl = "https://192.168.1.9:14328/remote";
let fetchSpy: Mock<typeof fetch> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  Reflect.deleteProperty(navigator, "permissions");
});

/** Bun has no Permissions API, so each test installs the browser answer it needs. */
const setLocalNetworkPermission = (
  query: (descriptor: PermissionDescriptor) => Promise<{ state: string }>,
): void => {
  Object.defineProperty(navigator, "permissions", { value: { query }, configurable: true });
};

/**
 * The host answers the first `answers` requests. Later requests fail with the network `TypeError`
 * that a browser gives for a blocked or unreachable host.
 */
const answerHost = (answers: number): void => {
  let requests = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        requests += 1;
        if (requests > answers) throw new TypeError("Failed to fetch");
        return Object.defineProperty(new Response(), "url", { value: hostUrl });
      },
      { preconnect: fetch.preconnect },
    ),
  );
};

test("a first request that fails while local network access is denied names the browser block", async () => {
  const queried: string[] = [];
  answerHost(0);
  setLocalNetworkPermission(async (descriptor) => {
    queried.push(descriptor.name);
    return { state: "denied" };
  });
  const failure = await createBrowserRemoteTransport()
    .request("GET", hostUrl, {}, new AbortController().signal)
    .catch((cause: unknown) => cause);
  expect(failure).toMatchObject({
    failure: {
      code: "transport_failure",
      transportCause: "local_network",
      message: "This browser blocked access to your local network.",
      nextAction:
        "Allow local network access for this site in the browser's site settings, then select Retry.",
    },
  });
  expect(queried).toEqual(["local-network"]);
});

test("a failure after the host answered keeps its own error while local network access is denied", async () => {
  answerHost(1);
  setLocalNetworkPermission(async () => ({ state: "denied" }));
  const transport = createBrowserRemoteTransport();
  const signal = new AbortController().signal;
  await transport.request("GET", hostUrl, {}, signal);
  const failure = await transport
    .request("GET", hostUrl, {}, signal)
    .catch((cause: unknown) => cause);
  expect(failure).toEqual(new TypeError("Failed to fetch"));
});

test.each([
  ["the permission is not denied", async () => ({ state: "prompt" })],
  [
    "the browser does not know the permission",
    async (): Promise<{ state: string }> => {
      throw new TypeError("The provided value 'local-network' is not a valid enum value.");
    },
  ],
])("a request failure keeps its own error when %s", async (_case, query) => {
  answerHost(0);
  setLocalNetworkPermission(query);
  const failure = await createBrowserRemoteTransport()
    .request("GET", hostUrl, {}, new AbortController().signal)
    .catch((cause: unknown) => cause);
  expect(failure).toEqual(new TypeError("Failed to fetch"));
});

test("a canceled request keeps its cancel reason while local network access is denied", async () => {
  const owner = new AbortController();
  const canceled = new Error("The user changed hosts.");
  owner.abort(canceled);
  answerHost(0);
  setLocalNetworkPermission(async () => ({ state: "denied" }));
  const failure = await createBrowserRemoteTransport()
    .request("GET", hostUrl, {}, owner.signal)
    .catch((cause: unknown) => cause);
  expect(failure).toBe(canceled);
});
