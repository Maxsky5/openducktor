import type { IpcMain } from "electron";
import {
  remoteAccessEnableInputSchema,
  remotePairingStartInputSchema,
  remoteFailureText,
} from "@openducktor/contracts";
import { type RemoteAccessOperator } from "@openducktor/remote-host";
import { Effect } from "effect";
import { z } from "zod";
import { ELECTRON_REMOTE_ACCESS_CHANNEL } from "../shared/electron-bridge-contract";
type RemoteAccessFailure = { failure: { message: string; nextAction: string } };

/** Runs a remote access action and rejects with its message and next action. */
const run = <A>(effect: Effect.Effect<A, RemoteAccessFailure>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(Effect.mapError((cause) => new Error(remoteFailureText(cause.failure)))),
  );

const remoteAccessRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }),
  z.object({ action: z.literal("networks") }),
  z.object({ action: z.literal("disable") }),
  z.object({ action: z.literal("start-pairing"), input: remotePairingStartInputSchema }),
  z.object({ action: z.literal("stop-pairing") }),
  z.object({ action: z.literal("revoke"), clientId: z.uuid() }),
  z.object({ action: z.literal("enable"), input: remoteAccessEnableInputSchema }),
]);

/** The request that the preload bridge sends. The handler parses it before use. */
type RemoteAccessIpcRequest = z.input<typeof remoteAccessRequestSchema>;

export const registerElectronRemoteAccessIpc = (
  ipcMain: Pick<IpcMain, "handle">,
  controller: RemoteAccessOperator,
  isShutdown: () => boolean,
) => {
  // The host channel carries the live state, so this handler serves the operations only.
  ipcMain.handle(ELECTRON_REMOTE_ACCESS_CHANNEL, async (_event, raw: RemoteAccessIpcRequest) => {
    if (isShutdown())
      throw new Error("The host is shutting down. Reopen Electron to use remote access.");
    const request = remoteAccessRequestSchema.parse(raw);
    if (request.action === "revoke") return run(controller.revokeClient(request.clientId));
    if (request.action === "start-pairing") return run(controller.startPairing(request.input));
    if (request.action === "stop-pairing") return Effect.runPromise(controller.stopPairing());
    if (request.action === "networks") return run(controller.readNetworks());
    // A failed enable shows its failure in the state.
    if (request.action === "enable")
      return Effect.runPromise(
        controller.enable(request.input).pipe(Effect.catch(() => controller.readState())),
      );
    if (request.action === "disable") return Effect.runPromise(controller.disable());
    return Effect.runPromise(controller.readState());
  });
};
