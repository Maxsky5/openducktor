import type { taskMetadataArtifactSchema, taskMetadataPayloadSchema } from "@openducktor/contracts";
import { createHostClient, type HostClient, HostInvokeError } from "@openducktor/host-client";
import type { z } from "zod";

type HostMethod = keyof HostClient;

/**
 * The results that the client changes after it reads them from the host. The handlers of these
 * methods return the host result, as a host does.
 */
export type DemoHostResults = {
  workflowArtifactGet: z.input<typeof taskMetadataArtifactSchema>;
  taskMetadataGet: z.input<typeof taskMetadataPayloadSchema>;
  /** The host answers whether it removed a link. */
  taskPullRequestUnlink: boolean;
};

/** The host commands that the demo answers on the device, by host client method. */
export type DemoHandlers = {
  [Method in HostMethod]?: Method extends keyof DemoHostResults
    ? (...args: Parameters<HostClient[Method]>) => Promise<DemoHostResults[Method]>
    : HostClient[Method];
};

/** A host client method without its own argument types, so that one wrapper can forward any call. */
type ForwardedMethod = (...args: unknown[]) => ReturnType<HostClient[HostMethod]>;

/** A demo handler without its own types. The result schema of its command checks its result. */
type ErasedHandler = (...args: unknown[]) => ReturnType<NonNullable<DemoHandlers[HostMethod]>>;

type MethodCall = { method: HostMethod; args: unknown[] };

/**
 * The cleanup commands that the connection sends while it closes, after the demo ended and before
 * the backend is disposed.
 */
const CLEANUP_METHODS = new Set<HostMethod>(["taskAssetDiscardStaged"]);

/**
 * A host client whose commands run against the demo state in memory. Each call goes through the
 * production host client, so the contract schemas check its input and its result, as for a real
 * host. A command without a demo handler fails with its name and never reaches a host. After the
 * demo ended, only the cleanup commands of the connection run, until `disposed` returns true.
 */
export const createDemoHostClient = (
  handlers: DemoHandlers,
  lifetime: AbortSignal,
  disposed: () => boolean,
): HostClient => {
  // The production client calls `invoke` at once from the method that the views call, so the
  // method and its typed arguments are known when the command arrives.
  let calling: MethodCall | null = null;
  const client = createHostClient(async (command, _args, resultSchema) => {
    const call = calling;
    calling = null;
    if (!call) throw new HostInvokeError(`The demo received ${command} outside a client call.`);
    if (disposed() || (lifetime.aborted && !CLEANUP_METHODS.has(call.method)))
      throw new HostInvokeError("The demo ended. Open the demo again.");
    const handler = handlers[call.method];
    if (!handler)
      throw new HostInvokeError(
        `The demo cannot run ${command}. Connect to a host on your computer to use this action.`,
      );
    // SAFETY: the views called the client method of this name with these arguments, and its
    // handler takes the same arguments.
    const answer = handler as ErasedHandler;
    return resultSchema.parse(await answer(...call.args));
  });
  // SAFETY: createHostClient defines each HostClient method as an own property of the client.
  const methods = Object.getOwnPropertyNames(client) as HostMethod[];
  for (const method of methods) {
    // SAFETY: the wrapper below passes its arguments unchanged to the method of the same name.
    const production = client[method] as ForwardedMethod;
    Object.defineProperty(client, method, {
      value: (...args: unknown[]) => {
        calling = { method, args };
        try {
          return production(...args);
        } finally {
          calling = null;
        }
      },
    });
  }
  return client;
};
