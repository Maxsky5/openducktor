import { remoteAccessFixture } from "./remote-access-test-fixture";
import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OPENDUCKTOR_DEV_INSTANCE_ENV } from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { runWebBoundary } from "@openducktor/remote-host/effect/web-errors";
import { RemoteAccessError } from "@openducktor/remote-host/remote-access-controller";
import { runLauncherEffect, viteServerOptions } from "./launcher";
import * as nodeServer from "@openducktor/remote-host/node-fetch-server";
import * as support from "./launcher-support";
import * as backend from "./typescript-host-backend";
import { withViteTestServer } from "./vite-test-server";
import * as discovery from "./web-tool-discovery";

test.each([
  ["0.0.0.0", "http://192.168.1.9:1420"],
  ["127.0.0.1", "http://host.example"],
  ["::", "http://[fd00::2]:1420"],
  ["127.0.0.1", "http://[::ffff:100.64.0.1]:1420"],
])(
  "rejects insecure network browser origin %s %s before discovery or binds",
  async (host, externalUrl) => {
    const discover = spyOn(discovery, "resolveWebProvidedToolPathsEffect");
    const serve = spyOn(nodeServer, "startNodeFetchServer");
    try {
      const result = await Effect.runPromise(
        Effect.result(
          runLauncherEffect(
            {
              packageRoot: "/missing-web-package",
              workspaceMode: false,
              frontendPort: 0,
              backendPort: 0,
              host,
              externalUrl,
            },
            { error: () => Effect.void, info: () => Effect.void, success: () => Effect.void },
          ),
        ),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure")
        expect(result.failure).toMatchObject({
          _tag: "WebValidationError",
          field: "externalUrl",
          message: expect.stringContaining("Network browser pages require HTTPS"),
        });
      expect(discover).not.toHaveBeenCalled();
      expect(serve).not.toHaveBeenCalled();
    } finally {
      discover.mockRestore();
      serve.mockRestore();
    }
  },
);

test.each(["", " \t\n "])(
  "rejects blank external URL %j before discovery or binds",
  async (externalUrl) => {
    const discover = spyOn(discovery, "resolveWebProvidedToolPathsEffect");
    const serve = spyOn(nodeServer, "startNodeFetchServer");
    try {
      await expect(
        runWebBoundary(
          runLauncherEffect(
            {
              packageRoot: "/missing-web-package",
              workspaceMode: false,
              frontendPort: 0,
              backendPort: 0,
              externalUrl,
            },
            { error: () => Effect.void, info: () => Effect.void, success: () => Effect.void },
          ),
        ),
      ).rejects.toMatchObject({ _tag: "WebValidationError", field: "externalUrl" });
      expect(discover).not.toHaveBeenCalled();
      expect(serve).not.toHaveBeenCalled();
    } finally {
      discover.mockRestore();
      serve.mockRestore();
    }
  },
);

test.each([false, true])(
  "rejects invalid settings before starting services in workspace mode %s",
  async (workspaceMode) => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "odt-launcher-settings-"));
    const previousConfigDir = process.env.OPENDUCKTOR_CONFIG_DIR;
    const startHost = spyOn(backend, "startTypescriptHostBackendEffect");
    const serve = spyOn(nodeServer, "startNodeFetchServer");
    const messages: string[] = [];
    try {
      const configPath = path.join(configDir, "config.json");
      const payload = JSON.stringify({ version: 4, theme: "blue" });
      await writeFile(configPath, payload);
      process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
      const options = workspaceMode
        ? {
            packageRoot: "/missing-web-package",
            workspaceMode: true as const,
            workspaceRoot: "/missing-workspace",
            developmentInstanceId: "browser-test",
            frontendPort: 0,
            backendPort: 0,
          }
        : {
            packageRoot: "/missing-web-package",
            workspaceMode: false as const,
            frontendPort: 0,
            backendPort: 0,
          };

      await expect(
        runWebBoundary(
          runLauncherEffect(options, {
            error: () => Effect.void,
            info: (message) => Effect.sync(() => messages.push(message)),
            success: (message) => Effect.sync(() => messages.push(message)),
          }),
        ),
      ).rejects.toMatchObject({
        operation: "web.launcher.check-settings",
        message: expect.stringContaining(`Invalid config file ${configPath}:`),
      });
      expect(startHost).not.toHaveBeenCalled();
      expect(serve).not.toHaveBeenCalled();
      expect(messages).not.toContain("OpenDucktor web is ready:");
      expect(await Bun.file(configPath).text()).toBe(payload);
    } finally {
      if (previousConfigDir === undefined) delete process.env.OPENDUCKTOR_CONFIG_DIR;
      else process.env.OPENDUCKTOR_CONFIG_DIR = previousConfigDir;
      startHost.mockRestore();
      serve.mockRestore();
      await rm(configDir, { recursive: true, force: true });
    }
  },
);

