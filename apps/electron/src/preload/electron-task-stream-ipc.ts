import {
  type TaskEventCursor,
  type TaskEventStreamFrame,
  type TaskEventStreamSubscribe,
  taskEventStreamAcknowledgeSchema,
  taskEventStreamSubscribeSchema,
} from "@openducktor/contracts";
import {
  ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL,
  ELECTRON_TASK_STREAM_FRAME_CHANNEL,
  ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL,
  ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL,
  ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL,
  type ElectronTaskStreamFrameEnvelope,
  type ElectronTaskStreamTerminalFailureEnvelope,
  electronTaskStreamFrameEnvelopeSchema,
  electronTaskStreamSubscriptionSchema,
  electronTaskStreamTerminalFailureEnvelopeSchema,
  type OpenDucktorElectronTaskStreamApi,
} from "../shared/electron-bridge-contract";

type ElectronIpcRendererLike = {
  invoke(channel: string, value: unknown): Promise<unknown>;
  off(channel: string, listener: (event: unknown, value: unknown) => void): void;
  on(channel: string, listener: (event: unknown, value: unknown) => void): void;
};

export const createElectronTaskStreamApi = (
  ipcRenderer: ElectronIpcRendererLike,
): OpenDucktorElectronTaskStreamApi => ({
  async subscribe(
    input: TaskEventStreamSubscribe,
    listener: (frame: TaskEventStreamFrame) => void,
    onTerminalFailure?: (error: unknown) => void,
  ) {
    const parsedInput = taskEventStreamSubscribeSchema.parse(input);
    let established: { subscriptionId: string } | null = null;
    let closed = false;
    const bufferedFrames: ElectronTaskStreamFrameEnvelope[] = [];
    const bufferedTerminalFailures: ElectronTaskStreamTerminalFailureEnvelope[] = [];
    const handleFrame = (_event: unknown, value: unknown): void => {
      const envelope = electronTaskStreamFrameEnvelopeSchema.parse(value);
      if (closed) return;
      if (!established) {
        bufferedFrames.push(envelope);
        return;
      }
      if (envelope.subscriptionId === established.subscriptionId) listener(envelope.frame);
    };
    const cleanup = async (notifyMain = true): Promise<void> => {
      if (closed) return;
      closed = true;
      ipcRenderer.off(ELECTRON_TASK_STREAM_FRAME_CHANNEL, handleFrame);
      ipcRenderer.off(ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL, handleTerminalFailure);
      if (notifyMain && established) {
        await ipcRenderer.invoke(ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL, {
          subscriptionId: established.subscriptionId,
        });
      }
    };
    const handleTerminalFailure = (_event: unknown, value: unknown): void => {
      const envelope = electronTaskStreamTerminalFailureEnvelopeSchema.parse(value);
      if (closed) return;
      if (!established) {
        bufferedTerminalFailures.push(envelope);
        return;
      }
      if (envelope.subscriptionId !== established.subscriptionId) return;
      void cleanup(false);
      onTerminalFailure?.(new Error(envelope.message));
    };

    ipcRenderer.on(ELECTRON_TASK_STREAM_FRAME_CHANNEL, handleFrame);
    ipcRenderer.on(ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL, handleTerminalFailure);
    try {
      const subscription = electronTaskStreamSubscriptionSchema.parse(
        await ipcRenderer.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, parsedInput),
      );
      established = subscription;
      const earlyTerminalFailure = bufferedTerminalFailures.find(
        (envelope) => envelope.subscriptionId === subscription.subscriptionId,
      );
      if (earlyTerminalFailure) {
        await cleanup(false);
        throw new Error(earlyTerminalFailure.message);
      }
      const replayFrames = bufferedFrames.splice(0);
      for (const envelope of replayFrames) {
        if (envelope.subscriptionId === subscription.subscriptionId) listener(envelope.frame);
      }
      return {
        subscriptionId: subscription.subscriptionId,
        acknowledge: async (cursor: TaskEventCursor): Promise<void> => {
          const request = taskEventStreamAcknowledgeSchema.parse({
            cursor,
            subscriptionId: subscription.subscriptionId,
          });
          await ipcRenderer.invoke(ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL, request);
        },
        unsubscribe: cleanup,
      };
    } catch (cause) {
      await cleanup();
      throw cause;
    }
  },
});
