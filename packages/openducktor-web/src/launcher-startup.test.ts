import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { runWebBoundary } from "./effect/web-errors";
import { runLauncherEffect, viteServerOptions } from "./launcher";
import * as support from "./launcher-support";
import * as backend from "./typescript-host-backend";

test("Vite accepts both external hostname forms and rejects unknown hosts", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
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
  });
  try {
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
  } finally {
    await server.close();
  }
}, 10_000);

test.each([
  { externalUrl: "https://machine.ts.net", basePath: undefined, failAdvisory: true, warns: false },
  { externalUrl: "https://machine.ts.net", basePath: undefined, failAdvisory: false, warns: true },
  { externalUrl: "http://localhost:1420", basePath: undefined, failAdvisory: false, warns: false },
  { externalUrl: "http://127.0.0.2:1420", basePath: undefined, failAdvisory: false, warns: false },
  { externalUrl: "https://machine.ts.net", basePath: "/api/", failAdvisory: false, warns: true },
])(
  "cleans up startup and reports remote access: %j",
  async ({ externalUrl, basePath, failAdvisory, warns }) => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "odt-launcher-startup-"));
    const messages: string[] = [];
    const loggingFailure = new Error("TLS advisory log failed");
    let hostStops = 0;
    const startHost = spyOn(backend, "startTypescriptHostBackendEffect").mockReturnValue(
      Effect.succeed({
        port: 23456,
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
            externalUrl,
            ...(basePath !== undefined && { basePath }),
          },
          {
            error: () => Effect.void,
            success: () => Effect.void,
            info: (message) => {
              messages.push(message);
              return failAdvisory && message.includes("Terminate TLS")
                ? Effect.fail(loggingFailure)
                : Effect.void;
            },
          },
        ),
      );
      if (failAdvisory) {
        await expect(result).rejects.toMatchObject({
          _tag: "WebResourceError",
          resource: "persistent-log",
          cause: loggingFailure,
        });
        expect(messages.some((message) => message.includes("https://machine.ts.net:23456"))).toBe(
          true,
        );
        expect(hostStops).toBe(1);
        expect(readiness).not.toHaveBeenCalled();
      } else {
        expect(await result).toBe(0);
      }
      expect(startHost).toHaveBeenCalledTimes(1);
      if (basePath !== undefined) {
        expect(startHost.mock.calls[0]?.[0].basePath).toBe("/api");
        expect(runtimeConfig.mock.calls[0]?.[0]).toBe(`${externalUrl}/api`);
      }
      expect(closeFrontend).toHaveBeenCalledTimes(1);
      expect(messages.some((message) => message.includes("proxy access controls"))).toBe(warns);
    } finally {
      startHost.mockRestore();
      readiness.mockRestore();
      closeFrontend.mockRestore();
      runtimeConfig.mockRestore();
      await rm(packageRoot, { recursive: true, force: true });
    }
  },
);