test.each(["/session", "/health", "/invoke", "/task-events/subscriptions", "/task-assets/w/t"])(
  "rejects conflicting base path %s before discovery or binds",
  async (basePath) => {
    const discover = spyOn(discovery, "resolveWebProvidedToolPathsEffect");
    const serve = spyOn(nodeServer, "startNodeFetchServer");
    try {
      await expect(
        runWebBoundary(
          runLauncherEffect(
            {
              packageRoot: "/missing-web-package",
              workspaceMode: false,
              frontendPort: 0,
              backendPort: 0,
              externalUrl: "https://machine.ts.net",
              basePath,
            },
            { error: () => Effect.void, info: () => Effect.void, success: () => Effect.void },
          ),
        ),
      ).rejects.toMatchObject({
        _tag: "WebValidationError",
        field: "--base-path",
        message: expect.stringContaining("Use /api or another nonconflicting path"),
      });
      expect(discover).not.toHaveBeenCalled();
      expect(serve).not.toHaveBeenCalled();
    } finally {
      discover.mockRestore();
      serve.mockRestore();
    }
  },
);

test("Vite accepts both external hostname forms and rejects unknown hosts", async () => {
  await withViteTestServer(
    {
      server: viteServerOptions({
        packageRoot: process.cwd(),
        workspaceMode: false,
        frontendPort: 0,
        backendPort: 0,
        externalUrl: "https://machine.ts.net.",
      }),
      plugins: [
        {
          name: "test-host-response",
          configureServer(vite) {
            return () => vite.middlewares.use((_request, response) => response.end("allowed"));
          },
        },
      ],
    },
    async (server) => {
      await server.listen();
      const address = z.object({ port: z.number() }).parse(server.httpServer?.address());
      for (const host of [
        "machine.ts.net",
        "machine.ts.net.",
        "unknown.example",
        "sub.machine.ts.net",
      ]) {
        const response = await fetch(`http://127.0.0.1:${address.port}/`, { headers: { host } });
        expect(response.status).toBe(host.startsWith("machine.ts.net") ? 200 : 403);
        await response.text();
      }
    },
  );
}, 10_000);

