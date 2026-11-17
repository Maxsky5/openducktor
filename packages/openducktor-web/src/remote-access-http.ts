import {
  remoteAccessEnableInputSchema,
  remotePairingStartInputSchema,
  remoteFailureText,
} from "@openducktor/contracts";
import type { RemoteAccessOperator } from "@openducktor/remote-host";
import { z } from "zod";
import { Effect } from "effect";
import { REMOTE_ACCESS_PATH } from "./remote-access-path";

const clientIdSchema = z.uuid();
const NO_STORE = { headers: { "cache-control": "no-store" } };
const REVOKE_CLIENT_PATH = new RegExp(`^${REMOTE_ACCESS_PATH}/clients/([^/]+)/revoke$`);

type RemoteAccessFailure = { failure: { message: string; nextAction: string } };

/** Runs a remote access action: JSON on success, its message and next action on failure. */
const respond = async <A>(
  effect: Effect.Effect<A, RemoteAccessFailure>,
  failureStatus: number,
): Promise<Response> => {
  const result = await Effect.runPromise(Effect.result(effect));
  if (result._tag === "Failure")
    return new Response(remoteFailureText(result.failure.failure), {
      status: failureStatus,
    });
  return Response.json(result.success, NO_STORE);
};

export const handleRemoteAccessHttp = async (
  request: Request,
  controller: RemoteAccessOperator,
): Promise<Response> => {
  const route = new URL(request.url).pathname;
  if (route === `${REMOTE_ACCESS_PATH}/networks` && request.method === "GET")
    return respond(controller.readNetworks(), 503);
  if (request.method === "POST") {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return new Response("Use application/json.", { status: 400 });
    const revoke = REVOKE_CLIENT_PATH.exec(route);
    if (revoke) {
      const client = clientIdSchema.safeParse(revoke[1]);
      if (!client.success) return new Response("Invalid client reference.", { status: 400 });
      return respond(controller.revokeClient(client.data), 503);
    }
    if (route === `${REMOTE_ACCESS_PATH}/pairing/start`) {
      return respond(
        controller.startPairing(remotePairingStartInputSchema.parse(await request.json())),
        409,
      );
    }
    if (route === `${REMOTE_ACCESS_PATH}/pairing/stop`)
      return Response.json(await Effect.runPromise(controller.stopPairing()), NO_STORE);
    // A failed enable shows its failure in the state.
    if (route === `${REMOTE_ACCESS_PATH}/enable`)
      return Response.json(
        await Effect.runPromise(
          controller
            .enable(remoteAccessEnableInputSchema.parse(await request.json()))
            .pipe(Effect.catch(() => controller.readState())),
        ),
        NO_STORE,
      );
    if (route === `${REMOTE_ACCESS_PATH}/disable`)
      return Response.json(await Effect.runPromise(controller.disable()), NO_STORE);
    return new Response("Not found", { status: 404 });
  } else if (route !== REMOTE_ACCESS_PATH || request.method !== "GET")
    return new Response("Not found", { status: 404 });
  return Response.json(await Effect.runPromise(controller.readState()), NO_STORE);
};
