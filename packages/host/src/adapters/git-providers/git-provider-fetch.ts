import { Effect } from "effect";

/** The fetch that REST provider adapters use. Electron passes `net.fetch`, which uses the OS trust store. */
export type GitProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Runs one provider request and its body read under one abort controller. Fetch resolves when the
 * headers arrive, so the caller keeps the controller through the body read. A deadline or an
 * interruption then aborts the request and cancels the response body instead of abandoning it.
 */
export const withAbortableResponse = <A, E>(
  fetchResponse: (signal: AbortSignal) => Effect.Effect<Response, E>,
  use: (response: Response) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const controller = new AbortController();
    let liveResponse: Response | undefined;
    return yield* Effect.acquireUseRelease(
      Effect.succeed(controller),
      (controller) =>
        Effect.gen(function* () {
          liveResponse = yield* fetchResponse(controller.signal);
          return yield* use(liveResponse);
        }),
      () =>
        Effect.sync(() => {
          controller.abort();
          // An in-flight read locks the body, so this fails there. The abort above closes the
          // request and errors that read.
          void liveResponse?.body?.cancel().catch(() => undefined);
        }),
    );
  });