// Valid setups start and stop a real frontend HTTP server.
test.each([
  { externalUrl: undefined, basePath: undefined, failAdvisory: false, warns: false },
  {
    externalUrl: undefined,
    basePath: undefined,
    failAdvisory: false,
    warns: false,
    remoteStartup: true,
  },
  {
    externalUrl: undefined,
    basePath: undefined,
    failAdvisory: false,
    warns: false,
    remoteStartup: true,
    cliRemotePort: 14328,
    cliRemoteEndpoint: "http://cli.test:14328/work",
  },
  {
    externalUrl: "https://machine.ts.net",
    basePath: undefined,
    failAdvisory: false,
    warns: true,
    remoteStartup: true,
    cliRemotePort: 14328,
    cliRemoteEndpoint: "https://cli.test/work",
  },
  {
    externalUrl: "https://machine.ts.net",
    basePath: undefined,
    failAdvisory: false,
    warns: false,
    remoteStartup: true,
    cliRemotePort: 14328,
    cliRemoteEndpoint: "http://cli.test:14328/work",
    rejectEndpoint: true,
  },
  {
    externalUrl: "https://machine.ts.net",
    basePath: undefined,
    failAdvisory: false,
    warns: false,
    remoteStartup: true,
    rejectEndpoint: true,
  },
  {
    externalUrl: " https://machine.ts.net ",
    basePath: undefined,
    failAdvisory: false,
    warns: true,
  },
  { externalUrl: "https://machine.ts.net", basePath: undefined, failAdvisory: true, warns: false },
  {
    externalUrl: "https://machine.ts.net",
    basePath: undefined,
    failAdvisory: false,
    warns: false,
    failRemote: true,
  },
  { externalUrl: "https://machine.ts.net", basePath: undefined, failAdvisory: false, warns: true },
  { externalUrl: "http://localhost:1420", basePath: undefined, failAdvisory: false, warns: false },
  { externalUrl: "http://127.0.0.2:1420", basePath: undefined, failAdvisory: false, warns: false },
  { externalUrl: "https://machine.ts.net", basePath: "/api/", failAdvisory: false, warns: true },
  { externalUrl: "https://machine.ts.net/", basePath: "/api/", failAdvisory: false, warns: true },
  {
    externalUrl: "https://machine.ts.net:443/",
    basePath: "/api",
    failAdvisory: false,
    warns: true,
  },
  {
    externalUrl: "https://machine.ts.net:8443/",
    basePath: "/api",
    failAdvisory: false,
    warns: true,
  },
])(
  "cleans up startup and reports remote access: %j",
  async ({
    externalUrl,
    basePath,
    failAdvisory,
    failRemote,
    warns,
    remoteStartup,
    cliRemotePort,
    cliRemoteEndpoint,
    rejectEndpoint,
  }) => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "odt-launcher-startup-"));
    const messages: string[] = [];
    const loggingFailure = new Error("TLS advisory log failed");
    const remoteAccess = remoteAccessFixture();
    const enable = spyOn(remoteAccess, "enable");
    const remoteFailure = new RemoteAccessError({
      failure: {
        code: "unavailable",
        message: "The remote listener port is in use.",
        nextAction: "Choose another listening port.",
      },
    });
    if (failRemote) enable.mockReturnValue(Effect.fail(remoteFailure));
    const remoteEnvironment = {
      OPENDUCKTOR_REMOTE_HOST: "0.0.0.0",
      OPENDUCKTOR_REMOTE_PORT: "14329",
      OPENDUCKTOR_REMOTE_ENDPOINT: "http://machine.test:14329/remote",
    };
    const previousEnvironment = Object.fromEntries(
      Object.keys(remoteEnvironment).map((key) => [key, process.env[key]]),
    );
    let hostStops = 0;
    const startHost = spyOn(backend, "startTypescriptHostBackendEffect").mockReturnValue(
      Effect.succeed({
        port: 23456,
        remoteAccess,
        exited: Promise.resolve(0),
        stop: async () => {
          hostStops += 1;
        },
      }),
    );
    const readiness = spyOn(support, "waitForBackendEffect").mockReturnValue(Effect.void);
    const closeFrontend = spyOn(support, "closeFrontendServerEffect");
    const runtimeConfig = spyOn(support, "buildBrowserRuntimeConfigJson");
    try {
      if (remoteStartup) Object.assign(process.env, remoteEnvironment);
      await mkdir(path.join(packageRoot, "dist/web-shell"), { recursive: true });
      await writeFile(path.join(packageRoot, "dist/web-shell/index.html"), "<html></html>");
      const result = runWebBoundary(
        runLauncherEffect(
          {
            packageRoot,
            workspaceMode: false,
            frontendPort: 0,
            backendPort: 0,
            host: "127.0.0.1",
            remotePort: cliRemotePort ?? (remoteStartup ? 0 : 14328),
            ...(cliRemoteEndpoint !== undefined && { remoteEndpoint: cliRemoteEndpoint }),
            ...(externalUrl !== undefined && { externalUrl }),
            ...(basePath !== undefined && { basePath }),
          },
          {
            error: () => Effect.void,
            success: (message) => Effect.sync(() => messages.push(message)),
            info: (message) => {
              messages.push(message);
              return failAdvisory && message.includes("Terminate TLS")
                ? Effect.fail(loggingFailure)
                : Effect.void;
            },
          },
        ),
      );
      if (rejectEndpoint) {
        const failure = await result.catch((cause: unknown) => cause);
        expect(failure).toMatchObject({
          _tag: "WebValidationError",
          field: "remoteEndpoint",
          message: expect.stringContaining("HTTPS"),
        });
        expect(startHost).not.toHaveBeenCalled();
        expect(enable).not.toHaveBeenCalled();
        expect(readiness).not.toHaveBeenCalled();
        expect(closeFrontend).not.toHaveBeenCalled();
        expect(messages).not.toContain("OpenDucktor web is ready:");
        return;
      }
      if (failRemote) {
        await expect(result).rejects.toMatchObject({
          _tag: "WebDependencyError",
          dependency: "remote-listener",
          message: "The remote listener port is in use. Choose another listening port.",
          cause: remoteFailure,
        });
        expect(hostStops).toBe(1);
        expect(readiness).not.toHaveBeenCalled();
        expect(messages).not.toContain("OpenDucktor web is ready:");
      } else if (failAdvisory) {
        await expect(result).rejects.toMatchObject({
          _tag: "WebResourceError",
          resource: "persistent-log",
          cause: loggingFailure,
        });
        expect(messages.some((message) => message.includes("https://machine.ts.net:14328"))).toBe(
          true,
        );
        expect(hostStops).toBe(1);
        expect(readiness).not.toHaveBeenCalled();
      } else {
        expect(await result).toBe(0);
      }
      expect(startHost).toHaveBeenCalledTimes(1);
      if (remoteStartup)
        expect(enable.mock.calls[0]?.[0]).toEqual({
          listenHost: "127.0.0.1",
          listenPort: cliRemotePort ?? 23456,
          publicEndpoint: cliRemoteEndpoint ?? "http://machine.test:14329/remote",
        });
      const hostOptions = startHost.mock.calls[0]?.[0];
      expect(hostOptions?.processEnv).not.toBe(process.env);
      expect(hostOptions?.processEnv?.[OPENDUCKTOR_DEV_INSTANCE_ENV]).toBeUndefined();
      if (externalUrl !== undefined) {
        if (new URL(externalUrl).hostname === "machine.ts.net") {
          expect(hostOptions?.frontendOrigin).toStartWith("http://127.0.0.1:");
          expect(hostOptions?.remoteFrontendOrigin).toBe(externalUrl.trim());
        } else expect(hostOptions?.frontendOrigin).toBe(externalUrl.trim());
      }
      if (basePath !== undefined && externalUrl !== undefined) {
        expect(startHost.mock.calls[0]?.[0].basePath).toBeUndefined();
        expect(startHost.mock.calls[0]?.[0].host).toBe("127.0.0.1");
        expect(runtimeConfig.mock.calls[0]?.[0]).toBe("http://127.0.0.1:23456");
      }
      expect(closeFrontend).toHaveBeenCalledTimes(1);
      expect(messages.some((message) => message.includes("proxy access controls"))).toBe(warns);
    } finally {
      if (remoteStartup)
        for (const [key, value] of Object.entries(previousEnvironment)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      enable.mockRestore();
      startHost.mockRestore();
      readiness.mockRestore();
      closeFrontend.mockRestore();
      runtimeConfig.mockRestore();
      await rm(packageRoot, { recursive: true, force: true });
    }
  },
  3_000,
);

