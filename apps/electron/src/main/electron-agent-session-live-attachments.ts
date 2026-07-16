import {
  type AgentSessionLiveDetachInput,
  agentSessionLiveAttachInputSchema,
  agentSessionLiveDetachInputSchema,
  agentSessionLiveEnvelopeSchema,
} from "@openducktor/contracts";
import { ElectronValidationError } from "../effect/electron-errors";
import type { ElectronHostInvokeRequest } from "../shared/electron-bridge-contract";

const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";

type DetachAttachment = (input: AgentSessionLiveDetachInput) => Promise<void>;

type CreateElectronAgentSessionLiveAttachmentRegistryInput = {
  readonly detachAttachment: DetachAttachment;
};

export type ElectronAgentSessionLiveAttachmentRegistry = {
  readonly invoke: <Output>(
    ownerId: number,
    request: ElectronHostInvokeRequest,
    invokeHost: () => Promise<Output>,
  ) => Promise<Output>;
  readonly releaseOwner: (ownerId: number) => Promise<void>;
  readonly shouldDeliverHostEvent: (ownerId: number, channel: string, payload: unknown) => boolean;
};

const invalidCommandInput = (
  command: "agent_session_live_attach" | "agent_session_live_detach",
  cause: unknown,
): ElectronValidationError =>
  new ElectronValidationError({
    operation: "electron.agent-session-live.validate-command",
    message: cause instanceof Error ? cause.message : String(cause),
    field: "args",
    cause,
    details: { command },
  });

