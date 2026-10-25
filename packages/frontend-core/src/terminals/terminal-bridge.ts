import type { TerminalFailure } from "@openducktor/contracts";

export type TerminalTransportState = "connected" | "disconnected";

export type TerminalTransportConnection = {
  send(frame: Uint8Array): Promise<void>;
  close(): void | Promise<void>;
};

/** The terminal frame transport of one host connection. */
export type TerminalBridge = {
  /** Remote shells await the selected terminal owner's finite restoration. */
  subscribeRecovery?: (recover: (signal: AbortSignal) => Promise<void>) => () => void;
  connect(
    onFrame: (frame: Uint8Array) => void,
    onStateChange: (state: TerminalTransportState) => void,
    onFailure: (failure: TerminalFailure) => void,
  ): Promise<TerminalTransportConnection>;
};
