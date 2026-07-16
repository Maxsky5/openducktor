import {
  agentSessionLiveAttachInputSchema,
  agentSessionLiveDetachInputSchema,
  agentSessionLiveEnvelopeSchema,
} from "@openducktor/contracts";
import type { EffectHostCommandRouter } from "@openducktor/host";
import { Effect } from "effect";
import { WebHostRequestError } from "./effect/web-errors";
import type { BufferedHostEvent } from "./typescript-host-backend-support";

const AGENT_SESSION_LIVE_STREAM_PATH = "agent-session-live-events";
const AGENT_SESSION_LIVE_SUBSCRIBER_PARAM = "subscriber";

export type AgentSessionLiveSseLease = {
  readonly acceptsEvent: (event: BufferedHostEvent) => boolean;
  readonly release: () => Promise<void>;
};

type OwnedAgentSessionLiveSseLease = AgentSessionLiveSseLease & {
  readonly attachmentPrefix: string;
  readonly attach: (attachmentId: string, invokeHost: () => Promise<unknown>) => Promise<unknown>;
  readonly detach: (attachmentId: string, invokeHost: () => Promise<unknown>) => Promise<unknown>;
};

export type AgentSessionLiveSseLeaseRegistry = {
  readonly createLease: (
    requestUrl: URL,
  ) => Effect.Effect<AgentSessionLiveSseLease, WebHostRequestError>;
  readonly invoke: (
    command: string,
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, unknown>;
};

const invalidLiveCommandInput = (
  command: "agent_session_live_attach" | "agent_session_live_detach",
  cause: unknown,
): WebHostRequestError =>
  new WebHostRequestError({
    message: cause instanceof Error ? cause.message : String(cause),
    status: 400,
    cause,
    details: { command },
  });

const unavailableAttachmentError = (attachmentId: string): WebHostRequestError =>
  new WebHostRequestError({
    message: `Live-session attachment '${attachmentId}' does not belong to an active browser transport.`,
    status: 409,
    details: { attachmentId },
  });

export const createAgentSessionLiveSseLeaseRegistry = (
  hostCommandRouter: EffectHostCommandRouter,
): AgentSessionLiveSseLeaseRegistry => {
  const activeLeasesByPrefix = new Map<string, OwnedAgentSessionLiveSseLease>();
  const attachmentOwners = new Map<string, OwnedAgentSessionLiveSseLease>();

  const createLease = (
    requestUrl: URL,
  ): Effect.Effect<AgentSessionLiveSseLease, WebHostRequestError> =>
    Effect.gen(function* () {
      const subscriber = requestUrl.searchParams.get(AGENT_SESSION_LIVE_SUBSCRIBER_PARAM);
      if (!subscriber || subscriber.trim() !== subscriber) {
        return yield* Effect.fail(
          new WebHostRequestError({
            message: "Live-session event subscriber identity is required.",
            status: 400,
          }),
        );
      }
      const subscriptionPath = `${AGENT_SESSION_LIVE_STREAM_PATH}?${new URLSearchParams({
        [AGENT_SESSION_LIVE_SUBSCRIBER_PARAM]: subscriber,
      }).toString()}`;
      const attachmentPrefix = `${subscriptionPath}:`;
      const attachmentIds = new Set<string>();
      let released = false;
      let operationTail = Promise.resolve();
      let releasePromise: Promise<void> | null = null;

      const forgetAttachment = (attachmentId: string): void => {
        if (attachmentOwners.get(attachmentId) !== lease) {
          return;
        }
        attachmentOwners.delete(attachmentId);
        attachmentIds.delete(attachmentId);
      };

      const rememberAttachment = (attachmentId: string): void => {
        attachmentOwners.set(attachmentId, lease);
        attachmentIds.add(attachmentId);
      };

      const runOperation = <Output>(operation: () => Promise<Output>): Promise<Output> => {
        const result = operationTail.then(operation);
        operationTail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      };

      const lease: OwnedAgentSessionLiveSseLease = {
        attachmentPrefix,
        acceptsEvent: (event) => {
          if (released) {
            return false;
          }
          let parsedPayload: unknown;
          try {
            parsedPayload = JSON.parse(event.payload) as unknown;
          } catch {
            return false;
          }
          const parsedEnvelope = agentSessionLiveEnvelopeSchema.safeParse(parsedPayload);
          return (
            parsedEnvelope.success &&
            attachmentOwners.get(parsedEnvelope.data.attachmentId) === lease
          );
        },
        attach: (attachmentId, invokeHost) => {
          if (released || activeLeasesByPrefix.get(attachmentPrefix) !== lease) {
            return Promise.reject(unavailableAttachmentError(attachmentId));
          }
          if (attachmentOwners.has(attachmentId)) {
            return Promise.reject(
              new WebHostRequestError({
                message: `Live-session attachment '${attachmentId}' is already claimed.`,
                status: 409,
                details: { attachmentId },
              }),
            );
          }

          rememberAttachment(attachmentId);
          return runOperation(async () => {
            try {
              return await invokeHost();
            } catch (cause) {
              forgetAttachment(attachmentId);
              throw cause;
            }
          });
        },
        detach: (attachmentId, invokeHost) => {
          if (attachmentOwners.get(attachmentId) !== lease) {
            return Promise.reject(unavailableAttachmentError(attachmentId));
          }

          return runOperation(async () => {
            if (attachmentOwners.get(attachmentId) !== lease) {
              return null;
            }
            forgetAttachment(attachmentId);
            try {
              return await invokeHost();
            } catch (cause) {
              rememberAttachment(attachmentId);
              throw cause;
            }
          });
        },
        release: () => {
          if (releasePromise) {
            return releasePromise;
          }
          released = true;
          if (activeLeasesByPrefix.get(attachmentPrefix) === lease) {
            activeLeasesByPrefix.delete(attachmentPrefix);
          }
          const cleanupPromise = runOperation(async () => {
            const detachFailures: unknown[] = [];
            for (const attachmentId of [...attachmentIds]) {
              try {
                await Effect.runPromise(
                  hostCommandRouter.invoke("agent_session_live_detach", { attachmentId }),
                );
                forgetAttachment(attachmentId);
              } catch (cause) {
                detachFailures.push(cause);
              }
            }
            if (detachFailures.length > 0) {
              throw new AggregateError(
                detachFailures,
                `Failed to release ${detachFailures.length} live-session browser attachment(s).`,
              );
            }
          });
          releasePromise = cleanupPromise.catch((cause: unknown) => {
            releasePromise = null;
            throw cause;
          });
          return releasePromise;
        },
      };

      activeLeasesByPrefix.set(attachmentPrefix, lease);
      return lease;
    });

  const activeLeaseForAttachment = (
    attachmentId: string,
  ): OwnedAgentSessionLiveSseLease | undefined => {
    for (const [attachmentPrefix, lease] of activeLeasesByPrefix) {
      if (attachmentId.startsWith(attachmentPrefix)) {
        return lease;
      }
    }
    return undefined;
  };

  const invokeHost = (command: string, args: Record<string, unknown>): Promise<unknown> =>
    Effect.runPromise(hostCommandRouter.invoke(command, args));

  return {
    createLease,
    invoke: (command, args) => {
      if (command === "agent_session_live_attach") {
        const parsedInput = agentSessionLiveAttachInputSchema.safeParse(args);
        if (!parsedInput.success) {
          return Effect.fail(invalidLiveCommandInput(command, parsedInput.error));
        }
        const lease = activeLeaseForAttachment(parsedInput.data.attachmentId);
        if (!lease) {
          return Effect.fail(unavailableAttachmentError(parsedInput.data.attachmentId));
        }
        return Effect.tryPromise({
          try: () => lease.attach(parsedInput.data.attachmentId, () => invokeHost(command, args)),
          catch: (cause) => cause,
        });
      }

      if (command === "agent_session_live_detach") {
        const parsedInput = agentSessionLiveDetachInputSchema.safeParse(args);
        if (!parsedInput.success) {
          return Effect.fail(invalidLiveCommandInput(command, parsedInput.error));
        }
        const lease = attachmentOwners.get(parsedInput.data.attachmentId);
        if (!lease) {
          return hostCommandRouter.invoke(command, args);
        }
        return Effect.tryPromise({
          try: () => lease.detach(parsedInput.data.attachmentId, () => invokeHost(command, args)),
          catch: (cause) => cause,
        });
      }

      return hostCommandRouter.invoke(command, args);
    },
  };
};
