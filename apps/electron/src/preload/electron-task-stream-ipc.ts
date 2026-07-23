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
  ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL,
  type ElectronTaskStreamFrameEnvelope,
  electronTaskStreamFrameEnvelopeSchema,
  electronTaskStreamSubscriptionSchema,
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
  ) {
    const parsedInput = taskEventStreamSubscribeSchema.parse(input);
    let established: { subscriptionId: string } | null = null;
    let closed = false;
    const bufferedFrames: ElectronTaskStreamFrameEnvelope[] = [];
    const handleFrame = (_event: unknown, value: unknown): void => {
      const envelope = electronTaskStreamFrameEnvelopeSchema.parse(value);
      if (closed) return;
      if (!established) {
        bufferedFrames.push(envelope);
        return;
      }
      if (envelope.subscriptionId === established.subscriptionId) listener(envelope.frame);
    };
    const cleanup = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      ipcRenderer.off(ELECTRON_TASK_STREAM_FRAME_CHANNEL, handleFrame);
      if (established) {
        await ipcRenderer.invoke(ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL, {
          subscriptionId: established.subscriptionId,
        });
      }
    };

    ipcRenderer.on(ELECTRON_TASK_STREAM_FRAME_CHANNEL, handleFrame);
    try {
      const subscription = electronTaskStreamSubscriptionSchema.parse(
        await ipcRenderer.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, parsedInput),
      );
      established = subscription;
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
