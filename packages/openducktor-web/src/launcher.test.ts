import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { createBrowserRuntimeConfigState } from "./browser-runtime-config-state";
import { parseCliArgs } from "./cli";
import { WebOperationError } from "./effect/web-errors";
import {
  logDuplicateWebTerminationNotice,
  preserveLauncherFailureAfterStop,
  resolveWebMcpBridgeDiscoveryMode,
  runLauncherEffect,
  runWebSignalShutdown,
  validateLauncherNetworkOptionsEffect,
  viteServerOptions,
  writeRuntimeConfigResponse,
} from "./launcher";
import {
  buildBrowserBackendUrl,
  buildBrowserRuntimeConfigJson,
  buildExternalBackendUrl,
  buildFrontendDisplayUrls,
  closeFrontendServer,
  closeViteFrontendServer,
  indexStaticAssetPaths,
  keepProcessAliveDuring,
  readinessHostForBind,
  resolveIndexedStaticAssetPath,
  resolveStaticAssetPath,
  stopLauncherServices,
  waitForBackend,
} from "./launcher-support";
import {
  allowedHostnamesFor,
  isLoopbackHost,
  isRequestHostAllowed,
  LOCALHOST,
  parseHostEffect,
} from "./http-origin";
import type { WebLogger } from "./logger";

const testLogger: WebLogger = {
  error: () => Effect.void,
  info: () => Effect.void,
  success: () => Effect.void,
};

const createHostProcess = (exited: Promise<number>): Pick<Bun.Subprocess, "exited"> => ({ exited });

