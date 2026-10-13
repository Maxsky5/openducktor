import type { IpcMain } from "electron";
import { remoteAccessEnableInputSchema } from "@openducktor/contracts";
import { type RemoteAccessController } from "@openducktor/remote-host";
import { Effect, Stream } from "effect";
import { z } from "zod";
import {
  ELECTRON_REMOTE_ACCESS_CHANNEL,
  ELECTRON_REMOTE_ACCESS_STATE_CHANNEL,
} from "../shared/electron-bridge-contract";
export const registerElectronRemoteAccessIpc = (
  ipcMain: IpcMain,
  controller: RemoteAccessController,
  isShutdown: () => boolean,
) => {
  const senders = new Set<Electron.WebContents>();
  ipcMain.handle(
    ELECTRON_REMOTE_ACCESS_CHANNEL,
    async (
      event,
      raw: {
        action: "read" | "networks" | "enable" | "disable";
        input?: import("@openducktor/contracts").RemoteAccessEnableInput;
      },
    ) => {
      if (isShutdown())
        throw new Error("The host is shutting down. Reopen Electron to use remote access.");
      if (!senders.has(event.sender)) {
        senders.add(event.sender);
        event.sender.once("destroyed", () => senders.delete(event.sender));
      }
      const request = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("read") }),
          z.object({ action: z.literal("networks") }),
          z.object({ action: z.literal("disable") }),
          z.object({ action: z.literal("enable"), input: remoteAccessEnableInputSchema }),
        ])
        .parse(raw);
      if (request.action === "networks")
        return Effect.runPromise(
          controller
            .readNetworks()
            .pipe(
              Effect.mapError(
                (cause) => new Error(`${cause.failure.message} ${cause.failure.nextAction}`),
              ),
            ),
        );
      if (request.action === "enable") {
        await Effect.runPromise(
          controller.enable(request.input).pipe(Effect.catch(() => controller.readState())),
        );
      } else if (request.action === "disable") await Effect.runPromise(controller.disable());
      return Effect.runPromise(controller.readState());
    },
  );
  return Effect.runFork(
    controller.states.pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          for (const sender of senders)
            if (!sender.isDestroyed()) sender.send(ELECTRON_REMOTE_ACCESS_STATE_CHANNEL, state);
        }),
      ),
    ),
  );
};
