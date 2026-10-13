import {
  REMOTE_CONNECTION_HEADER,
  REMOTE_TERMINAL_CONNECTION_PREFIX,
  remoteAccessEnableInputSchema,
  type RemoteAccessEnableInput,
  type RemoteAccessConfiguration,
  type RemoteAccessNetwork,
  type RemoteAccessState,
  type RemoteFailure,
} from "@openducktor/contracts";
import { createSerialLane } from "@openducktor/host";
import { Data, Effect, PubSub, Stream } from "effect";
import os from "node:os";
import { createRemoteWorkInterface, type RemoteHostServices } from "./remote-work-interface";
import { startNodeFetchServer, type NodeFetchServer } from "./node-fetch-server";
import {
  terminalWebSocketHandler,
  type TerminalWebSocketData,
} from "./terminals/terminal-websocket-handler";
import type { WebLogger } from "./logger";

export class RemoteAccessError extends Data.TaggedError("RemoteAccessError")<{
  readonly failure: RemoteFailure;
}> {}
export type RemoteAccessController = {
  readState(): Effect.Effect<RemoteAccessState>;
  readNetworks(): Effect.Effect<RemoteAccessNetwork[], RemoteAccessError>;
  enable(input: RemoteAccessEnableInput): Effect.Effect<RemoteAccessState, RemoteAccessError>;
  disable(): Effect.Effect<RemoteAccessState, RemoteAccessError>;
  readonly states: Stream.Stream<RemoteAccessState>;
  close(): Effect.Effect<void, RemoteAccessError>;
  handleSharedRequest(
    request: Request,
    server: NodeFetchServer<TerminalWebSocketData>,
  ): Promise<Response | undefined> | null;
};
/** Listener changes run in order so a late start cannot reopen disabled access. */
export const createRemoteAccessController = (
  services: RemoteHostServices,
  options: {
    shell: "electron" | "web";
    appVersion: string;
    frontendOrigins?: ReadonlySet<string>;
    logger: WebLogger;
    reportFailure(cause: unknown): void;
    sharedListener?: {
      listenHost: string;
      listenPort(): number;
      isPrivateRequest(request: Request): boolean;
    };
  },
): RemoteAccessController => {
  const changes = Effect.runSync(PubSub.sliding<RemoteAccessState>({ capacity: 16, replay: 1 }));
  const lane = createSerialLane();
  let state: RemoteAccessState = { status: "disabled", configuration: null };
  let server: NodeFetchServer<TerminalWebSocketData> | null = null;
  let work: ReturnType<typeof createRemoteWorkInterface> | null = null;
  let sharedWork: ReturnType<typeof createRemoteWorkInterface> | null = null;
  let closed = false;
  const publish = (next: RemoteAccessState) => {
    state = next;
    PubSub.publishUnsafe(changes, next);
    return next;
  };
  publish(state);
  const toFailure = (cause: unknown): RemoteAccessError =>
    new RemoteAccessError({
      failure: {
        code: "unavailable",
        message: `Remote access failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        nextAction:
          "Check the listening address and port, correct the endpoint, then enable remote access again.",
      },
    });
  const stop = (): Effect.Effect<void, RemoteAccessError> =>
    Effect.gen(function* () {
      work?.close();
      work = null;
      const previous = server;
      if (previous) {
        yield* Effect.tryPromise({ try: () => previous.stop(true), catch: toFailure });
        server = null;
      }
    });
  const disable = () =>
    lane.run(stop().pipe(Effect.map(() => publish({ status: "disabled", configuration: null }))));
  return {
    readState: () => Effect.sync(() => state),
    readNetworks: () =>
      Effect.try({
        try: () =>
          Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => {
            // IPv4 avoids scoped link-local URLs. Keep usable IPv6 for IPv6-only networks.
            const usable =
              entries?.filter(
                (entry) =>
                  !entry.internal &&
                  !entry.address.includes("%") &&
                  (entry.family === "IPv4" ||
                    (entry.family === "IPv6" &&
                      !/^fe[89ab]/i.test(entry.address) &&
                      entry.scopeid === 0)),
              ) ?? [];
            const addresses = usable.filter((entry) => entry.family === "IPv4");
            return (addresses.length ? addresses : usable).map(({ address }) => ({
              name,
              address,
            }));
          }),
        catch: (cause) =>
          new RemoteAccessError({
            failure: {
              code: "unavailable",
              message: `Could not read this computer's networks: ${cause instanceof Error ? cause.message : String(cause)}`,
              nextAction: "Check the computer's network connection, then refresh the network list.",
            },
          }),
      }),
    states: Stream.fromPubSub(changes),
    disable,
    enable: (input) =>
      lane.run(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const result = yield* Effect.result(
              Effect.gen(function* () {
                if (closed) return yield* toFailure(new Error("The shell host has stopped."));
                yield* stop();
                const parsed = yield* Effect.try({
                  try: () => remoteAccessEnableInputSchema.parse(input),
                  catch: (cause) =>
                    new RemoteAccessError({
                      failure: {
                        code: "invalid_endpoint",
                        message: cause instanceof Error ? cause.message : String(cause),
                        nextAction:
                          "Enter a reachable work endpoint and valid listening address and port.",
                      },
                    }),
                });
                publish({
                  status: "starting",
                  configuration:
                    parsed.publicEndpoint === undefined
                      ? null
                      : { ...parsed, publicEndpoint: parsed.publicEndpoint },
                });
                const configure = (port: number): RemoteAccessConfiguration => {
                  const host =
                    parsed.listenHost.includes(":") && !parsed.listenHost.startsWith("[")
                      ? `[${parsed.listenHost}]`
                      : parsed.listenHost;
                  return {
                    ...parsed,
                    publicEndpoint: parsed.publicEndpoint ?? `http://${host}:${port}`,
                  };
                };
                const openWork = (configuration: RemoteAccessConfiguration) => {
                  const current = createRemoteWorkInterface(services, {
                    ...options,
                    publicEndpoint: configuration.publicEndpoint,
                    listenHost: parsed.listenHost,
                    frontendOrigins: new Set([
                      ...(options.frontendOrigins ?? []),
                      ...(parsed.webOrigins ?? []),
                    ]),
                  });
                  work = current;
                  return current;
                };
                if (
                  options.sharedListener?.listenHost === parsed.listenHost &&
                  options.sharedListener.listenPort() === parsed.listenPort
                ) {
                  const configuration = configure(parsed.listenPort);
                  sharedWork = openWork(configuration);
                  return publish({ status: "available", configuration });
                }
                sharedWork = null;
                let current: ReturnType<typeof createRemoteWorkInterface>;
                server = yield* Effect.tryPromise({
                  try: () =>
                    startNodeFetchServer({
                      hostname: parsed.listenHost.replace(/^\[|\]$/g, ""),
                      port: parsed.listenPort,
                      fetch: (request, requestServer) => current.handle(request, requestServer),
                      onListening: (bound) => {
                        current = openWork(configure(bound.port));
                      },
                      websocket: terminalWebSocketHandler,
                      onListenerError: (cause) => {
                        options.reportFailure(cause);
                        if (work !== current) return;
                        current.close();
                        publish({
                          status: "failed",
                          configuration: state.configuration,
                          failure: toFailure(cause).failure,
                        });
                        void Effect.runPromise(lane.run(stop())).catch(options.reportFailure);
                      },
                      onError: (cause) => {
                        options.reportFailure(cause);
                      },
                    }),
                  catch: toFailure,
                });
                return publish({ status: "available", configuration: configure(server.port) });
              }),
            );
            if (result._tag === "Success") return result.success;
            yield* stop();
            publish({
              status: "failed",
              configuration: state.configuration,
              failure: result.failure.failure,
            });
            return yield* result.failure;
          }),
        ),
      ),
    close: () =>
      lane.run(
        Effect.gen(function* () {
          closed = true;
          yield* stop();
          publish({ status: "disabled", configuration: null });
          yield* PubSub.shutdown(changes);
        }),
      ),
    handleSharedRequest: (request, requestServer) => {
      if (!sharedWork || !options.sharedListener) return null;
      const explicitRemote =
        request.headers.has(REMOTE_CONNECTION_HEADER) ||
        request.headers.get("sec-websocket-protocol")?.includes(REMOTE_TERMINAL_CONNECTION_PREFIX);
      if (!explicitRemote && options.sharedListener.isPrivateRequest(request)) return null;
      return sharedWork.handle(request, requestServer);
    },
  };
};

/** Partial configuration is a visible remote failure, never an implicit local default. */
export const enableRemoteAccessFromEnvironment = (
  controller: RemoteAccessController,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<void> => {
  const host = environment.OPENDUCKTOR_REMOTE_HOST;
  const port = environment.OPENDUCKTOR_REMOTE_PORT;
  const endpoint = environment.OPENDUCKTOR_REMOTE_ENDPOINT;
  if (host === undefined && port === undefined && endpoint === undefined) return Effect.void;
  return controller
    .enable({
      listenHost: host ?? "",
      listenPort: port === undefined ? Number.NaN : Number(port),
      publicEndpoint: endpoint ?? "",
    })
    .pipe(
      Effect.asVoid,
      Effect.catch(() => Effect.void),
    );
};
