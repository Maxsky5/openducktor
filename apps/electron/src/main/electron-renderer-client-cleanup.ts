import type { Effect } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { runElectronMainTask } from "./electron-main-task-owner";

/**
 * The renderer `webContents` events that end the IPC clients of the renderer. `did-navigate`
 * comes only when the main frame commits a new document. A navigation can start and then stop,
 * for example when the window refuses it in `will-navigate`, and the old document then keeps
 * running with its clients.
 */
export type ElectronRendererLifecycle = {
  readonly id: number;
  on(event: "did-navigate", listener: () => void): void;
  once(event: "destroyed", listener: () => void): void;
};

/**
 * Returns a function that binds the client cleanup of a renderer one time. The clients of a
 * renderer end when its main frame loads a new document and when the renderer is destroyed.
 */
export const createRendererClientCleanup = (input: {
  detachSender(senderId: number): Effect.Effect<void, Error>;
  /** Runs before the detach of a destroyed renderer. */
  onDestroyed?(senderId: number): void;
  reportFailure(senderId: number, cause: unknown): void;
}) => {
  const boundSenders = new WeakSet<ElectronRendererLifecycle>();
  return (sender: ElectronRendererLifecycle): void => {
    if (boundSenders.has(sender)) return;
    boundSenders.add(sender);
    const senderId = sender.id;
    const detach = () =>
      runElectronMainTask(
        () => runElectronEffect(input.detachSender(senderId)),
        (cause) => input.reportFailure(senderId, cause),
      );
    sender.once("destroyed", () => {
      input.onDestroyed?.(senderId);
      detach();
    });
    // A new document ends the clients of the old document.
    sender.on("did-navigate", detach);
  };
};