// Each host spelling passes through a real frontend HTTP server.
test.each([
  ["LOCALHOST", "localhost"],
  ["[0:0:0:0:0:0:0:1]", "[::1]"],
  ["0:0:0:0:0:0:0:1", "[::1]"],
  ["::", "[::]"],
  ["::ffff:127.0.0.1", "[::ffff:7f00:1]"],
  ["RUNNER.INTERNAL", "runner.internal"],
])(
  "normalizes %s at both server boundaries",
  async (host, normalizedHost) => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "odt-launcher-host-"));
    const serve = nodeServer.startNodeFetchServer;
    const frontend = spyOn(nodeServer, "startNodeFetchServer").mockImplementation((options) =>
      serve({ ...options, hostname: "127.0.0.1" }),
    );
    const startHost = spyOn(backend, "startTypescriptHostBackendEffect").mockReturnValue(
      Effect.succeed({
        remoteAccess: remoteAccessFixture(),
        port: 23456,
        exited: Promise.resolve(0),
        stop: async () => {},
      }),
    );
    const readiness = spyOn(support, "waitForBackendEffect").mockReturnValue(Effect.void);
    try {
      await mkdir(path.join(packageRoot, "dist/web-shell"), { recursive: true });
      await writeFile(path.join(packageRoot, "dist/web-shell/index.html"), "<html></html>");
      expect(
        await runWebBoundary(
          runLauncherEffect(
            {
              packageRoot,
              workspaceMode: false,
              frontendPort: 0,
              backendPort: 0,
              host,
              ...(["::", "RUNNER.INTERNAL"].includes(host) && {
                externalUrl: "https://machine.ts.net",
              }),
            },
            { error: () => Effect.void, success: () => Effect.void, info: () => Effect.void },
          ),
        ),
      ).toBe(0);
      expect(frontend.mock.calls[0]?.[0].hostname).toBe(normalizedHost);
      expect(startHost.mock.calls[0]?.[0].host).toBe(
        ["::", "RUNNER.INTERNAL"].includes(host) ? "127.0.0.1" : normalizedHost,
      );
    } finally {
      frontend.mockRestore();
      startHost.mockRestore();
      readiness.mockRestore();
      await rm(packageRoot, { recursive: true, force: true });
    }
  },
  3_000,
);
