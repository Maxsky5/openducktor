import type { ModelRef, OpenCodeClient } from "@opencode/client";
import { operationError, type OperationIdentity } from "./opencode-client";

/** How long a generation waits for its model to load. */
const MODEL_LOAD_TIMEOUT_MS = 30_000;

/**
 * Waits for the model of a `generate.*` request. OpenCode runs these requests in the location of
 * its global config directory (`packages/server/src/handlers/generate.ts`). It loads its model
 * catalog with plugins after a location starts, and since OpenCode 2.4.0 no request waits for them.
 * That location also stops after an idle time, so it often starts again for a generation.
 */
export const createOpenCodeGenerationModels = ({
  client,
  globalConfigDirectory,
  isClosed,
}: {
  readonly client: () => OpenCodeClient;
  readonly globalConfigDirectory: string;
  /** Tells if the runtime connection was released or closed. */
  readonly isClosed: () => boolean;
}) => {
  /** The waits for a model change, by the canonical directory of their location. */
  const waits = new Map<() => void, string>();
  let version = 0;

  const changed = (directory?: string) => {
    version++;
    for (const [wake, waiting] of waits)
      if (directory === undefined || directory === waiting) wake();
  };

  const waitForChange = (
    identity: OperationIdentity,
    model: ModelRef,
    directory: string,
    deadline: number,
    signal: AbortSignal,
  ) =>
    new Promise<void>((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        waits.delete(wake);
      };
      const wake = () => {
        stop();
        resolve();
      };
      const cancel = () => {
        stop();
        reject(signal.reason);
      };
      const timer = setTimeout(
        () => {
          stop();
          reject(
            operationError(
              identity,
              "generate text",
              "runtime_unavailable",
              `OpenCode did not load the model '${model.providerID}/${model.id}' within ${MODEL_LOAD_TIMEOUT_MS / 1_000} seconds.`,
              "Connect the model provider in OpenCode, or select another model.",
            ),
          );
        },
        Math.max(0, deadline - Date.now()),
      );
      waits.set(wake, directory);
      signal.addEventListener("abort", cancel, { once: true });
    });

  return {
    /** Resolves when the generation location has loaded and enabled `model`. */
    awaitModel: async (
      identity: OperationIdentity,
      model: ModelRef,
      signal: AbortSignal,
    ): Promise<void> => {
      const location = { directory: globalConfigDirectory };
      const deadline = Date.now() + MODEL_LOAD_TIMEOUT_MS;
      while (!isClosed()) {
        signal.throwIfAborted();
        const seen = version;
        const models = await client().model.list({ location }, { signal });
        if (
          models.data.some(
            (item) => item.providerID === model.providerID && item.id === model.id && item.enabled,
          )
        )
          return;
        if (seen !== version) continue;
        // OpenCode names the location by its canonical directory in the answer and in its events.
        await waitForChange(identity, model, models.location.directory, deadline, signal);
      }
      throw operationError(
        identity,
        "generate text",
        "runtime_unavailable",
        "The owned runtime connection closed.",
      );
    },
    /** OpenCode changed the models of the location of `directory`. */
    modelsChanged: (directory: string): void => changed(directory),
    /** Ends every wait, because the runtime connection closed. */
    close: (): void => changed(),
  };
};