describe("launcher internals", () => {
  test.each([
    "127.0.0.0",
    "127.0.0.1",
    "127.0.0.2",
    "127.255.255.255",
    "127.0.0.2.",
    "localhost",
    "localhost.",
    "runner.localhost",
    "nested.runner.localhost",
    "nested.runner.localhost.",
    "::1",
    "[::1]",
    "[::ffff:127.0.0.0]",
    "[::ffff:127.255.255.255]",
    "::ffff:127.0.0.1",
    "[::ffff:7f00:0]",
    "[::ffff:7fff:ffff]",
    "::ffff:7f00:1",
  ])("recognizes loopback host %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  test.each([
    "126.255.255.255",
    "128.0.0.0",
    "100.64.0.1",
    "127.example.com",
    "127.256.0.1",
    "127.0.256.1",
    "127.0.0.256",
    "127.0.0.-1",
    "127.0.0",
    "127.0.0.1.2",
    "127.0.0.0000",
    "127..0.1",
    "notlocalhost",
    "localhost.example",
    "[::ffff:126.255.255.255]",
    "[::ffff:128.0.0.0]",
    "[::ffff:7eff:ffff]",
    "[::ffff:8000:0]",
    "[::ffff:127.256.0.1]",
    "[::ffff:7f00:10000]",
    "[::ffff:localhost]",
    "[::ffff:runner.localhost]",
    "[::7f00:1]",
  ])("does not classify invalid or remote host %s as loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  test.each([
    "127.0.0.0",
    "127.0.0.2",
    "127.255.255.255",
    "0x7f000002",
    "[::ffff:127.0.0.0]",
    "[::ffff:127.0.0.1]",
    "[::ffff:127.255.255.255]",
    "[::ffff:7f00:0]",
    "[::ffff:7fff:ffff]",
    "[0:0:0:0:0:ffff:127.0.0.1]",
    "runner.localhost",
    "nested.runner.localhost.",
  ])(
    "rejects loopback external host %s through CLI and programmatic launch paths",
    async (host) => {
      const externalUrl = `http://${host}:1420`;
      const parsed = parseCliArgs(["--host", "0.0.0.0", "--external-url", externalUrl]);
      expect(parsed.externalUrl).toBe(new URL(externalUrl).origin);
      for (const options of [parsed, { host: "0.0.0.0", externalUrl }]) {
        await expect(
          Effect.runPromise(
            runLauncherEffect(
              {
                ...options,
                packageRoot: "/missing-web-package",
                workspaceMode: false,
                frontendPort: 0,
                backendPort: 0,
              },
              testLogger,
            ),
          ),
        ).rejects.toThrow("binds a non-loopback host");
      }
    },
  );

  test.each([undefined, "http://127.0.0.2:1420"])(
    "accepts an IPv4 loopback bind with external URL %s",
    async (externalUrl) => {
      await Effect.runPromise(
        validateLauncherNetworkOptionsEffect({
          basePath: undefined,
          bindHost: "127.0.0.2",
          externalUrl,
        }),
      );
    },
  );

  test("does not expand the request Host allowlist to the loopback block", () => {
    expect(
      allowedHostnamesFor({ bindHost: LOCALHOST, externalUrl: undefined }).has("[::ffff:7f00:1]"),
    ).toBe(false);
    expect(
      allowedHostnamesFor({ bindHost: LOCALHOST, externalUrl: undefined }).has("runner.localhost"),
    ).toBe(false);
    expect(
      allowedHostnamesFor({ bindHost: LOCALHOST, externalUrl: undefined }).has("127.0.0.2"),
    ).toBe(false);
  });

  test.each([
    "http://0.0.0.0:1420",
    "http://[::]:1420",
    "http://[::ffff:0.0.0.0]:1420",
    "http://[::ffff:0:0]:1420",
    "http://[0:0:0:0:0:ffff:0:0]:1420",
  ])("rejects wildcard external origin %s before starting servers", async (externalUrl) => {
    await expect(
      Effect.runPromise(
        runLauncherEffect(
          {
            packageRoot: "/missing-web-package",
            workspaceMode: false,
            frontendPort: 0,
            backendPort: 0,
            host: "0.0.0.0",
            externalUrl,
          },
          testLogger,
        ),
      ),
    ).rejects.toThrow("Use the real IP address or DNS name");
  });

  test.each(["0.0.0.0", "[::]", "[::ffff:0.0.0.0]"])(
    "accepts wildcard bind %s with a non-wildcard mapped external origin",
    async (host) => {
      const externalUrl = "http://[::ffff:100.64.0.1]:1420";
      const parsed = parseCliArgs(["--host", host, "--external-url", externalUrl]);
      expect(parsed.externalUrl).toBe("http://[::ffff:6440:1]:1420");
      for (const url of [externalUrl, parsed.externalUrl]) {
        await Effect.runPromise(
          validateLauncherNetworkOptionsEffect({
            basePath: undefined,
            bindHost: await Effect.runPromise(parseHostEffect(host, "--host", true)),
            externalUrl: url,
          }),
        );
      }
    },
  );

  test("allows dotted and canonical external hostnames in Vite without duplicates", () => {
    expect(
      viteServerOptions({
        packageRoot: "/web-package",
        workspaceMode: false,
        frontendPort: 0,
        backendPort: 0,
        host: "machine.ts.net",
        externalUrl: "https://machine.ts.net.",
      }).allowedHosts,
    ).toEqual(["localhost", ".localhost", "machine.ts.net.", "machine.ts.net"]);
  });

  test.each([
    {
      host: "RUNNER.INTERNAL.",
      externalUrl: "https://PUBLIC.EXAMPLE",
      hostname: "runner.internal",
    },
    {
      host: "RUNNER.INTERNAL.",
      externalUrl: "https://RUNNER.INTERNAL.",
      hostname: "runner.internal",
    },
    { host: LOCALHOST, externalUrl: "http://RUNNER.LOCALHOST.:1420", hostname: "runner.localhost" },
    { host: LOCALHOST, externalUrl: "http://LOCALHOST.:1420", hostname: "localhost" },
  ])(
    "allows exact dotted and undotted Vite hosts for $externalUrl with $host",
    async ({ host, externalUrl, hostname }) => {
      const { createServer } = await import("vite");
      const parsed = parseCliArgs(["--host", host, "--external-url", externalUrl]);
      for (const input of [parsed, { host, externalUrl }]) {
        const bindHost = await Effect.runPromise(parseHostEffect(input.host, "--host", true));
        const options = viteServerOptions({
          host: bindHost,
          externalUrl: z.string().parse(input.externalUrl),
          packageRoot: process.cwd(),
          workspaceMode: false,
          frontendPort: 0,
          backendPort: 0,
        });
        expect(options.host).toBe(host.toLowerCase());
        expect(options.allowedHosts).toEqual([
          ...new Set([
            "localhost",
            ".localhost",
            new URL(externalUrl).hostname,
            new URL(externalUrl).hostname.replace(/\.$/u, ""),
            ...(host === LOCALHOST ? [] : ["runner.internal.", "runner.internal"]),
          ]),
        ]);
        const vite = await createServer({
          configFile: false,
          optimizeDeps: { noDiscovery: true, include: [] },
          server: { ...options, middlewareMode: true, hmr: false, ws: false },
          plugins: [
            {
              name: "test-host-response",
              configureServer(server) {
                return () =>
                  server.middlewares.use((_request, response) => response.end("allowed"));
              },
            },
          ],
        });
        // Keep the resolved bind hostname while sending real HTTP requests over loopback.
        const server = createHttpServer(vite.middlewares);
        try {
          expect(vite.config.server.host).toBe(bindHost);
          expect(vite.config.server.allowedHosts).toContain(hostname);
          expect(vite.config.server.allowedHosts).toContain(`${hostname}.`);
          await new Promise<void>((resolve) => server.listen(0, LOCALHOST, resolve));
          const address = z.object({ port: z.number() }).parse(server.address());
          for (const [requestHost, status] of [
            [hostname, 200],
            [`${hostname}.`, 200],
            ["unknown.example", 403],
            [`sub.${hostname}.`, 403],
            ...(hostname === "runner.internal" ? [["sub.runner.internal", 403] as const] : []),
          ] as const) {
            const response = await fetch(`http://${LOCALHOST}:${address.port}/`, {
              headers: { host: requestHost },
              proxy: "",
            });
            expect(response.status).toBe(status);
            await response.text();
          }
        } finally {
          try {
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          } finally {
            await vite.close();
          }
        }
      }
    },
    10_000,
  );

  test.each(["100.64.0.1", "2001:db8::1", "[2001:db8::1]", "runner.internal"])(
    "omits loopback display URLs for specific bind %s",
    (bindHost) => {
      expect(buildFrontendDisplayUrls(1420, bindHost, "https://machine.ts.net")).toEqual([
        { kind: "network", url: "https://machine.ts.net/" },
      ]);
    },
  );

  test.each(["::", "[::]", "::1", "[::1]"])("prints only IPv6 loopback for bind %s", (bindHost) => {
    expect(buildFrontendDisplayUrls(1420, bindHost)).toEqual([
      { kind: "local", url: "http://[::1]:1420/" },
    ]);
  });

  test.each(["localhost", "localhost.", "runner.localhost", "127.0.0.2", "127.42.3.4"])(
    "prints the configured loopback bind %s",
    (bindHost) => {
      expect(buildFrontendDisplayUrls(1420, bindHost)).toEqual([
        { kind: "local", url: `http://${bindHost}:1420/` },
      ]);
    },
  );

  test("uses development discovery for workspace source launches", () => {
    expect(resolveWebMcpBridgeDiscoveryMode(true)).toBe("development");
  });

  test("uses production discovery for installed static launches", () => {
    expect(resolveWebMcpBridgeDiscoveryMode(false)).toBe("production");
  });

  test("rejects a non-loopback bind without an external URL", async () => {
    await expect(
      Effect.runPromise(
        validateLauncherNetworkOptionsEffect({
          basePath: undefined,
          bindHost: "0.0.0.0",
          externalUrl: undefined,
        }),
      ),
    ).rejects.toThrow("binds a non-loopback host");
  });

  test("rejects a non-loopback bind with a loopback external URL", async () => {
    await expect(
      Effect.runPromise(
        validateLauncherNetworkOptionsEffect({
          basePath: undefined,
          bindHost: "0.0.0.0",
          externalUrl: "http://127.0.0.1:1420",
        }),
      ),
    ).rejects.toThrow("binds a non-loopback host");
  });

  test("accepts a non-loopback bind with a remote external URL", async () => {
    await Effect.runPromise(
      validateLauncherNetworkOptionsEffect({
        basePath: undefined,
        bindHost: "0.0.0.0",
        externalUrl: "http://100.64.0.1:1420",
      }),
    );
  });

  test("rejects a trailing-dot loopback external URL with a non-loopback bind", async () => {
    await expect(
      Effect.runPromise(
        validateLauncherNetworkOptionsEffect({
          basePath: undefined,
          bindHost: "0.0.0.0",
          externalUrl: "http://localhost.:1420",
        }),
      ),
    ).rejects.toThrow("binds a non-loopback host");
  });

  test("accepts a trailing-dot loopback bind with a remote external URL", async () => {
    await Effect.runPromise(
      validateLauncherNetworkOptionsEffect({
        basePath: undefined,
        bindHost: "localhost.",
        externalUrl: "https://machine.ts.net",
      }),
    );
  });

  test("rejects a base path without an external URL", async () => {
    await expect(
      Effect.runPromise(
        validateLauncherNetworkOptionsEffect({
          basePath: "/api",
          bindHost: LOCALHOST,
          externalUrl: undefined,
        }),
      ),
    ).rejects.toThrow("--base-path without --external-url");
  });

  test("accepts a base path with an external URL", async () => {
    await Effect.runPromise(
      validateLauncherNetworkOptionsEffect({
        basePath: "/api",
        bindHost: LOCALHOST,
        externalUrl: "https://machine.ts.net",
      }),
    );
  });

  test.each([
    "/api/.",
    "/foo/../api",
    "/api//nested",
    "/",
    "",
    "api",
    "/api?x=1",
    "/api#x",
    "/%61pi",
  ])("rejects programmatic base path %s before startup", async (basePath) => {
    await expect(
      Effect.runPromise(
        runLauncherEffect(
          {
            packageRoot: "/missing-web-package",
            workspaceMode: false,
            frontendPort: 0,
            backendPort: 0,
            externalUrl: "https://machine.ts.net",
            basePath,
          },
          testLogger,
        ),
      ),
    ).rejects.toThrow("Invalid --base-path value");
  });

  test("scopes Vite fs.allow to the web package and frontend sources", () => {
    expect(
      viteServerOptions({
        backendPort: 14327,
        frontendPort: 1420,
        packageRoot: "/web-package",
        workspaceMode: false,
      }).fs?.allow,
    ).toEqual(["/web-package", path.join("/web-package", "../frontend/src")]);
  });

  test("allows workspace node_modules in Vite fs.allow so dependency assets load in workspace mode", () => {
    expect(
      viteServerOptions({
        backendPort: 14327,
        developmentInstanceId: "browser-test",
        frontendPort: 1420,
        packageRoot: "/repo/packages/openducktor-web",
        workspaceMode: true,
        workspaceRoot: "/repo",
      }).fs?.allow,
    ).toEqual([
      "/repo/packages/openducktor-web",
      path.join("/repo/packages/openducktor-web", "../frontend/src"),
      "/repo/node_modules",
    ]);
  });

  test("does not restrict Vite hosts for IP external URLs", () => {
    expect(
      viteServerOptions({
        backendPort: 14327,
        externalUrl: "http://100.64.0.1:1420",
        frontendPort: 1420,
        packageRoot: "/web-package",
        workspaceMode: false,
      }),
    ).not.toHaveProperty("allowedHosts");
  });

  test("allows the external hostname in Vite when it is not an IP address", () => {
    expect(
      viteServerOptions({
        backendPort: 14327,
        externalUrl: "https://machine.ts.net",
        frontendPort: 1420,
        packageRoot: "/web-package",
        workspaceMode: false,
      }).allowedHosts,
    ).toEqual(["localhost", ".localhost", "machine.ts.net"]);
  });

  test("allows a non-IP bind hostname in Vite next to the external hostname", () => {
    expect(
      viteServerOptions({
        backendPort: 14327,
        externalUrl: "https://machine.ts.net",
        frontendPort: 1420,
        host: "runner.internal",
        packageRoot: "/web-package",
        workspaceMode: false,
      }).allowedHosts,
    ).toEqual(["localhost", ".localhost", "machine.ts.net", "runner.internal"]);
  });

  test("does not add an IP bind hostname to the Vite allowlist", () => {
    expect(
      viteServerOptions({
        backendPort: 14327,
        externalUrl: "https://machine.ts.net",
        frontendPort: 1420,
        host: "10.0.0.5",
        packageRoot: "/web-package",
        workspaceMode: false,
      }).allowedHosts,
    ).toEqual(["localhost", ".localhost", "machine.ts.net"]);
  });

  test("allows only loopback, bind, and external hosts on remote frontend servers", () => {
    const hostnames = allowedHostnamesFor({
      bindHost: "0.0.0.0",
      externalUrl: "http://100.64.0.1:1420",
    });
    expect(hostnames).toEqual(
      new Set(["127.0.0.1", "localhost", "[::1]", "::1", "100.64.0.1", "0.0.0.0"]),
    );
    for (const host of ["100.64.0.1:1420", "localhost:1420", "[::1]:1420"]) {
      expect(
        isRequestHostAllowed(new Request("http://frontend/", { headers: { host } }), hostnames),
      ).toBe(true);
    }
    expect(
      isRequestHostAllowed(
        new Request("http://frontend/", { headers: { host: "evil.example" } }),
        hostnames,
      ),
    ).toBe(false);
    expect(
      isRequestHostAllowed(
        new Request("http://127.0.0.1:1420/", {
          headers: { host: "evil.example" },
        }),
        hostnames,
      ),
    ).toBe(false);
  });

  test("allows the proxy hostname and loopback hosts on loopback frontend servers", () => {
    const hostnames = allowedHostnamesFor({
      bindHost: "127.0.0.1",
      externalUrl: "https://machine.ts.net",
    });
    expect(
      isRequestHostAllowed(
        new Request("https://frontend/", {
          headers: { host: "machine.ts.net" },
        }),
        hostnames,
      ),
    ).toBe(true);
    expect(
      isRequestHostAllowed(
        new Request("http://frontend/", {
          headers: { host: "127.0.0.1:1420" },
        }),
        hostnames,
      ),
    ).toBe(true);
    expect(
      isRequestHostAllowed(
        new Request("http://frontend/", {
          headers: { host: "192.168.1.20:1420" },
        }),
        hostnames,
      ),
    ).toBe(false);
  });

  test("allows the dot-stripped proxy hostname on remote frontend servers", () => {
    const hostnames = allowedHostnamesFor({
      bindHost: "0.0.0.0",
      externalUrl: "https://machine.ts.net.",
    });
    expect(hostnames).toEqual(
      new Set(["127.0.0.1", "localhost", "[::1]", "::1", "machine.ts.net", "0.0.0.0"]),
    );
    expect(
      isRequestHostAllowed(
        new Request("http://frontend/", { headers: { host: "machine.ts.net" } }),
        hostnames,
      ),
    ).toBe(true);
  });

  test("probes readiness over loopback when the bind covers all interfaces", () => {
    expect(readinessHostForBind("0.0.0.0")).toBe(LOCALHOST);
    expect(readinessHostForBind("[::]")).toBe("::1");
    expect(readinessHostForBind("::")).toBe("::1");
    expect(readinessHostForBind("2001:db8::1")).toBe("2001:db8::1");
    expect(readinessHostForBind("[2001:db8::1]")).toBe("[2001:db8::1]");
    expect(readinessHostForBind("127.0.0.1")).toBe("127.0.0.1");
    expect(readinessHostForBind("::1")).toBe("::1");
    expect(readinessHostForBind("10.0.0.5")).toBe("10.0.0.5");
  });

  test.each(["[::ffff:0.0.0.0]", "[::ffff:0:0]", "[0:0:0:0:0:ffff:0:0]", "::ffff:0.0.0.0"])(
    "probes parsed mapped wildcard %s through IPv4 loopback",
    async (host) => {
      const parsed = await Effect.runPromise(parseHostEffect(host, "--host", true));
      expect(parsed).toBe("[::ffff:0:0]");
      expect(readinessHostForBind(parsed)).toBe(LOCALHOST);
      const specific = await Effect.runPromise(parseHostEffect("[::ffff:127.0.0.2]", "--host"));
      expect(readinessHostForBind(specific)).toBe("[::ffff:7f00:2]");
    },
  );

  test("reports runtime-config response failures instead of rejecting without an owner", async () => {
    const failure = new Error("client disconnected");
    const reportedFailures: unknown[] = [];
    const runtimeConfigState = createBrowserRuntimeConfigState();
    runtimeConfigState.publish('{"backendUrl":"http://127.0.0.1:14327"}');

    await writeRuntimeConfigResponse(
      runtimeConfigState,
      {
        end: () => {
          throw failure;
        },
        setHeader: () => {},
        statusCode: 0,
      },
      (cause) => reportedFailures.push(cause),
    );

    expect(reportedFailures).toEqual([failure]);
  });

  test("waits for the fake host health and token-authenticated session endpoints", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      token: string | null;
    }> = [];
    let healthAttempts = 0;
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(url),
        method: init?.method,
        token: headers.get("x-openducktor-app-token"),
      });
      if (String(url).endsWith("/health")) {
        healthAttempts += 1;
        return new Response(null, { status: healthAttempts === 1 ? 503 : 200 });
      }
      return new Response(null, { status: 200 });
    };

    await waitForBackend(
      "http://127.0.0.1:14327",
      "app-token",
      1_000,
      createHostProcess(new Promise<number>(() => {})),
      { fetch: fetchImpl, sleep: async () => {} },
    );

    expect(requests).toEqual([
      { url: "http://127.0.0.1:14327/health", method: undefined, token: null },
      { url: "http://127.0.0.1:14327/health", method: undefined, token: null },
      {
        url: "http://127.0.0.1:14327/session",
        method: "POST",
        token: "app-token",
      },
    ]);
  });

  test("fails fast when the fake host exits before readiness", async () => {
    const exited = Promise.resolve(9);
    await exited;

    await expect(
      waitForBackend("http://127.0.0.1:14327", "app-token", 0, createHostProcess(exited), {
        fetch: async () => new Response(null, { status: 503 }),
        sleep: async () => {},
      }),
    ).rejects.toThrow("OpenDucktor web host exited before startup completed with code 9.");
    await expect(
      waitForBackend("http://127.0.0.1:14327", "app-token", 0, createHostProcess(exited), {
        fetch: async () => new Response(null, { status: 503 }),
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ _tag: "WebOperationError" });
  });

  test("fails fast when the host readiness exit rejects", async () => {
    const backgroundFailure = new Error("task-sync persistent logging failed");

    await expect(
      waitForBackend(
        "http://127.0.0.1:14327",
        "app-token",
        0,
        createHostProcess(Promise.reject(backgroundFailure)),
        {
          fetch: async () => new Response(null, { status: 503 }),
          sleep: async () => {},
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.wait-for-backend",
      cause: backgroundFailure,
    });
  });

  test("aborts readiness fetches when the launcher timeout expires", async () => {
    let aborted = false;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("readiness aborted"));
        });
      });

    await expect(
      waitForBackend(
        "http://127.0.0.1:14327",
        "app-token",
        10,
        createHostProcess(new Promise<number>(() => {})),
        {
          fetch: fetchImpl,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow("Timed out waiting for OpenDucktor web host");
    expect(aborted).toBe(true);
  });

  test("stops frontend and host services directly", async () => {
    let stopCalls = 0;
    let frontendCloseCalls = 0;
    let resolveExited: (exitCode: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve;
    });
    const hostBackend = {
      exited,
      port: 14327,
      stop: async () => {
        stopCalls += 1;
        resolveExited(0);
      },
    };
    const frontendServer = {
      close: async () => {
        frontendCloseCalls += 1;
      },
    };

    await stopLauncherServices(
      {
        frontendServer,
        hostBackend,
        logger: testLogger,
      },
      {
        closeServer: async (server) => {
          await server?.close();
        },
        stopHost: async (backend) => {
          await backend.stop();
        },
      },
    );

    expect(frontendCloseCalls).toBe(1);
    expect(stopCalls).toBe(1);
  });

  test("delegates frontend connection shutdown to the server", async () => {
    let closeAllConnectionsCalls = 0;
    let closeIdleConnectionsCalls = 0;
    let closeCalls = 0;
    const frontendServer = {
      httpServer: {
        closeAllConnections: () => {
          closeAllConnectionsCalls += 1;
        },
        closeIdleConnections: () => {
          closeIdleConnectionsCalls += 1;
        },
      },
      close: () => {
        closeCalls += 1;
        return Promise.resolve();
      },
    };

    await closeFrontendServer(frontendServer);

    expect(closeCalls).toBe(1);
    expect(closeIdleConnectionsCalls).toBe(0);
    expect(closeAllConnectionsCalls).toBe(0);
  });

  test("reports a synchronous frontend close failure without forcing connections", async () => {
    let closeAllConnectionsCalls = 0;
    let closeIdleConnectionsCalls = 0;
    const frontendServer = {
      httpServer: {
        closeAllConnections: () => {
          closeAllConnectionsCalls += 1;
        },
        closeIdleConnections: () => {
          closeIdleConnectionsCalls += 1;
        },
      },
      close: () => {
        throw new Error("close failed");
      },
    };

    let error: unknown;
    try {
      await closeFrontendServer(frontendServer);
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({ _tag: "WebDependencyError" });
    expect(error).toEqual(expect.objectContaining({ message: "close failed" }));
    expect(closeIdleConnectionsCalls).toBe(0);
    expect(closeAllConnectionsCalls).toBe(0);
  });

  test("stops Bun HTTP connections before Vite shutdown", async () => {
    const calls: string[] = [];

    await closeViteFrontendServer({
      httpServer: {
        closeAllConnections: () => {
          calls.push("close-connections");
        },
      },
      close: async () => {
        calls.push("close-vite");
      },
    });

    expect(calls).toEqual(["close-connections", "close-vite"]);
  });

  test("keeps the process alive while shutdown work is pending", async () => {
    let intervalCallback: (() => void) | null = null;
    let intervalCancelled = false;
    let finishOperation: () => void = () => {};
    const operation = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });

    const keepAlivePromise = keepProcessAliveDuring(operation, {
      scheduleInterval: (callback) => {
        intervalCallback = callback;
        return () => {
          intervalCancelled = true;
        };
      },
    });

    expect(intervalCallback).not.toBeNull();
    expect(intervalCancelled).toBe(false);

    finishOperation();
    await keepAlivePromise;
    expect(intervalCancelled).toBe(true);
  });

  test("awaits a delayed duplicate-signal persistence failure before exiting", async () => {
    const persistenceError = new Error(
      "openducktor.logs.append failed for /tmp/openducktor-web.log",
    );
    const exitCodes: number[] = [];
    const reportedFailures: unknown[] = [];
    let markLogStarted: () => void = () => {};
    const logStarted = new Promise<void>((resolve) => {
      markLogStarted = resolve;
    });
    let rejectLog: () => void = () => {};

    const duplicateLogFailed = Effect.runPromise(
      logDuplicateWebTerminationNotice(
        {
          error: () => Effect.void,
          info: () =>
            Effect.tryPromise({
              try: () =>
                new Promise<void>((_resolve, reject) => {
                  markLogStarted();
                  rejectLog = () => reject(persistenceError);
                }),
              catch: (cause) => cause,
            }),
          success: () => Effect.void,
        },
        (cause) => {
          reportedFailures.push(cause);
        },
      ),
    );
    await logStarted;
    let markDuplicateAwaitStarted: () => void = () => {};
    const duplicateAwaitStarted = new Promise<void>((resolve) => {
      markDuplicateAwaitStarted = resolve;
    });

    const shutdown = runWebSignalShutdown({
      awaitDuplicateTerminationLog: () => {
        markDuplicateAwaitStarted();
        return duplicateLogFailed;
      },
      boundary: {
        exit: (exitCode) => exitCodes.push(exitCode),
        flush: async () => {},
        reportFailure: (cause) => reportedFailures.push(cause),
      },
      exitCode: 143,
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
        success: () => Effect.void,
      },
      signal: "SIGTERM",
      stop: Effect.void,
    });

    await duplicateAwaitStarted;
    expect(exitCodes).toEqual([]);
    rejectLog();
    await shutdown;

    expect(exitCodes).toEqual([1]);
    expect(reportedFailures).toEqual([
      expect.objectContaining({
        _tag: "WebResourceError",
        cause: persistenceError,
        resource: "persistent-log",
      }),
    ]);
  });

  test("closes duplicate-signal log admission before the final output flush", async () => {
    const exitCodes: number[] = [];
    let admissionOpen = true;
    let duplicateLogStarts = 0;
    let markFlushStarted: () => void = () => {};
    const flushStarted = new Promise<void>((resolve) => {
      markFlushStarted = resolve;
    });
    let releaseFlush: () => void = () => {};
    const flushReleased = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });

    const shutdown = runWebSignalShutdown({
      awaitDuplicateTerminationLog: async () => false,
      boundary: {
        exit: (exitCode) => exitCodes.push(exitCode),
        flush: async () => {
          if (admissionOpen) {
            duplicateLogStarts += 1;
          }
          markFlushStarted();
          await flushReleased;
        },
        reportFailure: () => {},
      },
      closeDuplicateTerminationLogAdmission: () => {
        admissionOpen = false;
      },
      exitCode: 143,
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
        success: () => Effect.void,
      },
      signal: "SIGTERM",
      stop: Effect.void,
    });

    await flushStarted;
    expect(duplicateLogStarts).toBe(0);
    expect(exitCodes).toEqual([]);

    releaseFlush();
    await shutdown;
    expect(exitCodes).toEqual([143]);
  });

  test("signal logging failures still run cleanup and exit through the explicit boundary", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const exitCodes: number[] = [];
    const reportedFailures: unknown[] = [];
    let cleanupCalls = 0;
    let flushCalls = 0;

    await runWebSignalShutdown({
      boundary: {
        exit: (exitCode) => {
          exitCodes.push(exitCode);
        },
        flush: async () => {
          flushCalls += 1;
        },
        reportFailure: (cause) => {
          reportedFailures.push(cause);
        },
      },
      exitCode: 143,
      logger: {
        error: () => Effect.die("The failed persistent logger must not be retried."),
        info: () => Effect.fail(persistenceError),
        success: () => Effect.void,
      },
      signal: "SIGTERM",
      stop: Effect.sync(() => {
        cleanupCalls += 1;
      }),
    });

    expect(cleanupCalls).toBe(1);
    expect(flushCalls).toBe(1);
    expect(exitCodes).toEqual([1]);
    expect(reportedFailures).toEqual([
      expect.objectContaining({
        _tag: "WebResourceError",
        cause: persistenceError,
        resource: "persistent-log",
      }),
    ]);
  });

  test("signal shutdown persists cleanup and logging failures together", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const cleanupError = new WebOperationError({
      operation: "web.launcher.cleanup",
      message: "frontend cleanup failed",
    });
    const persistedErrors: string[] = [];
    const exitCodes: number[] = [];

    await runWebSignalShutdown({
      boundary: {
        exit: (exitCode) => exitCodes.push(exitCode),
        flush: async () => {},
        reportFailure: () => {},
      },
      exitCode: 143,
      logger: {
        error: (message) => Effect.sync(() => persistedErrors.push(message)),
        info: () => Effect.fail(persistenceError),
        success: () => Effect.void,
      },
      signal: "SIGTERM",
      stop: Effect.fail(cleanupError),
    });

    expect(persistedErrors).toHaveLength(1);
    expect(persistedErrors[0]).toContain("frontend cleanup failed");
    expect(persistedErrors[0]).toContain("openducktor.logs.append failed");
    expect(exitCodes).toEqual([1]);
  });

  test("closes the frontend without a host", async () => {
    const calls: string[] = [];

    await stopLauncherServices(
      { frontendServer: null, hostBackend: null, logger: testLogger },
      {
        closeServer: async () => {
          calls.push("close frontend");
        },
        stopHost: async () => {
          calls.push("stop host");
        },
      },
    );

    expect(calls).toEqual(["close frontend"]);
  });

  test("reports frontend cleanup failure without a host", async () => {
    const frontendFailure = new Error("frontend close failed");
    const calls: string[] = [];

    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend: null,
          logger: {
            ...testLogger,
            error: (message) => Effect.sync(() => calls.push(message)),
          },
        },
        {
          closeServer: async () => {
            throw frontendFailure;
          },
          stopHost: async () => {
            calls.push("stop host");
          },
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebDependencyError",
      dependency: "frontend-server",
      operation: "close",
      message: "frontend close failed",
      cause: frontendFailure,
    });
    expect(calls).toEqual(["frontend close failed"]);
  });

  test("reports a nonzero host exit after a successful stop", async () => {
    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend: { exited: Promise.resolve(7), port: 14327, stop: async () => {} },
          logger: testLogger,
        },
        { closeServer: async () => {}, stopHost: async () => {} },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.shutdown",
      message: "OpenDucktor TypeScript host shutdown failed with exit code 7.",
      details: { hostExitCode: 7 },
    });
  });

  test("finishes shutdown error logging before accessing the host exit", async () => {
    const calls: string[] = [];
    const frontendFailure = new Error("frontend close failed");

    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend: {
            get exited() {
              calls.push("read exit");
              return Promise.resolve(0);
            },
            port: 14327,
            stop: async () => {},
          },
          logger: {
            ...testLogger,
            error: (message) => {
              calls.push(`log call: ${message}`);
              return Effect.sync(() => {
                calls.push("log finished");
              });
            },
          },
        },
        {
          closeServer: async () => {
            throw frontendFailure;
          },
          stopHost: async () => {},
        },
      ),
    ).rejects.toMatchObject({ cause: frontendFailure });
    expect(calls).toEqual(["log call: frontend close failed", "log finished", "read exit"]);
  });

  test("does not read or await the host exit code when host stop fails", async () => {
    let exitReads = 0;
    const exited = new Promise<number>(() => {});
    const hostBackend = {
      get exited() {
        exitReads += 1;
        return exited;
      },
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend,
          logger: testLogger,
        },
        {
          closeServer: async () => {},
          stopHost: async () => {
            throw new Error("host stop failed");
          },
        },
      ),
    ).rejects.toThrow("host stop failed");
    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend,
          logger: testLogger,
        },
        {
          closeServer: async () => {},
          stopHost: async () => {
            throw new Error("host stop failed");
          },
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebDependencyError",
      dependency: "typescript-host-backend",
      operation: "stop",
    });
    expect(exitReads).toBe(0);
  });

  test("preserves frontend and host shutdown failures together", async () => {
    const frontendFailure = new Error("frontend close failed");
    const hostFailure = new Error("host stop failed");
    const hostBackend = {
      exited: new Promise<number>(() => {}),
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        { frontendServer: null, hostBackend, logger: testLogger },
        {
          closeServer: async () => {
            throw frontendFailure;
          },
          stopHost: async () => {
            throw hostFailure;
          },
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.shutdown",
      details: {
        failures: [
          expect.objectContaining({ cause: frontendFailure }),
          expect.objectContaining({ cause: hostFailure }),
        ],
      },
    });
  });

  test("preserves frontend shutdown and rejected host exit failures together", async () => {
    const frontendFailure = new Error("frontend close failed");
    const hostExitFailure = new Error("host background logging failed");
    const hostBackend = {
      exited: Promise.reject(hostExitFailure),
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        { frontendServer: null, hostBackend, logger: testLogger },
        {
          closeServer: async () => {
            throw frontendFailure;
          },
          stopHost: async () => {},
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.shutdown",
      details: {
        failures: [
          expect.objectContaining({ cause: frontendFailure }),
          expect.objectContaining({
            cause: hostExitFailure,
            operation: "await-exit",
          }),
        ],
      },
    });
  });

  test("preserves cleanup failures when shutdown error logging fails", async () => {
    const frontendFailure = new Error("frontend close failed");
    const persistenceFailure = new Error("log append failed");
    const hostBackend = {
      exited: Promise.resolve(0),
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend,
          logger: {
            error: () => Effect.fail(persistenceFailure),
            info: () => Effect.void,
            success: () => Effect.void,
          },
        },
        {
          closeServer: async () => {
            throw frontendFailure;
          },
          stopHost: async () => {},
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.shutdown",
      details: {
        failures: [
          expect.objectContaining({ cause: frontendFailure }),
          expect.objectContaining({ cause: persistenceFailure }),
        ],
      },
    });
  });

  test("preserves launcher, cleanup, and cleanup-log failures together", async () => {
    const launcherFailure = new WebOperationError({
      operation: "web.launcher.start",
      message: "launcher failed",
    });
    const cleanupFailure = new WebOperationError({
      operation: "web.launcher.cleanup",
      message: "cleanup failed",
    });
    const loggingFailure = new Error("log append failed");

    await expect(
      Effect.runPromise(
        Effect.flip(
          preserveLauncherFailureAfterStop(launcherFailure, Effect.fail(cleanupFailure), {
            error: () => Effect.fail(loggingFailure),
            info: () => Effect.void,
            success: () => Effect.void,
          }),
        ),
      ),
    ).resolves.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.failure-cleanup",
      details: {
        failures: [
          launcherFailure,
          cleanupFailure,
          expect.objectContaining({
            _tag: "WebResourceError",
            cause: loggingFailure,
          }),
        ],
      },
    });
  });

  test("builds runtime config JSON for the browser shell", () => {
    expect(buildBrowserRuntimeConfigJson("http://127.0.0.1:14327", "app-token")).toBe(
      '{"backendUrl":"http://127.0.0.1:14327","appToken":"app-token"}\n',
    );
  });

  test("prints localhost first in the frontend availability URLs", () => {
    expect(buildFrontendDisplayUrls(1420, LOCALHOST)).toEqual([
      { kind: "local", url: "http://localhost:1420/" },
      { kind: "local", url: "http://127.0.0.1:1420/" },
    ]);
  });

  test("prints only the remote external URL in the frontend availability URLs", () => {
    expect(buildFrontendDisplayUrls(1420, "0.0.0.0", "http://100.64.0.1:1420")).toEqual([
      { kind: "network", url: "http://100.64.0.1:1420/" },
    ]);
  });

  test.each([LOCALHOST, "127.0.0.2", "localhost", "[::1]", "0.0.0.0", "[::]"])(
    "prints only the remote origin for bind %s with or without a backend base path",
    (bindHost) => {
      const externalUrl = "https://machine.ts.net";
      for (const basePath of [undefined, "/api"]) {
        const backend = buildBrowserBackendUrl(basePath, externalUrl, externalUrl, bindHost, 14327);
        expect(backend.browserUrl).toBe(basePath ? `${externalUrl}/api` : `${externalUrl}:14327`);
        expect(buildFrontendDisplayUrls(1420, bindHost, externalUrl)).toEqual([
          { kind: "network", url: `${externalUrl}/` },
        ]);
      }
    },
  );

  test("keeps local-only display links without duplicate external URLs", () => {
    expect(buildFrontendDisplayUrls(1420, LOCALHOST, "http://localhost:1420")).toEqual([
      { kind: "local", url: "http://localhost:1420/" },
      { kind: "local", url: "http://127.0.0.1:1420/" },
    ]);
  });

  test.each(["https://localhost", "https://127.0.0.1", "https://[::1]:8443"])(
    "prints only the HTTPS loopback external URL %s",
    (externalUrl) => {
      for (const bindHost of [LOCALHOST, "localhost", "[::1]"]) {
        expect(buildFrontendDisplayUrls(1420, bindHost, externalUrl)).toEqual([
          { kind: "network", url: `${externalUrl}/` },
        ]);
      }
    },
  );

  test.each([
    "https://machine.ts.net",
    "https://machine.ts.net/",
    "https://machine.ts.net:443/",
    "https://machine.ts.net:8443/",
    "http://machine.ts.net:80/",
    "http://machine.ts.net:1420",
  ])("appends the base path to the canonical origin of %s", (externalUrl) => {
    const urls = buildBrowserBackendUrl("/api", externalUrl, externalUrl, LOCALHOST, 14327);
    expect(urls.browserUrl).toBe(`${new URL(externalUrl).origin}/api`);
    expect(new URL(`${urls.browserUrl}/session`).pathname).toBe("/api/session");
    expect(urls.directUrl).toBe("http://127.0.0.1:14327");
  });

  test("normalizes the bind hostname for incoming Host checks", async () => {
    const bindHost = await Effect.runPromise(parseHostEffect("RUNNER.INTERNAL", "--host", true));
    expect(bindHost).toBe("runner.internal");
    expect(
      isRequestHostAllowed(
        new Request("http://runner.internal/", {
          headers: { host: "runner.internal" },
        }),
        allowedHostnamesFor({ bindHost, externalUrl: undefined }),
      ),
    ).toBe(true);
  });

  test.each(["runner:1420", "http://localhost", "localhost/path", "[invalid]", ""])(
    "rejects invalid programmatic bind %s before startup",
    async (host) => {
      await expect(
        Effect.runPromise(
          runLauncherEffect(
            {
              packageRoot: "/missing-package-root",
              workspaceMode: false,
              frontendPort: 0,
              backendPort: 0,
              host,
              externalUrl: "https://machine.ts.net",
            },
            testLogger,
          ),
        ),
      ).rejects.toThrow("Invalid --host value");
    },
  );

  test("derives the external backend URL from the external frontend URL and the bound host port", () => {
    expect(buildExternalBackendUrl("http://100.64.0.1:1420", 14327)).toBe(
      "http://100.64.0.1:14327",
    );
  });

  test("publishes a same-origin backend URL when a base path is configured", () => {
    expect(
      buildBrowserBackendUrl(
        "/api",
        "http://100.64.0.1:1420",
        "http://100.64.0.1:1420",
        "0.0.0.0",
        14327,
      ),
    ).toEqual({
      browserUrl: "http://100.64.0.1:1420/api",
      directUrl: "http://0.0.0.0:14327",
    });
    expect(
      buildBrowserBackendUrl(
        undefined,
        "http://100.64.0.1:1420",
        "http://100.64.0.1:1420",
        "0.0.0.0",
        14327,
      ),
    ).toEqual({
      browserUrl: "http://100.64.0.1:14327",
      directUrl: "http://0.0.0.0:14327",
    });
    expect(
      buildBrowserBackendUrl(undefined, "http://127.0.0.1:1420", undefined, "127.0.0.1", 14327),
    ).toEqual({
      browserUrl: "http://127.0.0.1:14327",
      directUrl: "http://127.0.0.1:14327",
    });
  });

  test("rejects static asset paths that escape the web shell root", () => {
    expect(resolveStaticAssetPath("/web-shell", "/assets/app.js")).toBe(
      path.join("/web-shell", "assets/app.js"),
    );
    expect(resolveStaticAssetPath("/web-shell", "/../secret.txt")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/foo/..")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/foo%2F..")).toBeNull();
  });

  test("rejects malformed and decoded control characters in static request paths", () => {
    expect(resolveStaticAssetPath("/web-shell", "/%E0%A4%A")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/%00")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/%0A")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/%C2%80")).toBeNull();
  });

  test("resolves static requests against the startup asset index", () => {
    const staticRoot = path.resolve("/web-shell");
    const indexPath = path.join(staticRoot, "index.html");
    const appPath = path.join(staticRoot, "assets/app.js");
    const assetPaths = new Set([indexPath, appPath]);

    expect(resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/")).toBe(indexPath);
    expect(resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/assets/app.js")).toBe(
      appPath,
    );
    expect(
      resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/missing.js"),
    ).toBeNull();
    expect(
      resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/missing%2Ejs"),
    ).toBeNull();
    expect(resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/%00")).toBeNull();
    expect(resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/tasks/example")).toBe(
      indexPath,
    );
    expect(
      resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/%2e%2e/secret.txt"),
    ).toBeNull();

    const traversalUrl = new URL("http://127.0.0.1/%2e%2e%2fsecret.txt");
    expect(
      resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, traversalUrl.pathname),
    ).toBeNull();
  });

  test("indexes nested web shell assets during startup", async () => {
    const staticRoot = await mkdtemp(path.join(os.tmpdir(), "openducktor-web-shell-"));
    const assetDirectory = path.join(staticRoot, "assets");
    const chunksDirectory = path.join(assetDirectory, "chunks");
    const indexPath = path.join(staticRoot, "index.html");
    const appPath = path.join(chunksDirectory, "app.js");

    try {
      await mkdir(chunksDirectory, { recursive: true });
      await Promise.all([writeFile(indexPath, "shell"), writeFile(appPath, "app")]);

      expect(await indexStaticAssetPaths(staticRoot)).toEqual(new Set([appPath, indexPath]));
    } finally {
      await rm(staticRoot, { force: true, recursive: true });
    }
  });
});
