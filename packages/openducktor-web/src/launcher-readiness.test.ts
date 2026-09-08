import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { waitForBackend } from "./launcher-support";

test.each(["waitForBackend", "waitForBackendEffect"])(
  "%s uses direct readiness transport despite environment proxies",
  async (entryPoint) => {
    const requests: Array<{ path: string; method: string; token: string | null }> = [];
    const backend = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push({
          path: new URL(request.url).pathname,
          method: request.method,
          token: request.headers.get("x-openducktor-app-token"),
        });
        return new Response("ready");
      },
    });
    const proxyRequests: string[] = [];
    const proxy = createServer((request, response) => {
      proxyRequests.push(request.url ?? "");
      response.end("proxy success");
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = z.object({ port: z.number() }).parse(proxy.address());
    const proxyUrl = `http://127.0.0.1:${address.port}`;
    const child = Bun.spawn({
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      cmd: [
        process.execPath,
        "--eval",
        `import { Effect } from "effect";
         import { ${entryPoint} } from ${JSON.stringify(new URL("./launcher-support.ts", import.meta.url).href)};
         const control = await fetch("http://proxy-check.invalid/", { signal: AbortSignal.timeout(2000) });
         const body = await control.text();
         if (body !== "proxy success") throw new Error("Proxy control failed: " + body);
         const result = ${entryPoint}("http://127.0.0.1:${backend.port}", "readiness-test-token", 2000, { exited: new Promise(() => {}) });
         await ${entryPoint === "waitForBackendEffect" ? "Effect.runPromise(result)" : "result"};`,
      ],
      env: {
        ...process.env,
        HTTP_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        https_proxy: proxyUrl,
        ALL_PROXY: proxyUrl,
        all_proxy: proxyUrl,
        NO_PROXY: "unrelated.invalid",
        no_proxy: "unrelated.invalid",
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
      expect(proxyRequests).toEqual(["http://proxy-check.invalid/"]);
      expect(requests).toEqual([
        { path: "/health", method: "GET", token: null },
        { path: "/session", method: "POST", token: "readiness-test-token" },
      ]);
    } finally {
      child.kill();
      await child.exited;
      backend.stop(true);
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  10_000,
);

test.each([
  { failure: "health", message: "Health endpoint returned 503" },
  { failure: "session", message: "status 401" },
  { failure: "health-redirect", message: "fetch failed" },
  { failure: "session-redirect", message: "fetch failed" },
  { failure: "refused", message: "fetch failed" },
  { failure: "timeout", message: "aborted" },
])(
  "direct readiness rejects $failure",
  async ({ failure, message }) => {
    const paths: string[] = [];
    const backend = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        paths.push(pathname);
        if (failure === "timeout") return new Promise<Response>(() => {});
        if (failure === `${pathname.slice(1)}-redirect`) {
          return new Response(null, { status: 307, headers: { location: "/redirected" } });
        }
        return new Response("readiness", {
          status:
            failure === "health" && pathname === "/health"
              ? 503
              : failure === "session" && pathname === "/session"
                ? 401
                : 200,
        });
      },
    });
    const url = `http://127.0.0.1:${backend.port}`;
    if (failure === "refused") await backend.stop(true);
    try {
      await expect(
        waitForBackend(url, "readiness-test-token", 150, { exited: new Promise(() => {}) }),
      ).rejects.toMatchObject({
        _tag: "WebOperationError",
        message: expect.stringContaining(message),
      });
      expect(paths).not.toContain("/redirected");
      if (failure.startsWith("health")) expect(paths).not.toContain("/session");
    } finally {
      if (failure !== "refused") await backend.stop(true);
    }
  },
  5_000,
);