export const createElectronAgentSessionLiveAttachmentRegistry = ({
  detachAttachment,
}: CreateElectronAgentSessionLiveAttachmentRegistryInput): ElectronAgentSessionLiveAttachmentRegistry => {
  const attachmentOwnerIds = new Map<string, number>();
  const ownerAttachmentIds = new Map<number, Set<string>>();
  const ownerOperationTails = new Map<number, Promise<void>>();

  const claimAttachment = (ownerId: number, attachmentId: string): void => {
    const existingOwnerId = attachmentOwnerIds.get(attachmentId);
    if (existingOwnerId !== undefined && existingOwnerId !== ownerId) {
      throw new ElectronValidationError({
        operation: "electron.agent-session-live.claim-attachment",
        message: `Live-session attachment '${attachmentId}' belongs to another renderer.`,
        field: "attachmentId",
        details: { attachmentId, existingOwnerId, ownerId },
      });
    }

    attachmentOwnerIds.set(attachmentId, ownerId);
    const attachmentIds = ownerAttachmentIds.get(ownerId) ?? new Set<string>();
    attachmentIds.add(attachmentId);
    ownerAttachmentIds.set(ownerId, attachmentIds);
  };

  const forgetAttachment = (ownerId: number, attachmentId: string): void => {
    if (attachmentOwnerIds.get(attachmentId) !== ownerId) {
      return;
    }
    attachmentOwnerIds.delete(attachmentId);
    const attachmentIds = ownerAttachmentIds.get(ownerId);
    attachmentIds?.delete(attachmentId);
    if (attachmentIds?.size === 0) {
      ownerAttachmentIds.delete(ownerId);
    }
  };

  const runOwnerOperation = <Output>(
    ownerId: number,
    operation: () => Promise<Output>,
  ): Promise<Output> => {
    const previousTail = ownerOperationTails.get(ownerId) ?? Promise.resolve();
    const result = previousTail.then(operation);
    const nextTail = result.then(
      () => undefined,
      () => undefined,
    );
    ownerOperationTails.set(ownerId, nextTail);
    return result.finally(() => {
      if (ownerOperationTails.get(ownerId) === nextTail) {
        ownerOperationTails.delete(ownerId);
      }
    });
  };

  return {
    invoke: (ownerId, request, invokeHost) => {
      if (request.command === "agent_session_live_attach") {
        const input = (() => {
          try {
            return agentSessionLiveAttachInputSchema.parse(request.args);
          } catch (cause) {
            throw invalidCommandInput(request.command, cause);
          }
        })();
        return runOwnerOperation(ownerId, async () => {
          claimAttachment(ownerId, input.attachmentId);
          try {
            return await invokeHost();
          } catch (cause) {
            forgetAttachment(ownerId, input.attachmentId);
            throw cause;
          }
        });
      }

      if (request.command === "agent_session_live_detach") {
        const input = (() => {
          try {
            return agentSessionLiveDetachInputSchema.parse(request.args);
          } catch (cause) {
            throw invalidCommandInput(request.command, cause);
          }
        })();
        return runOwnerOperation(ownerId, async () => {
          const existingOwnerId = attachmentOwnerIds.get(input.attachmentId);
          if (existingOwnerId !== undefined && existingOwnerId !== ownerId) {
            throw new ElectronValidationError({
              operation: "electron.agent-session-live.detach-attachment",
              message: `Live-session attachment '${input.attachmentId}' belongs to another renderer.`,
              field: "attachmentId",
              details: { attachmentId: input.attachmentId, existingOwnerId, ownerId },
            });
          }
          forgetAttachment(ownerId, input.attachmentId);
          try {
            return await invokeHost();
          } catch (cause) {
            if (existingOwnerId === ownerId) {
              claimAttachment(ownerId, input.attachmentId);
            }
            throw cause;
          }
        });
      }

      return invokeHost();
    },
    releaseOwner: (ownerId) =>
      runOwnerOperation(ownerId, async () => {
        const attachmentIds = [...(ownerAttachmentIds.get(ownerId) ?? [])];
        const failures: Array<{ readonly attachmentId: string; readonly cause: unknown }> = [];
        await Promise.all(
          attachmentIds.map(async (attachmentId) => {
            try {
              await detachAttachment({ attachmentId });
              forgetAttachment(ownerId, attachmentId);
            } catch (cause) {
              failures.push({ attachmentId, cause });
            }
          }),
        );
        if (failures.length > 0) {
          const details = failures
            .map(
              ({ attachmentId, cause }) =>
                `${attachmentId}: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
            .join("\n");
          throw new AggregateError(
            failures.map(({ cause }) => cause),
            `Failed to release ${failures.length} of ${attachmentIds.length} live-session attachments for renderer '${ownerId}':\n${details}`,
          );
        }
      }),
    shouldDeliverHostEvent: (ownerId, channel, payload) => {
      if (channel !== AGENT_SESSION_LIVE_EVENT_CHANNEL) {
        return true;
      }
      const envelope = agentSessionLiveEnvelopeSchema.safeParse(payload);
      return envelope.success && attachmentOwnerIds.get(envelope.data.attachmentId) === ownerId;
    },
  };
};

type CreateElectronAgentSessionLiveLifecycleHandlersInput = {
  readonly ownerId: number;
  readonly registry: ElectronAgentSessionLiveAttachmentRegistry;
  readonly onCleanupError: (error: unknown) => void;
};

export type ElectronAgentSessionLiveLifecycleHandlers = {
  readonly onDestroyed: () => Promise<void>;
  readonly onMainFrameNavigation: (input: {
    readonly isInPlace: boolean;
    readonly isMainFrame: boolean;
  }) => Promise<void>;
  readonly onRenderProcessGone: () => Promise<void>;
};

export const createElectronAgentSessionLiveLifecycleHandlers = ({
  ownerId,
  registry,
  onCleanupError,
}: CreateElectronAgentSessionLiveLifecycleHandlersInput): ElectronAgentSessionLiveLifecycleHandlers => {
  const releaseOwner = async (): Promise<void> => {
    try {
      await registry.releaseOwner(ownerId);
    } catch (error) {
      onCleanupError(error);
    }
  };

  return {
    onDestroyed: releaseOwner,
    onMainFrameNavigation: async ({ isInPlace, isMainFrame }) => {
      if (isMainFrame && !isInPlace) {
        await releaseOwner();
      }
    },
    onRenderProcessGone: releaseOwner,
  };
};
