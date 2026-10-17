import { remoteAccessEnableInputSchema } from "@openducktor/contracts";
import type { RemoteAccessController } from "@openducktor/remote-host";
import { Effect, Fiber, Stream } from "effect";
export const handleRemoteAccessHttp = async (
  request: Request,
  controller: RemoteAccessController,
): Promise<Response> => {
  const route = new URL(request.url).pathname;
  if (route === "/remote-access/networks" && request.method === "GET") {
    const result = await Effect.runPromise(Effect.result(controller.readNetworks()));
    if (result._tag === "Failure")
      return new Response(
        `${result.failure.failure.message} ${result.failure.failure.nextAction}`,
        { status: 503 },
      );
    return Response.json(result.success, { headers: { "cache-control": "no-store" } });
  }
  if (route === "/remote-access/events" && request.method === "GET") {
    let delivery: Fiber.Fiber<void> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        const stop = () => {
          if (delivery) delivery.interruptUnsafe();
        };
        request.signal.addEventListener("abort", stop, { once: true });
        delivery = Effect.runFork(
          controller.states.pipe(
            Stream.runForEach((state) =>
              Effect.sync(() =>
                output.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(state)}\n\n`)),
              ),
            ),
            Effect.onExit(() =>
              Effect.sync(() => {
                request.signal.removeEventListener("abort", stop);
                try {
                  output.close();
                } catch {
                  /* Client already canceled. */
                }
              }),
            ),
          ),
        );
        if (request.signal.aborted) stop();
      },
      cancel() {
        delivery?.interruptUnsafe();
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
    });
  }
  if (request.method === "POST") {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return new Response("Use application/json.", { status: 400 });
    if (route === "/remote-access/enable")
      await Effect.runPromise(
        controller
          .enable(remoteAccessEnableInputSchema.parse(await request.json()))
          .pipe(Effect.catch(() => controller.readState())),
      );
    else if (route === "/remote-access/disable") await Effect.runPromise(controller.disable());
    else return new Response("Not found", { status: 404 });
  } else if (route !== "/remote-access" || request.method !== "GET")
    return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(await Effect.runPromise(controller.readState())), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
