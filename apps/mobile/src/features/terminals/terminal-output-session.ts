import type { TerminalServerMessage } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { TerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import {
  handleTerminalMetadataFrame,
  type TerminalFrameScheduler,
} from "@openducktor/frontend-core/terminals/terminal-viewport-policy";
import type {
  TerminalPageInbound,
  TerminalPageOutbound,
} from "@/rich-content/isolated-page/terminal-page-messages";
import { createTerminalPageBatcher } from "./terminal-page-batcher";

type OutputTransport = Pick<
  TerminalTransportController,
  "subscribe" | "acknowledge" | "releaseEmulator"
>;

/** Connects a read-only page without changing the PTY grid or sending terminal input. */
export const createTerminalOutputSession = ({
  terminalId,
  transport,
  frames,
  onNotice,
  onCopy,
}: {
  terminalId: string;
  transport: OutputTransport;
  frames: TerminalFrameScheduler;
  onNotice: (message: string) => void;
  onCopy: (text: string) => void;
}) => {
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  let post: ((message: TerminalPageInbound) => void) | null = null;
  const batcher = createTerminalPageBatcher({ ...frames, post: (message) => post?.(message) });
  const handleFrame = (message: TerminalServerMessage, payload: Uint8Array): void => {
    if (message.type === "snapshot")
      batcher.push({ kind: "snapshot", sequenceEnd: message.snapshotSequenceEnd });
    if (message.type === "screen_restore") {
      batcher.push({
        kind: "restore",
        sequenceEnd: message.sequenceEnd,
        columns: message.columns,
        rows: message.rows,
        precedingJoinState: message.precedingJoinState,
        payload,
      });
      return;
    }
    const handled = handleTerminalMetadataFrame(message, {
      onAttention: (message) => {
        if (message) onNotice(message);
      },
      onFailure: onNotice,
      onForgotten: onNotice,
      onTitle: () => {},
      onLifecycle: (_lifecycle, exit) => {
        if (exit) onNotice(exit.text);
      },
    });
    if (!handled && message.type === "output")
      batcher.push({
        kind: "output",
        sequenceStart: message.sequenceStart,
        sequenceEnd: message.sequenceEnd,
        payload,
      });
  };
  const detachPage = (): void => {
    post = null;
    batcher.clear();
    if (!unsubscribe) return;
    transport.releaseEmulator(terminalId);
    unsubscribe();
    unsubscribe = null;
  };
  return {
    attachPage(postToPage: (message: TerminalPageInbound) => void): void {
      if (disposed || unsubscribe) return;
      post = postToPage;
      unsubscribe = transport.subscribe(terminalId, handleFrame);
    },
    detachPage,
    receive(message: TerminalPageOutbound): void {
      if (disposed || !unsubscribe) return;
      if (message.type === "terminal_consumed")
        void transport.acknowledge(terminalId, message.sequenceEnd).catch((cause: unknown) => {
          if (!disposed) onNotice(`Terminal output sync failed: ${errorMessage(cause)}`);
        });
      else if (message.type === "terminal_copy") onCopy(message.text);
      else if (message.type === "terminal_error") onNotice(message.message);
    },
    dispose(): void {
      detachPage();
      disposed = true;
    },
  };
};
