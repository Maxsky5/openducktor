import { describe, expect, mock, spyOn, test } from "bun:test";
import { WebSocket as NodeWebSocket } from "ws";
import * as host from "@openducktor/host";
import {
  type HostCommandInputRecord,
  encodeHostChannelFrame,
  HOST_CHANNEL_SUBPROTOCOL,
  REMOTE_PROTOCOL_VERSION,
  splitHostChannelFrame,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
} from "@openducktor/contracts";
import {
  RuntimeQueryError,
  createLocalAttachmentAdapter,
  type EffectHostCommandRouter,
  type EffectNodeHostCommandRouter,
  type HostCommandArgs,
  type HostCommandName,
  type HostCommandResult,
  TaskAssetError,
  type TaskAssetReadService,
  TerminalServiceError,
} from "@openducktor/host";
import { Stream, Effect } from "effect";
import { WorkspaceTextFileWriteError } from "../../host/src/application/filesystem/workspace-text-file-service";
import { HostOperationError } from "../../host/src/effect/host-errors";
import type { HostCommandHandlerError } from "../../host/src/interface/router/host-command-router";
import type { WebLogger } from "./logger";
import {
  startNodeFetchServer,
  type NodeFetchServer,
} from "@openducktor/remote-host/node-fetch-server";
import { allowedHostnamesFor, parseHostEffect } from "@openducktor/remote-host/http-origin";
import { createBrowserServiceFake } from "./browser-tabs/browser-service-test-fake";
import type { BrowserPreviewProxies } from "./browser-tabs/browser-preview-proxy";
import { validateLauncherNetworkOptionsEffect } from "./launcher";
import {
  buildBackendUrl,
  buildBrowserBackendUrl,
  readinessHostForBind,
  waitForBackend,
} from "./launcher-support";
import { createTaskEventLeaseManager } from "@openducktor/remote-host/task-event-leases";
import { BufferedHostEventBus } from "@openducktor/remote-host/host-event-bus";
import {
  createHostChannelSocketData,
  type HostChannelReply,
  type HostChannelSocketData,
} from "@openducktor/remote-host/host-channel";
import {
  hostWebSocketHandler,
  type HostWebSocketData,
} from "@openducktor/remote-host/host-websocket-handler";
import { allowedFrontendOrigins, validateFrontendOriginEffect } from "./frontend-origin";
import { stopHostBackend } from "./host-backend-lifecycle";

const nativeResponse = await Bun.fetch("data:,");
Object.defineProperty(globalThis, "Response", {
  configurable: true,
  value: nativeResponse.constructor,
});

const {
  handleHostFetch,
  handleTypescriptHostBackendRequest,
  invokeLocalHostCommand,
  resolveAppSessionCookieName,
} = await import("./typescript-host-backend");
const { startTypescriptHostBackend } = await import("./typescript-host-backend");

const APP_TOKEN = "app-token";
const APP_SESSION_COOKIE_NAME = "openducktor_web_session";
const CONTROL_TOKEN = "control-token";
const DEVELOPMENT_INSTANCE_ID = "browser-0123456789ab";
const DEVELOPMENT_APP_SESSION_COOKIE_NAME = `${APP_SESSION_COOKIE_NAME}_${DEVELOPMENT_INSTANCE_ID}`;

class TestServerRequest extends Request {
  override readonly headers: Headers;

  constructor(input: ConstructorParameters<typeof Request>[0], init?: RequestInit) {
    super(input, init);
    this.headers = new Headers(init?.headers);
  }
}

const testLogger: WebLogger = {
  error: () => Effect.void,
  info: () => Effect.void,
  success: () => Effect.void,
};

type TestHostCommandInvoke = (
  command: string,
  args?: Exclude<HostCommandArgs, undefined>,
) => Effect.Effect<HostCommandResult, HostCommandHandlerError>;

