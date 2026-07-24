import {
  type TaskEventStreamAcknowledge,
  type TaskEventStreamFrame,
  taskEventStreamAcknowledgeSchema,
  taskEventStreamFrameSchema,
  taskEventStreamSubscribeSchema,
} from "@openducktor/contracts";
import type { EffectNodeHostCommandRouter } from "@openducktor/host";
import type { WebContentsDidStartNavigationEventParams } from "electron";
import { ElectronValidationError } from "../effect/electron-errors";
import {
  ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL,
  ELECTRON_TASK_STREAM_FRAME_CHANNEL,
  ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL,
  ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL,
  ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL,
  electronTaskStreamFrameEnvelopeSchema,
  electronTaskStreamSubscriptionSchema,
  electronTaskStreamTerminalFailureEnvelopeSchema,
  electronTaskStreamUnsubscribeSchema,
} from "../shared/electron-bridge-contract";

type ElectronTaskStreamSender = {
  readonly mainFrame: ElectronTaskStreamFrame;
  isDestroyed(): boolean;
  off(event: "destroyed" | "render-process-gone", listener: () => void): void;
  off(
    event: "did-start-navigation",
    listener: (details: ElectronTaskStreamNavigationDetails) => void,
  ): void;
  on(
    event: "did-start-navigation",
    listener: (details: ElectronTaskStreamNavigationDetails) => void,
  ): void;
  once(event: "destroyed" | "render-process-gone", listener: () => void): void;
};

type ElectronTaskStreamFrame = {
  readonly processId: number;
  readonly routingId: number;
  isDestroyed(): boolean;
  send(channel: string, frame: unknown): void;
};

type ElectronTaskStreamNavigationDetails = Electron.Event<WebContentsDidStartNavigationEventParams>;

type ElectronTaskStreamEvent = {
  readonly frameId: number;
  readonly processId: number;
  readonly sender: ElectronTaskStreamSender;
  readonly senderFrame: ElectronTaskStreamFrame | null;
};

type ElectronIpcMainLike = {
  handle(
    channel: string,
    listener: (event: ElectronTaskStreamEvent, value: unknown) => unknown,
  ): void;
};

type OwnedSubscription = {
  readonly sender: ElectronTaskStreamSender;
  readonly senderFrame: ElectronTaskStreamFrame;
  readonly processId: number;
  readonly routingId: number;
  cleanup(): void;
};

type SenderLifecycle = {
  readonly subscriptionIds: Set<string>;
  readonly cleanup: () => void;
  readonly navigation: (details: ElectronTaskStreamNavigationDetails) => void;
};

export type ElectronTaskStreamIpcOptions = {
  ipcMain: ElectronIpcMainLike;
  reportDeliveryFailure(failure: { cause: unknown; subscriptionId: string }): void;
  taskEventStream: EffectNodeHostCommandRouter["taskEventStream"];
};

const validationError = (
  operation: string,
  field: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
) => new ElectronValidationError({ operation, field, message, details });

const readTrustedSender = (
  event: ElectronTaskStreamEvent,
  operation: string,
): { sender: ElectronTaskStreamSender; senderFrame: ElectronTaskStreamFrame } => {
  const { sender, senderFrame } = event;
  const mainFrame = sender.mainFrame;
  if (
    sender.isDestroyed() ||
    !senderFrame ||
    senderFrame.isDestroyed() ||
    senderFrame.processId !== event.processId ||
    senderFrame.routingId !== event.frameId ||
    senderFrame.processId !== mainFrame.processId ||
    senderFrame.routingId !== mainFrame.routingId
  ) {
    throw validationError(
      operation,
      "senderFrame",
      "Electron task stream messages must come from the sender's active main frame.",
    );
  }
  return { sender, senderFrame };
};

