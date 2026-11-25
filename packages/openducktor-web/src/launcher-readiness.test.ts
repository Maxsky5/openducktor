import { expect, test } from "bun:test";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { waitForBackendEffect } from "./launcher-support";

test.each([
  { failure: "health", message: "Health endpoint returned 503" },
  { failure: "session", message: "status 401" },
  { failure: "health-redirect", message: "fetch failed" },
  { failure: "session-redirect", message: "fetch failed" },
  { failure: "timeout", message: "aborted" },
  { failure: "refused", message: "fetch failed" },
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
    const deadlineMs = failure === "timeout" ? 150 : 1_050;
    try {
      const { error, elapsed } = await Effect.gen(function* () {
        const clock = yield* TestClock.make();
        // Real fetches signal when they finish. Advance only when the launcher asks to wait.
        const error = yield* waitForBackendEffect(url, "readiness-test-token", deadlineMs, {
          exited: new Promise(() => {}),
        }).pipe(Effect.flip, Effect.provideService(Clock.Clock, { ...clock, sleep: clock.adjust }));
        return { error, elapsed: clock.currentTimeMillisUnsafe() };
      }).pipe(Effect.scoped, Effect.runPromise);
      expect(elapsed).toBe(deadlineMs);
      expect(error).toMatchObject({
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