const createDeferred = <Value = void>() => {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => {};
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const createTestHostCommandRouter = (
  invoke: TestHostCommandInvoke = () => Effect.succeed(null),
): EffectHostCommandRouter => {
  function invokeCommand<Command extends HostCommandName>(
    command: Command,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Effect.Effect<HostCommandResult<Command>, HostCommandHandlerError>;
  function invokeCommand(
    command: string,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Effect.Effect<HostCommandResult, HostCommandHandlerError>;
  function invokeCommand(
    command: string,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Effect.Effect<HostCommandResult, HostCommandHandlerError> {
    return invoke(command, args);
  }

  return {
    dispose: () => Effect.void,
    initialize: () => Effect.void,
    invoke: invokeCommand,
  };
};

const missingTaskAssetReadService: TaskAssetReadService = {
  read: () => Effect.succeed(null),
  readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
};

const unexpectedBrowserPreviews: BrowserPreviewProxies = {
  originFor: () => Promise.reject(new Error("Unexpected browser preview.")),
  close: () => Promise.resolve(),
};

const unexpectedTerminalOperation = (operation: string): Effect.Effect<never> =>
  Effect.die(new Error(`Unexpected terminal service operation: ${operation}`));

const createTestNodeHostCommandRouter = (): EffectNodeHostCommandRouter => ({
  ...createTestHostCommandRouter(),
  hostInstanceId: "test-host",
  hostSettings: {
    readRemoteAccessSettings: () => Effect.succeed({ enabled: false, configuration: null }),
    saveRemoteAccessSettings: () => Effect.void,
  },
  taskAssetReadService: missingTaskAssetReadService,
  notificationStream: {
    publishOccurrence: () => {},
    publishHealth: () => {},
    dispose: () => Effect.void,
    subscribe: () => Stream.empty,
  },
  taskEventStream: {
    cursor: () => ({ epoch: "11111111-1111-4111-8111-111111111111", sequence: 0 }),
    reset: () => ({ epoch: "11111111-1111-4111-8111-111111111111", sequence: 0 }),
    acknowledge: () => {},
    publish: () => ({ epoch: "11111111-1111-4111-8111-111111111111", sequence: 0 }),
    subscribe: () => ({
      subscriptionId: "test-subscription",
      resume: () => {},
      replay: () => {},
      replayBoundary: { epoch: "test-epoch", sequence: 0 },
      unsubscribe: () => {},
    }),
  },
  terminalService: {
    acknowledge: () => unexpectedTerminalOperation("acknowledge"),
    acquireTaskCleanup: () => unexpectedTerminalOperation("acquireTaskCleanup"),
    acquireWorkspaceSessionCleanup: () =>
      unexpectedTerminalOperation("acquireWorkspaceSessionCleanup"),
    attach: () => unexpectedTerminalOperation("attach"),
    close: () => unexpectedTerminalOperation("close"),
    closeByTaskScope: () => unexpectedTerminalOperation("closeByTaskScope"),
    create: () => unexpectedTerminalOperation("create"),
    detach: () => unexpectedTerminalOperation("detach"),
    dispose: () => unexpectedTerminalOperation("dispose"),
    restart: () => unexpectedTerminalOperation("restart"),
    hostInstanceId: "test-instance",
    inspectWorkspaceActivity: () => unexpectedTerminalOperation("inspectWorkspaceActivity"),
    list: () => unexpectedTerminalOperation("list"),
    observeActivity: () => unexpectedTerminalOperation("observeActivity"),
    observeList: () => unexpectedTerminalOperation("observeList"),
    preparePathInput: () => unexpectedTerminalOperation("preparePathInput"),
    resize: () => unexpectedTerminalOperation("resize"),
    write: () => unexpectedTerminalOperation("write"),
  },
  browserService: createBrowserServiceFake(),
});

type UpgradeOptions = { host?: string; protocol?: string; cookie?: string | null };

const performWebSocketUpgrade = (
  port: number,
  path: string,
  origin: string,
  {
    host = `127.0.0.1:${port}`,
    protocol = TERMINAL_PROTOCOL_SUBPROTOCOL,
    cookie = `${APP_SESSION_COOKIE_NAME}=${APP_TOKEN}`,
  }: UpgradeOptions = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    let responseText = "";
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(socket) {
          socket.write(
            [
              `GET ${path} HTTP/1.1`,
              `Host: ${host}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==",
              "Sec-WebSocket-Version: 13",
              `Origin: ${origin}`,
              `Sec-WebSocket-Protocol: ${protocol}`,
              ...(cookie === null ? [] : [`Cookie: ${cookie}`]),
              "\r\n",
            ].join("\r\n"),
          );
        },
        data(socket, data) {
          responseText += new TextDecoder().decode(data);
          const headEnd = responseText.indexOf("\r\n\r\n");
          if (headEnd !== -1) {
            socket.end();
            resolve(responseText.slice(0, headEnd));
          }
        },
        error(socket, error) {
          reject(error);
        },
      },
    });
  });

type TestRequestOptions = Partial<{
  appSessionCookieName: string;
  appToken: string;
  controlToken: string;
  taskAssetReadService: TaskAssetReadService;
  beginShutdown: () => void;
  shutdownStarted: boolean;
  stop: () => Promise<void>;
  sessionCookieSecure: boolean;
}>;

const handleTestRequest = (
  request: Request,
  options: TestRequestOptions = {},
): Promise<Response> => {
  const requestInput: Parameters<typeof handleTypescriptHostBackendRequest>[0] = {
    allowedOrigins: new Set(),
    appSessionCookieName: options.appSessionCookieName ?? APP_SESSION_COOKIE_NAME,
    appToken: options.appToken ?? APP_TOKEN,
    browserPreviews: unexpectedBrowserPreviews,
    controlToken: options.controlToken ?? CONTROL_TOKEN,
    taskAssetReadService: options.taskAssetReadService ?? missingTaskAssetReadService,
    localAttachments: createLocalAttachmentAdapter(),
    logger: testLogger,
    request,
    sessionCookieSecure: options.sessionCookieSecure ?? false,
    shutdownStarted: options.shutdownStarted ?? false,
    beginShutdown: options.beginShutdown ?? (() => {}),
    stop: options.stop ?? (async () => {}),
  };
  return Effect.runPromise(handleTypescriptHostBackendRequest(requestInput));
};

/** A local host channel whose commands run on `hostCommandRouter`. */
const createTestChannel = (
  hostCommandRouter: EffectHostCommandRouter = createTestHostCommandRouter(),
): HostChannelSocketData => {
  const nodeRouter = createTestNodeHostCommandRouter();
  return createHostChannelSocketData({
    hostEvents: new BufferedHostEventBus({ report: () => {} }).stream(),
    notifications: nodeRouter.notificationStream,
    leases: createTaskEventLeaseManager({
      taskEventStream: nodeRouter.taskEventStream,
      reportDeliveryFailure: () => {},
    }),
    ownedLeases: new Set(),
    invoke: (command, args) =>
      invokeLocalHostCommand(hostCommandRouter, command, args, () => false),
    refusal: () => null,
    isShuttingDown: () => false,
    reportFailure: () => {},
  });
};

const invokeTestCommand = (
  hostCommandRouter: EffectHostCommandRouter,
  command: string,
  args: HostCommandInputRecord = {},
): Promise<HostChannelReply> =>
  invokeLocalHostCommand(hostCommandRouter, command, args, () => false);

describe("TypeScript web host backend", () => {
  const TERMINAL_UPGRADE_FRONTEND_ORIGIN = "http://127.0.0.1:1420";
  const TERMINAL_UPGRADE_BASE_PATH = "/api";

  test("keeps operator CORS, authorization, and HTTP cookies private under an HTTPS network frontend", async () => {
    const router = spyOn(host, "createNodeEffectHostCommandRouter").mockReturnValue(
      Effect.succeed(createTestNodeHostCommandRouter()),
    );
    const failures: unknown[] = [];
    const frontendOrigin = "http://127.0.0.1:1420";
    const backend = await startTypescriptHostBackend({
      port: 0,
      host: "127.0.0.1",
      frontendOrigin,
      remoteFrontendOrigin: "https://machine.ts.net",
      appToken: APP_TOKEN,
      controlToken: CONTROL_TOKEN,
      configDirScope: "test",
      mcpBridgeDiscoveryMode: "production",
      runtimeDistribution: { mode: "source", workspaceRoot: "/repo" },
      deferRemoteStartup: true,
      logger: testLogger,
      onBackgroundFailure: (failure) => failures.push(failure),
    });
    try {
      const base = `http://127.0.0.1:${backend.port}`;
      const checkHealth = async () => {
        const response = await Bun.fetch(`${base}/health`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
      };
      await checkHealth();
      const preflight = await Bun.fetch(`${base}/remote-access`, {
        method: "OPTIONS",
        headers: {
          origin: frontendOrigin,
          "access-control-request-headers": "x-openducktor-app-token",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(preflight.headers.get("access-control-allow-headers")).toContain(
        "x-openducktor-app-token",
      );
      const state = await Bun.fetch(`${base}/remote-access`, {
        headers: { origin: frontendOrigin, "x-openducktor-app-token": APP_TOKEN },
      });
      expect(state.status).toBe(200);
      expect(state.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(state.headers.get("access-control-allow-credentials")).toBe("true");
      expect(await state.json()).toMatchObject({ status: "disabled" });
      const networkChoices = await Bun.fetch(`${base}/remote-access/networks`, {
        headers: { origin: frontendOrigin, "x-openducktor-app-token": APP_TOKEN },
      });
      expect(networkChoices.status).toBe(200);
      expect(networkChoices.headers.get("cache-control")).toBe("no-store");
      expect(Array.isArray(await networkChoices.json())).toBe(true);
      for (const headers of [
        { origin: frontendOrigin },
        { origin: "https://machine.ts.net", "x-openducktor-app-token": APP_TOKEN },
      ]) {
        const refused = await Bun.fetch(`${base}/remote-access/networks`, { headers });
        expect(refused.status).toBe(headers.origin === frontendOrigin ? 401 : 403);
      }
      const unauthorized = await Bun.fetch(`${base}/remote-access`, {
        headers: { origin: frontendOrigin },
      });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      const network = await Bun.fetch(`${base}/remote-access`, {
        headers: { origin: "https://machine.ts.net", "x-openducktor-app-token": APP_TOKEN },
      });
      expect(network.status).toBe(403);
      const session = await Bun.fetch(`${base}/session`, {
        method: "POST",
        headers: { origin: frontendOrigin, "x-openducktor-app-token": APP_TOKEN },
      });
      expect(session.status).toBe(200);
      expect(session.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
      expect(session.headers.get("set-cookie")).not.toContain("Secure");
      const enabled = await Effect.runPromise(
        backend.remoteAccess.enable({
          listenHost: "127.0.0.1",
          listenPort: backend.port,
          publicEndpoint: "https://machine.ts.net/api/remote",
        }),
      );
      expect(enabled.status).toBe("available");
      await checkHealth();
      expect((await Bun.fetch(`${base}/api/remote`)).status).toBe(200);
      const negotiation = await Bun.fetch(`${base}/api/remote/connections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appVersion: "test",
          clientKind: "browser",
          pairingCode: (await Effect.runPromise(backend.remoteAccess.startPairing())).pairing!.code,
          supportedProtocolVersions: [REMOTE_PROTOCOL_VERSION],
          requiredCapabilities: [],
          optionalCapabilities: [],
        }),
      });
      const connection = await negotiation.json();
      const assetPath = `${base}/task-assets/workspace-1/task-1/description/550e8400-e29b-41d4-a716-446655440000`;
      const remoteWork = await Bun.fetch(assetPath, {
        headers: {
          "x-openducktor-connection-id": connection.connectionId,
          authorization: `Bearer ${connection.connectionToken}`,
        },
      });
      // The remote handler admits the request and finds no asset.
      expect(remoteWork.status).toBe(404);
      const invalidAdmission = await Bun.fetch(assetPath, {
        headers: { "x-openducktor-connection-id": "expired", "x-openducktor-app-token": APP_TOKEN },
      });
      expect(invalidAdmission.status).toBe(409);
      const privateWork = () =>
        Bun.fetch(`${base}/session`, {
          method: "POST",
          headers: { "x-openducktor-app-token": APP_TOKEN },
        });
      expect((await privateWork()).status).toBe(200);
      const privateState = await Bun.fetch(`${base}/remote-access`, {
        headers: {
          cookie: session.headers.get("set-cookie")!.split(";")[0]!,
          origin: frontendOrigin,
        },
      });
      expect(privateState.status).toBe(200);
      const sharedPreflight = await Bun.fetch(`${base}/remote-access`, {
        method: "OPTIONS",
        headers: {
          origin: frontendOrigin,
          "access-control-request-headers": "x-openducktor-app-token",
        },
      });
      expect(sharedPreflight.headers.get("access-control-allow-headers")).toContain(
        "x-openducktor-app-token",
      );
      await Effect.runPromise(backend.remoteAccess.disable());
      await checkHealth();
      expect((await Bun.fetch(`${base}/api/remote`)).status).toBe(503);
      expect((await privateWork()).status).toBe(200);
      expect(failures).toEqual([]);
    } finally {
      await backend.stop();
      router.mockRestore();
    }
  });

  const createTerminalUpgradeTestServer = (
    basePath = TERMINAL_UPGRADE_BASE_PATH,
    bindHost = "127.0.0.1",
    port = 0,
    shutdownStarted = false,
  ): Promise<NodeFetchServer<HostWebSocketData>> =>
    startNodeFetchServer({
      hostname: bindHost,
      port,
      onError: (cause) => {
        throw cause;
      },
      fetch: (request, requestServer) =>
        handleHostFetch({
          allowedHostnames: allowedHostnamesFor({
            bindHost,
            externalUrl: TERMINAL_UPGRADE_FRONTEND_ORIGIN,
          }),
          allowedOrigins: allowedFrontendOrigins(TERMINAL_UPGRADE_FRONTEND_ORIGIN),
          appSessionCookieName: APP_SESSION_COOKIE_NAME,
          appToken: APP_TOKEN,
          browserPreviews: unexpectedBrowserPreviews,
          controlToken: CONTROL_TOKEN,
          createChannel: () => createTestChannel(),
          hostCommandRouter: createTestNodeHostCommandRouter(),
          taskAssetReadService: missingTaskAssetReadService,
          localAttachments: createLocalAttachmentAdapter(),
          logger: testLogger,
          basePath,
          onBackgroundFailure: () => {},
          request,
          server: requestServer,
          sessionCookieSecure: false,
          shutdownStarted,
          beginShutdown: () => {},
          stop: () => Promise.resolve(),
        }),
      websocket: hostWebSocketHandler,
    });

  test("uses one session cookie name per development instance", () => {
    expect(
      resolveAppSessionCookieName("development", {
        OPENDUCKTOR_DEV_INSTANCE: DEVELOPMENT_INSTANCE_ID,
      }),
    ).toBe(DEVELOPMENT_APP_SESSION_COOKIE_NAME);
    expect(
      resolveAppSessionCookieName("development", {
        OPENDUCKTOR_DEV_INSTANCE: "browser-fedcba987654",
      }),
    ).toBe(`${APP_SESSION_COOKIE_NAME}_browser-fedcba987654`);
    expect(
      resolveAppSessionCookieName("production", {
        OPENDUCKTOR_DEV_INSTANCE: DEVELOPMENT_INSTANCE_ID,
      }),
    ).toBe(APP_SESSION_COOKIE_NAME);
  });

  test("serves health and development session routes without opening a server", async () => {
    const health = await handleTestRequest(new Request("http://127.0.0.1/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const session = await handleTestRequest(
      new Request("http://127.0.0.1/session", {
        method: "POST",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      { appSessionCookieName: DEVELOPMENT_APP_SESSION_COOKIE_NAME },
    );
    expect(session.status).toBe(200);
    expect(session.headers.get("set-cookie")).toContain(
      `${DEVELOPMENT_APP_SESSION_COOKIE_NAME}=${APP_TOKEN}`,
    );
    expect(session.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict; Path=/");
    expect(session.headers.get("set-cookie")).not.toContain("Secure");
  });

  test("marks the session cookie Secure when the frontend origin uses https", async () => {
    const session = await handleTestRequest(
      new Request("http://127.0.0.1/session", {
        method: "POST",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      }),
      {
        appSessionCookieName: DEVELOPMENT_APP_SESSION_COOKIE_NAME,
        sessionCookieSecure: true,
      },
    );
    expect(session.status).toBe(200);
    expect(session.headers.get("set-cookie")).toContain(
      `${DEVELOPMENT_APP_SESSION_COOKIE_NAME}=${APP_TOKEN}; HttpOnly; SameSite=Strict; Path=/; Secure`,
    );
  });

  test.each(["/api", "/api/"])(
    "routes normalized launcher base path %s with session requests and WebSocket upgrades",
    async (rawBasePath) => {
      const basePath = await Effect.runPromise(
        validateLauncherNetworkOptionsEffect({
          basePath: rawBasePath,
          bindHost: "127.0.0.1",
          externalUrl: TERMINAL_UPGRADE_FRONTEND_ORIGIN,
        }),
      );
      expect(basePath).toBe("/api");
      const server = await createTerminalUpgradeTestServer(basePath);

      try {
        const port = server.port;
        if (port === undefined) {
          throw new Error("Expected the test server to expose a port.");
        }
        const externalUrl = `http://127.0.0.1:${port}/`;
        const { browserUrl } = buildBrowserBackendUrl(
          basePath,
          externalUrl,
          externalUrl,
          "127.0.0.1",
          port,
        );
        expect(new URL(`${browserUrl}/session`).pathname).toBe("/api/session");
        const session = await Bun.fetch(`${browserUrl}/session`, {
          method: "POST",
          headers: { "x-openducktor-app-token": APP_TOKEN },
        });
        expect(session.status).toBe(200);
        await session.text();
        const channelHead = await performWebSocketUpgrade(
          port,
          `${TERMINAL_UPGRADE_BASE_PATH}/channel`,
          TERMINAL_UPGRADE_FRONTEND_ORIGIN,
          { protocol: HOST_CHANNEL_SUBPROTOCOL },
        );
        expect(channelHead).toContain("101 Switching Protocols");
        expect(channelHead).toContain(`Sec-WebSocket-Protocol: ${HOST_CHANNEL_SUBPROTOCOL}`);
        const responseHead = await performWebSocketUpgrade(
          port,
          `${TERMINAL_UPGRADE_BASE_PATH}/terminal`,
          TERMINAL_UPGRADE_FRONTEND_ORIGIN,
        );
        expect(responseHead).toContain("101 Switching Protocols");
        expect(responseHead).toContain(`Sec-WebSocket-Protocol: ${TERMINAL_PROTOCOL_SUBPROTOCOL}`);
      } finally {
        await server.stop(true);
      }
    },
  );

  /**
   * A wildcard bind can get a port that another process holds on ::1, which then takes the ::1
   * connections. A port that ::1 gave out has no such owner. The dual-stack bind also needs the
   * IPv4 port, which another process can hold, so a busy port gets a new loopback port.
   */
  const startWildcardServerOnLoopbackPort = async (bindHost: string) => {
    for (let attempt = 1; ; attempt += 1) {
      const loopback = await createTerminalUpgradeTestServer("/api", "::1");
      const loopbackPort = loopback.port;
      await loopback.stop(true);
      try {
        return await createTerminalUpgradeTestServer("/api", bindHost, loopbackPort);
      } catch (cause) {
        const portInUse = cause instanceof Error && "code" in cause && cause.code === "EADDRINUSE";
        if (!portInUse || attempt === 5) throw cause;
      }
    }
  };

  test("probes a normalized IPv6 wildcard bind through the allowed loopback Host", async () => {
    const bindHost = await Effect.runPromise(parseHostEffect("::", "--host", true));
    const server = await startWildcardServerOnLoopbackPort(bindHost);
    try {
      const port = server.port;
      if (port === undefined) throw new Error("Expected the test server to expose a port.");
      // Connect through ::1 on every OS, with the Host that each readiness URL sends.
      for (const [host, status] of [
        ["[::]", 200],
        ["[::1]", 200],
        ["unknown.example", 403],
      ] as const) {
        const response = await Bun.fetch(`http://[::1]:${port}/health`, {
          headers: { host: `${host}:${port}` },
        });
        expect(response.status).toBe(status);
        await response.text();
      }
      await waitForBackend(buildBackendUrl(port, readinessHostForBind(bindHost)), APP_TOKEN, 1000, {
        exited: new Promise<number>(() => {}),
      });
    } finally {
      await server.stop(true);
    }
  });

  test("rejects terminal upgrades when the Host header is not allowed", async () => {
    const server = await createTerminalUpgradeTestServer();

    try {
      const port = server.port;
      if (port === undefined) {
        throw new Error("Expected the test server to expose a port.");
      }
      const responseHead = await performWebSocketUpgrade(
        port,
        `${TERMINAL_UPGRADE_BASE_PATH}/terminal`,
        TERMINAL_UPGRADE_FRONTEND_ORIGIN,
        { host: "evil.example" },
      );
      expect(responseHead).toContain("403");
    } finally {
      await server.stop(true);
    }
  });

  test("probes a mapped wildcard with an isolated proxy and loopback bypass", async () => {
    const bindHost = await Effect.runPromise(parseHostEffect("[::ffff:0.0.0.0]", "--host"));
    const server = await createTerminalUpgradeTestServer("/api", bindHost);
    let proxyRequests = 0;
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        // A proxied request names another origin. Another local client can reach this reused
        // loopback port directly, and that request is not proxy traffic.
        if (new URL(request.url).port !== String(proxy.port)) proxyRequests += 1;
        return new Response("test proxy", { status: 503 });
      },
    });
    const proxyUrl = `http://127.0.0.1:${proxy.port}`;
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "--eval",
        `import { buildBackendUrl, readinessHostForBind, waitForBackend } from ${JSON.stringify(new URL("./launcher-support.ts", import.meta.url).href)};
         const control = await fetch("http://proxy-check.invalid/", { signal: AbortSignal.timeout(2000) });
         if (control.status !== 503 || await control.text() !== "test proxy") throw new Error("Proxy control failed");
         const host = readinessHostForBind(${JSON.stringify(bindHost)});
         if (host !== "127.0.0.1") throw new Error("Expected IPv4 loopback readiness host");
         await waitForBackend(buildBackendUrl(${server.port}, host), ${JSON.stringify(APP_TOKEN)}, 2000, { exited: new Promise(() => {}) });`,
      ],
      env: {
        ...process.env,
        HTTP_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        https_proxy: proxyUrl,
        ALL_PROXY: proxyUrl,
        all_proxy: proxyUrl,
        NO_PROXY: "127.0.0.1,localhost,::1",
        no_proxy: "127.0.0.1,localhost,::1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      expect(proxyRequests).toBe(1);
    } finally {
      child.kill();
      await child.exited;
      await server.stop(true);
      proxy.stop(true);
    }
  }, 10_000);

  test.each(["runner.localhost", "nested.runner.localhost", "127.0.0.2", "[::ffff:7f00:1]"])(
    "rejects unconfigured Host and Origin %s",
    async (hostname) => {
      const server = await createTerminalUpgradeTestServer();
      try {
        for (const headers of [
          { host: `${hostname}:${server.port}` },
          { origin: `http://${hostname}:1420` },
        ]) {
          const response = await Bun.fetch(`http://127.0.0.1:${server.port}/session`, {
            method: "POST",
            headers: { ...headers, "x-openducktor-app-token": APP_TOKEN },
          });
          expect(response.status).toBe(403);
          await response.text();
        }
      } finally {
        await server.stop(true);
      }
    },
  );

  test("runs a command over a base-prefixed host channel", async () => {
    const server = await startNodeFetchServer({
      hostname: "127.0.0.1",
      port: 0,
      onError: (cause) => {
        throw cause;
      },
      fetch: (request, requestServer) =>
        handleHostFetch({
          allowedHostnames: allowedHostnamesFor({ bindHost: "127.0.0.1", externalUrl: undefined }),
          allowedOrigins: allowedFrontendOrigins(TERMINAL_UPGRADE_FRONTEND_ORIGIN),
          appSessionCookieName: APP_SESSION_COOKIE_NAME,
          appToken: APP_TOKEN,
          browserPreviews: unexpectedBrowserPreviews,
          controlToken: CONTROL_TOKEN,
          createChannel: () =>
            createTestChannel(createTestHostCommandRouter(() => Effect.succeed("linux"))),
          hostCommandRouter: createTestNodeHostCommandRouter(),
          taskAssetReadService: missingTaskAssetReadService,
          localAttachments: createLocalAttachmentAdapter(),
          logger: testLogger,
          basePath: "/api",
          onBackgroundFailure: () => {},
          request,
          server: requestServer,
          sessionCookieSecure: false,
          shutdownStarted: false,
          beginShutdown: () => {},
          stop: () => Promise.resolve(),
        }),
      websocket: hostWebSocketHandler,
    });
    const socket = new NodeWebSocket(
      `ws://127.0.0.1:${server.port}/api/channel`,
      [HOST_CHANNEL_SUBPROTOCOL],
      {
        headers: {
          origin: TERMINAL_UPGRADE_FRONTEND_ORIGIN,
          cookie: `${APP_SESSION_COOKIE_NAME}=${APP_TOKEN}`,
        },
      },
    );
    try {
      const reply = new Promise<{ header: string; body: string | null }>((resolve, reject) => {
        socket.once("message", (data: Buffer) => {
          const frame = splitHostChannelFrame(new Uint8Array(data));
          resolve({
            header: frame.header,
            body: frame.body === null ? null : new TextDecoder().decode(frame.body),
          });
        });
        socket.once("error", reject);
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      socket.send(
        encodeHostChannelFrame({
          type: "request",
          id: 7,
          method: "invoke",
          command: "system_get_platform",
          args: {},
        }),
      );
      expect(await reply).toEqual({
        header: JSON.stringify({ type: "result", id: 7 }),
        body: JSON.stringify("linux"),
      });
    } finally {
      socket.close();
      await server.stop(true);
    }
  });

  test.each([
    { name: "a foreign origin", origin: "https://evil.example", options: {}, status: "403" },
    { name: "a missing session cookie", options: { cookie: null }, status: "401" },
    {
      name: "a wrong session cookie",
      options: { cookie: `${APP_SESSION_COOKIE_NAME}=wrong` },
      status: "401",
    },
    { name: "another subprotocol", options: { protocol: "openducktor-channel.v0" }, status: "426" },
  ])("refuses a host channel upgrade with $name", async ({ origin, options, status }) => {
    const server = await createTerminalUpgradeTestServer();
    try {
      const responseHead = await performWebSocketUpgrade(
        server.port,
        `${TERMINAL_UPGRADE_BASE_PATH}/channel`,
        origin ?? TERMINAL_UPGRADE_FRONTEND_ORIGIN,
        { protocol: HOST_CHANNEL_SUBPROTOCOL, ...options },
      );
      expect(responseHead.split("\r\n")[0]).toContain(status);
    } finally {
      await server.stop(true);
    }
  });

  test.each(["/channel", "/terminal"])(
    "refuses %s upgrades after shutdown starts",
    async (path) => {
      const server = await createTerminalUpgradeTestServer(
        TERMINAL_UPGRADE_BASE_PATH,
        "127.0.0.1",
        0,
        true,
      );
      try {
        const responseHead = await performWebSocketUpgrade(
          server.port,
          `${TERMINAL_UPGRADE_BASE_PATH}${path}`,
          TERMINAL_UPGRADE_FRONTEND_ORIGIN,
          {
            protocol:
              path === "/channel" ? HOST_CHANNEL_SUBPROTOCOL : TERMINAL_PROTOCOL_SUBPROTOCOL,
          },
        );
        expect(responseHead.split("\r\n")[0]).toContain("503");
      } finally {
        await server.stop(true);
      }
    },
  );

  test("rejects invalid browser frontend origins before opening a host port", () => {
    expect(() => Effect.runSync(validateFrontendOriginEffect("ftp://127.0.0.1:1420"))).toThrow(
      "browser frontend origin must use http or https",
    );
    expect(() =>
      Effect.runSync(validateFrontendOriginEffect("http://user:pass@127.0.0.1:1420")),
    ).toThrow("browser frontend origin must not include credentials");
  });

  test("accepts remote and https browser frontend origins for network deployments", () => {
    expect(Effect.runSync(validateFrontendOriginEffect("http://100.64.0.1:1420"))).toBe(
      "http://100.64.0.1:1420",
    );
    expect(Effect.runSync(validateFrontendOriginEffect("https://machine.ts.net:443"))).toBe(
      "https://machine.ts.net",
    );
    expect(allowedFrontendOrigins("http://100.64.0.1:1420")).toEqual(
      new Set([
        "http://100.64.0.1:1420",
        "http://127.0.0.1:1420",
        "http://localhost:1420",
        "http://[::1]:1420",
      ]),
    );
    expect(allowedFrontendOrigins("https://machine.ts.net")).toEqual(
      new Set([
        "https://machine.ts.net",
        "http://127.0.0.1:443",
        "http://localhost:443",
        "http://[::1]:443",
      ]),
    );
    expect(allowedFrontendOrigins("https://machine.ts.net", 1420)).toEqual(
      new Set([
        "https://machine.ts.net",
        "http://127.0.0.1:1420",
        "http://localhost:1420",
        "http://[::1]:1420",
      ]),
    );
    expect(allowedFrontendOrigins("http://100.64.0.1:80")).toEqual(
      new Set(["http://100.64.0.1", "http://127.0.0.1", "http://localhost", "http://[::1]"]),
    );
  });

  test.each([
    "https://machine.ts.net.",
    "https://machine.ts.net.:443",
    "https://machine.ts.net.:8443",
    "http://machine.ts.net.:80",
  ])("allows configured and canonical CORS origins for %s", async (frontendOrigin) => {
    const configured = new URL(frontendOrigin);
    const canonical = new URL(frontendOrigin);
    canonical.hostname = "machine.ts.net";
    const allowedOrigins = allowedFrontendOrigins(frontendOrigin, 1420);
    expect(allowedOrigins).toEqual(
      new Set([
        configured.origin,
        canonical.origin,
        "http://127.0.0.1:1420",
        "http://localhost:1420",
        "http://[::1]:1420",
      ]),
    );
    for (const origin of [
      configured.origin,
      canonical.origin,
      "https://unknown.example",
      "https://sub.machine.ts.net",
    ]) {
      const response = await Effect.runPromise(
        handleTypescriptHostBackendRequest({
          allowedOrigins,
          appSessionCookieName: APP_SESSION_COOKIE_NAME,
          appToken: APP_TOKEN,
          browserPreviews: unexpectedBrowserPreviews,
          controlToken: CONTROL_TOKEN,
          taskAssetReadService: missingTaskAssetReadService,
          localAttachments: createLocalAttachmentAdapter(),
          logger: testLogger,
          request: new TestServerRequest("http://127.0.0.1/session", {
            method: "OPTIONS",
            headers: { origin, "access-control-request-method": "POST" },
          }),
          sessionCookieSecure: configured.protocol === "https:",
          shutdownStarted: false,
          beginShutdown: () => {},
          stop: async () => {},
        }),
      );
      const allowed = origin === configured.origin || origin === canonical.origin;
      expect(response.status).toBe(allowed ? 204 : 403);
      expect(response.headers.get("access-control-allow-origin")).toBe(allowed ? origin : null);
    }
  });

  test("keeps the failure kind of a host command error", async () => {
    const hostCommandRouter = createTestHostCommandRouter((command) =>
      Effect.fail(
        new HostOperationError({
          message: `Failed to invoke ${command}.`,
          operation: "test.invoke",
          details: { command, failureKind: "timeout" },
        }),
      ),
    );

    expect(await invokeTestCommand(hostCommandRouter, "runtime_status")).toEqual({
      error: {
        kind: "host",
        response: {
          error: "Failed to invoke runtime_status.",
          failureKind: "timeout",
          message: "Failed to invoke runtime_status.",
        },
      },
    });
  });

  test("returns successful host command results without changing their shape", async () => {
    const hostCommandRouter = createTestHostCommandRouter(() => Effect.succeed("linux"));

    expect(await invokeTestCommand(hostCommandRouter, "system_get_platform")).toEqual({
      result: "linux",
    });
  });

  test("interrupts the command and runs its cleanup when the signal aborts", async () => {
    let cleanedUp = false;
    const started = createDeferred<void>();
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.sync(() => started.resolve()).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            cleanedUp = true;
          }),
        ),
      ),
    );
    const cancel = new AbortController();
    const reply = invokeLocalHostCommand(
      hostCommandRouter,
      "workspace_get_git_provider_context",
      {},
      () => false,
      cancel.signal,
    );
    await started.promise;
    cancel.abort(new Error("The client cancelled the request."));
    await reply;

    expect(cleanedUp).toBe(true);
  });

  test("fails only the command when it dies with a defect", async () => {
    const hostCommandRouter = createTestHostCommandRouter(() => Effect.die(new Error("boom")));

    expect(await invokeTestCommand(hostCommandRouter, "system_get_platform")).toEqual({
      error: { kind: "host", response: { error: "boom", message: "boom" } },
    });
  });

  test("keeps structured terminal failures of a host command", async () => {
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.fail(
        new TerminalServiceError({
          code: "unsupported_runtime",
          operation: "create",
          message: "Interactive terminals are unavailable in this runtime.",
          workingDir: "/repo/worktree",
        }),
      ),
    );

    const reply = await invokeTestCommand(hostCommandRouter, "terminal_create", {
      workingDir: "/repo/worktree",
      context: {},
    });

    expect(reply).toEqual({
      error: {
        kind: "host",
        response: {
          error: "Interactive terminals are unavailable in this runtime.",
          message: "Interactive terminals are unavailable in this runtime.",
          failure: {
            kind: "terminal",
            terminalFailure: {
              code: "unsupported_runtime",
              message: "Interactive terminals are unavailable in this runtime.",
              workingDir: "/repo/worktree",
            },
          },
        },
      },
    });
  });

  test("keeps workspace write failures of a host command", async () => {
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.fail(
        new WorkspaceTextFileWriteError({
          message: "The file changed after it was loaded.",
          failure: {
            code: "stale_revision",
            message: "The file changed after it was loaded.",
            rootPath: "/repo",
            relativePath: "src/file.ts",
          },
        }),
      ),
    );

    const reply = await invokeTestCommand(hostCommandRouter, "filesystem_write_text_file", {
      rootPath: "/repo",
      relativePath: "src/file.ts",
      contents: "draft",
      revision: "sha256:old",
    });

    expect(reply).toEqual({
      error: {
        kind: "host",
        response: {
          error: "The file changed after it was loaded.",
          message: "The file changed after it was loaded.",
          failure: {
            kind: "workspace_text_file_write",
            workspaceTextFileWriteFailure: {
              code: "stale_revision",
              message: "The file changed after it was loaded.",
              rootPath: "/repo",
              relativePath: "src/file.ts",
            },
          },
        },
      },
    });
  });

  test("keeps runtime query identity and history diagnostics of a host command", async () => {
    const failure = {
      code: "invalid_runtime_response" as const,
      operation: "load session history",
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "thread-1",
      summary: "Could not load session history.",
      detail: "Check the host runtime logs.",
      sessionHistoryFailure: {
        code: "invalid_runtime_response" as const,
        summary: "Codex returned invalid conversation history.",
        detail: "A history item has an invalid shape.",
        diagnosticId: "diagnostic-1",
        method: "thread/turns/list" as const,
        pageCursor: null,
      },
    };
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.fail(new RuntimeQueryError({ message: failure.detail, failure })),
    );
    const reply = await invokeTestCommand(hostCommandRouter, "agent_runtime_load_session_history", {
      input: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        externalSessionId: "thread-1",
      },
    });
    expect(reply).toEqual({
      error: {
        kind: "host",
        response: {
          error: failure.detail,
          message: failure.detail,
          failure: { kind: "runtime_query", runtimeQueryFailure: failure },
        },
      },
    });
  });

  test("keeps structured task asset failures of a host command", async () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const hostCommandRouter = createTestHostCommandRouter(() =>
      Effect.fail(
        new TaskAssetError({
          operation: "update",
          code: "partial_state",
          taskId: "task-1",
          assetIds: [assetId],
          failedPhase: "compensate_update",
          durableState: "unknown",
          retryAllowed: false,
          message: "Refresh before continuing.",
        }),
      ),
    );

    expect(await invokeTestCommand(hostCommandRouter, "task_update")).toMatchObject({
      error: {
        kind: "host",
        response: {
          failure: {
            kind: "task_asset",
            taskAssetFailure: {
              code: "partial_state",
              taskId: "task-1",
              assetIds: [assetId],
              retryAllowed: false,
            },
          },
        },
      },
    });
  });

  test("isolates buffered bus delivery failures after accepting and buffering the event", () => {
    const failure = new Error("first listener failed");
    const reported: unknown[] = [];
    const eventBus = new BufferedHostEventBus({
      report: ({ cause }) => reported.push(cause),
    });
    const observed: unknown[] = [];
    const stopFailures = eventBus.subscribeDeliveryFailures((value) => observed.push(value));
    const received = mock(() => {});
    const unsubscribeReceived = eventBus.subscribe("openducktor://run-event", received);
    eventBus.subscribe("openducktor://run-event", () => {
      throw failure;
    });
    let unsubscribeDuringDelivery = () => {};
    eventBus.subscribe("openducktor://run-event", () => unsubscribeDuringDelivery());
    unsubscribeDuringDelivery = unsubscribeReceived;

    expect(() =>
      eventBus.publish({
        channel: "openducktor://run-event",
        payload: { type: "autopilot_failure", failure: null },
      }),
    ).not.toThrow();
    expect(received).toHaveBeenCalledWith({
      channel: "openducktor://run-event",
      payload: { type: "autopilot_failure", failure: null },
    });
    expect(reported).toEqual([failure]);
    expect(observed).toEqual([{ channel: "openducktor://run-event", cause: failure }]);
    stopFailures();
    expect(eventBus.stream().replayAfter(0).events).toHaveLength(1);
  });

  test("resolves host backend exit after stop server failures", async () => {
    const resolvedExitCodes: number[] = [];

    await expect(
      stopHostBackend({
        disposeHost: () => Effect.void,
        logger: testLogger,
        resolveExited: (exitCode) => {
          resolvedExitCodes.push(exitCode);
        },
        stopServer: () => {
          throw new Error("stop server failed");
        },
      }),
    ).rejects.toMatchObject({ _tag: "WebOperationError" });
    expect(resolvedExitCodes).toEqual([1]);
  });

  test("resolves host backend exit after asynchronous stop server failures", async () => {
    const resolvedExitCodes: number[] = [];

    await expect(
      stopHostBackend({
        disposeHost: () => Effect.void,
        logger: testLogger,
        resolveExited: (exitCode) => {
          resolvedExitCodes.push(exitCode);
        },
        stopServer: async () => {
          throw new Error("async stop server failed");
        },
      }),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.host.stop-server",
    });
    expect(resolvedExitCodes).toEqual([1]);
  });

  test("stops the backend and resolves exit when failure logging rejects", async () => {
    const persistenceError = new Error(
      "openducktor.logs.append failed for /tmp/openducktor-web.log",
    );
    const resolvedExitCodes: number[] = [];
    let stopCalls = 0;

    await expect(
      stopHostBackend({
        disposeHost: () => Effect.fail(new Error("host disposal failed")),
        logger: {
          error: () => Effect.fail(persistenceError),
          info: () => Effect.void,
          success: () => Effect.void,
        },
        resolveExited: (exitCode) => {
          resolvedExitCodes.push(exitCode);
        },
        stopServer: () => {
          stopCalls += 1;
        },
      }),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.host.shutdown",
      details: {
        failures: [
          expect.objectContaining({ message: "host disposal failed" }),
          expect.objectContaining({
            _tag: "WebResourceError",
            cause: persistenceError,
            resource: "persistent-log",
          }),
        ],
      },
    });

    expect(stopCalls).toBe(1);
    expect(resolvedExitCodes).toEqual([1]);
  });

  test("rejects missing or invalid backend auth through typed route errors", async () => {
    const sessionMissing = await handleTestRequest(
      new Request("http://127.0.0.1/session", { method: "POST" }),
    );
    expect(sessionMissing.status).toBe(401);
    expect(await sessionMissing.json()).toEqual({
      error: "Missing OpenDucktor web host app token.",
      message: "Missing OpenDucktor web host app token.",
    });

    const sessionInvalid = await handleTestRequest(
      new Request("http://127.0.0.1/session", {
        method: "POST",
        headers: { "x-openducktor-app-token": "wrong" },
      }),
    );
    expect(sessionInvalid.status).toBe(403);
    expect(await sessionInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host app token.",
      message: "Invalid OpenDucktor web host app token.",
    });

    let stopCalls = 0;
    const stop = async () => {
      stopCalls += 1;
    };
    const shutdownMissing = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", { method: "POST" }),
      { stop },
    );
    expect(shutdownMissing.status).toBe(401);
    expect(await shutdownMissing.json()).toEqual({
      error: "Missing OpenDucktor web host control token.",
      message: "Missing OpenDucktor web host control token.",
    });
    expect(stopCalls).toBe(0);

    const shutdownInvalid = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", {
        method: "POST",
        headers: { "x-openducktor-control-token": "wrong" },
      }),
      { stop },
    );
    expect(shutdownInvalid.status).toBe(403);
    expect(await shutdownInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host control token.",
      message: "Invalid OpenDucktor web host control token.",
    });
    expect(stopCalls).toBe(0);

    const previewUrl = "http://127.0.0.1/local-attachment-preview?path=/tmp/file";
    const previewMissing = await handleTestRequest(new Request(previewUrl));
    expect(previewMissing.status).toBe(401);
    expect(await previewMissing.json()).toEqual({
      error: "Missing OpenDucktor web host app token.",
      message: "Missing OpenDucktor web host app token.",
    });

    const previewInvalid = await handleTestRequest(
      new TestServerRequest(previewUrl, {
        headers: new Headers([["cookie", "openducktor_web_session=wrong"]]),
      }),
    );
    expect(previewInvalid.status).toBe(403);
    expect(await previewInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host app token.",
      message: "Invalid OpenDucktor web host app token.",
    });
  });

  test("serves task assets only through the authenticated exact-context route", async () => {
    const context = {
      workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
      taskId: "task-1",
      scope: "description",
      assetId: "550e8400-e29b-41d4-a716-446655440000",
    };
    let readInput: unknown;
    const taskAssetReadService: TaskAssetReadService = {
      read: (input) => {
        readInput = input;
        return Effect.succeed({
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: "image/png",
          headers: {
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="diagram.png"',
            "Content-Type": "image/png",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
      readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
    };
    const url = `http://127.0.0.1/task-assets/${context.workspaceId}/${context.taskId}/${context.scope}/${context.assetId}`;

    const unauthorized = await handleTestRequest(new Request(url), {
      taskAssetReadService,
    });
    expect(unauthorized.status).toBe(401);
    expect(readInput).toBeUndefined();

    const response = await handleTestRequest(
      new TestServerRequest(url, {
        headers: new Headers([["cookie", `openducktor_web_session=${APP_TOKEN}`]]),
      }),
      { taskAssetReadService },
    );

    expect(response.status).toBe(200);
    expect(readInput).toEqual(context);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("returns 404 when an authenticated task asset relation is missing", async () => {
    const url =
      "http://127.0.0.1/task-assets/9f66372b-e956-47f4-af2f-77e0df2ad4e1/task-1/description/550e8400-e29b-41d4-a716-446655440000";
    const response = await handleTestRequest(
      new TestServerRequest(url, {
        headers: new Headers([["cookie", `openducktor_web_session=${APP_TOKEN}`]]),
      }),
    );

    expect(response.status).toBe(404);
  });

  test("marks shutdown as started before deferred host teardown runs", async () => {
    let shutdownStarted = false;
    let stopCalls = 0;

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", {
        method: "POST",
        headers: { "x-openducktor-control-token": CONTROL_TOKEN },
      }),
      {
        beginShutdown: () => {
          shutdownStarted = true;
        },
        stop: async () => {
          stopCalls += 1;
        },
      },
    );

    expect(response.status).toBe(202);
    expect(shutdownStarted).toBe(true);
    expect(stopCalls).toBe(0);
  });

  test("refuses commands after the shutdown gate while host teardown remains pending", async () => {
    const disposeStarted = createDeferred();
    const disposeReleased = createDeferred();
    let invokeCalls = 0;
    const teardown = stopHostBackend({
      disposeHost: () =>
        Effect.promise(async () => {
          disposeStarted.resolve();
          await disposeReleased.promise;
        }),
      logger: testLogger,
      resolveExited: () => {},
      stopServer: () => {},
    });

    await disposeStarted.promise;
    try {
      const hostCommandRouter = createTestHostCommandRouter(() => {
        invokeCalls += 1;
        return Effect.succeed(null);
      });
      const reply = await invokeLocalHostCommand(
        hostCommandRouter,
        "runtime_status",
        {},
        () => true,
      );

      expect(reply).toEqual({
        error: {
          kind: "host",
          response: {
            error: "Browser backend is shutting down and is no longer accepting new work.",
            message: "Browser backend is shutting down and is no longer accepting new work.",
          },
        },
      });
      expect(invokeCalls).toBe(0);
    } finally {
      disposeReleased.resolve();
      await teardown;
    }
  });

  test("keeps the backend server alive until host disposal finishes", async () => {
    const calls: string[] = [];
    let releaseDispose: () => void = () => {};
    const disposeReleased = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    let disposeStarted: () => void = () => {};
    const disposeStartedPromise = new Promise<void>((resolve) => {
      disposeStarted = resolve;
    });

    const stopPromise = stopHostBackend({
      disposeHost: () =>
        Effect.promise(async () => {
          calls.push("dispose-started");
          disposeStarted();
          await disposeReleased;
          calls.push("dispose-finished");
        }),
      resolveExited: (exitCode) => {
        calls.push(`exited-${exitCode}`);
      },
      logger: testLogger,
      stopServer: () => {
        calls.push("server-stopped");
      },
    });

    await disposeStartedPromise;
    expect(calls).toEqual(["dispose-started"]);

    releaseDispose();
    await stopPromise;
    expect(calls).toEqual(["dispose-started", "dispose-finished", "server-stopped", "exited-0"]);
  });
});