const parseOrThrow = <Value>(
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: Value } | { success: false; error: { issues: unknown } };
  },
  value: unknown,
  operation: string,
  field: string,
): Value => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw validationError(operation, field, "Electron task stream IPC payload is invalid.", {
    issues: parsed.error,
  });
};

export const registerElectronTaskStreamIpc = ({
  ipcMain,
  reportDeliveryFailure,
  taskEventStream,
}: ElectronTaskStreamIpcOptions): void => {
  const subscriptions = new Map<string, OwnedSubscription>();
  const senderLifecycles = new Map<ElectronTaskStreamSender, SenderLifecycle>();

  const detachSenderLifecycle = (
    sender: ElectronTaskStreamSender,
    lifecycle: SenderLifecycle,
  ): void => {
    sender.off("destroyed", lifecycle.cleanup);
    sender.off("render-process-gone", lifecycle.cleanup);
    sender.off("did-start-navigation", lifecycle.navigation);
    senderLifecycles.delete(sender);
  };

  const cleanupSenderSubscriptions = (sender: ElectronTaskStreamSender): void => {
    const lifecycle = senderLifecycles.get(sender);
    if (!lifecycle) return;
    for (const subscriptionId of [...lifecycle.subscriptionIds]) {
      subscriptions.get(subscriptionId)?.cleanup();
    }
  };

  const bindSenderLifecycle = (sender: ElectronTaskStreamSender): SenderLifecycle => {
    const existing = senderLifecycles.get(sender);
    if (existing) return existing;
    const lifecycle: SenderLifecycle = {
      subscriptionIds: new Set(),
      cleanup: () => cleanupSenderSubscriptions(sender),
      navigation: (details) => {
        if (details.isMainFrame && !details.isSameDocument) {
          cleanupSenderSubscriptions(sender);
        }
      },
    };
    senderLifecycles.set(sender, lifecycle);
    sender.once("destroyed", lifecycle.cleanup);
    sender.once("render-process-gone", lifecycle.cleanup);
    sender.on("did-start-navigation", lifecycle.navigation);
    return lifecycle;
  };

  const requireOwnedSubscription = (
    event: ElectronTaskStreamEvent,
    subscriptionId: string,
    operation: string,
  ): OwnedSubscription => {
    const sender = readTrustedSender(event, operation);
    const subscription = subscriptions.get(subscriptionId);
    if (
      !subscription ||
      subscription.sender !== sender.sender ||
      subscription.processId !== sender.senderFrame.processId ||
      subscription.routingId !== sender.senderFrame.routingId
    ) {
      throw validationError(
        operation,
        "subscriptionId",
        "Electron task stream subscriptions belong to their creating renderer frame.",
        { subscriptionId },
      );
    }
    return subscription;
  };

  ipcMain.handle(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, (event, value) => {
    const input = parseOrThrow(
      taskEventStreamSubscribeSchema,
      value,
      "electron.task-stream.subscribe.validate",
      "input",
    );
    const owner = readTrustedSender(event, "electron.task-stream.subscribe.sender");
    const ownerProcessId = owner.senderFrame.processId;
    const ownerRoutingId = owner.senderFrame.routingId;
    let cleanedUp = false;
    let subscriptionId: string | null = null;
    let senderLifecycle: SenderLifecycle | null = null;
    let unsubscribeHost = (): void => {};
    const pendingFrames: TaskEventStreamFrame[] = [];
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (subscriptionId) {
        subscriptions.delete(subscriptionId);
        senderLifecycle?.subscriptionIds.delete(subscriptionId);
      }
      if (senderLifecycle && senderLifecycle.subscriptionIds.size === 0) {
        detachSenderLifecycle(owner.sender, senderLifecycle);
      }
      unsubscribeHost();
    };
    const notifyTerminalFailure = (message: string): void => {
      if (
        owner.sender.isDestroyed() ||
        owner.senderFrame.isDestroyed() ||
        owner.senderFrame.processId !== ownerProcessId ||
        owner.senderFrame.routingId !== ownerRoutingId
      ) {
        return;
      }
      try {
        owner.senderFrame.send(
          ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL,
          electronTaskStreamTerminalFailureEnvelopeSchema.parse({ message, subscriptionId }),
        );
      } catch {
        // The renderer frame stopped accepting messages before terminal delivery.
      }
    };
    const deliverFrame = (frame: TaskEventStreamFrame): void => {
      if (cleanedUp) return;
      if (!subscriptionId) {
        pendingFrames.push(frame);
        return;
      }
      const parsedFrame = taskEventStreamFrameSchema.safeParse(frame);
      if (!parsedFrame.success) {
        reportDeliveryFailure({
          cause: validationError(
            "electron.task-stream.delivery.validate",
            "frame",
            "Task stream produced an invalid frame.",
            { issues: parsedFrame.error.issues },
          ),
          subscriptionId,
        });
        notifyTerminalFailure("Task stream produced an invalid frame.");
        cleanup();
        return;
      }
      if (
        owner.sender.isDestroyed() ||
        owner.senderFrame.isDestroyed() ||
        owner.senderFrame.processId !== ownerProcessId ||
        owner.senderFrame.routingId !== ownerRoutingId
      ) {
        reportDeliveryFailure({
          cause: validationError(
            "electron.task-stream.delivery.owner",
            "senderFrame",
            "Task stream subscription no longer owns a live renderer document.",
          ),
          subscriptionId,
        });
        cleanup();
        return;
      }
      try {
        owner.senderFrame.send(
          ELECTRON_TASK_STREAM_FRAME_CHANNEL,
          electronTaskStreamFrameEnvelopeSchema.parse({
            frame: parsedFrame.data,
            subscriptionId,
          }),
        );
      } catch (cause) {
        reportDeliveryFailure({ cause, subscriptionId });
        cleanup();
      }
    };
    const subscription = taskEventStream.subscribe(input, deliverFrame);
    const createdSubscriptionId = subscription.subscriptionId;
    subscriptionId = createdSubscriptionId;
    unsubscribeHost = subscription.unsubscribe;
    if (cleanedUp) {
      unsubscribeHost();
      return parseOrThrow(
        electronTaskStreamSubscriptionSchema,
        { subscriptionId: createdSubscriptionId },
        "electron.task-stream.subscribe.result",
        "result",
      );
    }
    subscriptions.set(createdSubscriptionId, {
      cleanup,
      sender: owner.sender,
      senderFrame: owner.senderFrame,
      processId: ownerProcessId,
      routingId: ownerRoutingId,
    });
    senderLifecycle = bindSenderLifecycle(owner.sender);
    senderLifecycle.subscriptionIds.add(createdSubscriptionId);
    for (const frame of pendingFrames) {
      if (cleanedUp) break;
      deliverFrame(frame);
    }
    return parseOrThrow(
      electronTaskStreamSubscriptionSchema,
      { subscriptionId: createdSubscriptionId },
      "electron.task-stream.subscribe.result",
      "result",
    );
  });

  ipcMain.handle(ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL, (event, value) => {
    const acknowledgement = parseOrThrow<TaskEventStreamAcknowledge>(
      taskEventStreamAcknowledgeSchema,
      value,
      "electron.task-stream.acknowledge.validate",
      "input",
    );
    requireOwnedSubscription(
      event,
      acknowledgement.subscriptionId,
      "electron.task-stream.acknowledge.sender",
    );
    taskEventStream.acknowledge(acknowledgement);
  });

  ipcMain.handle(ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL, (event, value) => {
    const request = parseOrThrow<{ subscriptionId: string }>(
      electronTaskStreamUnsubscribeSchema,
      value,
      "electron.task-stream.unsubscribe.validate",
      "input",
    );
    requireOwnedSubscription(
      event,
      request.subscriptionId,
      "electron.task-stream.unsubscribe.sender",
    ).cleanup();
  });
};
