import { Effect, Fiber, type Result } from "effect";
import { TestClock } from "effect/testing";
import type { HostError } from "../../effect/host-errors";
import type { GitProviderFetch } from "./git-provider-fetch";

const encoder = new TextEncoder();

type StalledProviderResponse = {
  /** The fetch to inject. It sends every request to a disposable loopback server. */
  fetch: GitProviderFetch;
  /** Resolves when the adapter starts to read the response body. */
  bodyReadStarted: Promise<void>;
  /** The abort signal of the request, or undefined when fetch receives no signal. */
  requestSignal: Promise<AbortSignal | undefined>;
  /** Resolves when the server closes the response, or the client aborts its request. */
  responseClosed: Promise<void>;
  close(): Promise<void>;
};

/**
 * Serves one response that sends its status and first body byte, then stalls for as long as the
 * client reads. The returned fetch reports when the adapter starts the body read, and it records
 * the request signal and the end of the server response, so a test can check that a deadline or
 * an interruption closes the complete exchange.
 */
export const createStalledProviderResponse = (status = 200): StalledProviderResponse => {
  const bodyReadStarted = Promise.withResolvers<void>();
  const requestSignal = Promise.withResolvers<AbortSignal | undefined>();
  const responseClosed = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      request.signal.addEventListener("abort", () => responseClosed.resolve(), { once: true });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("{"));
          },
          cancel() {
            responseClosed.resolve();
          },
        }),
        { status, headers: { "content-type": "application/json" } },
      );
    },
  });
  const fetchImplementation: GitProviderFetch = async (_input, init) => {
    requestSignal.resolve(init?.signal ?? undefined);
    const response = await fetch(server.url, init);
    if (response.body === null) return response;
    const reader = response.body.getReader();
    const stalled = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          bodyReadStarted.resolve();
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel: (reason) => reader.cancel(reason),
      },
      // No buffer, so the first pull waits for the first read instead of running at construction.
      { highWaterMark: 0 },
    );
    return new Response(stalled, { status: response.status, headers: response.headers });
  };
  return {
    fetch: fetchImplementation,
    bodyReadStarted: bodyReadStarted.promise,
    requestSignal: requestSignal.promise,
    responseClosed: responseClosed.promise,
    close: () => server.stop(true),
  };
};

/** Forks a request, waits until the adapter reads the stalled body, then advances past the deadline. */
export const timeoutStalledRequest = (
  probe: StalledProviderResponse,
  request: Effect.Effect<unknown, HostError>,
): Promise<Result.Result<unknown, HostError>> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.result(request));
      yield* Effect.promise(() => probe.bodyReadStarted);
      yield* TestClock.adjust("31 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );

/** Forks a request, waits until the adapter reads the stalled body, then interrupts it. */
export const interruptStalledRequest = (
  probe: StalledProviderResponse,
  request: Effect.Effect<unknown, HostError>,
): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(request);
      yield* Effect.promise(() => probe.bodyReadStarted);
      yield* Fiber.interrupt(fiber);
    }),
  );
