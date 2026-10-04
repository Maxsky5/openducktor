import type { TerminalContext } from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  TerminalProducerHandle,
  TerminalPtyError,
  TerminalPtyExit,
} from "./terminal-pty-port";

/** The host owns output, replay, screen state, and attachments for this source. */
export type TerminalOutputSource = {
  readonly terminalId: string;
  write(data: Uint8Array): void;
  activate(handle: TerminalProducerHandle): Effect.Effect<void, TerminalPtyError>;
  exit(exit: TerminalPtyExit): void;
  // Forget a source only after its producer stops and calls exit.
  release(): void;
};

export type TerminalOutputSourcePort = {
  openOutputSource(input: {
    context: TerminalContext;
    workingDir: string;
    label: string;
    command: string;
    onForgotten(): void;
  }): Effect.Effect<TerminalOutputSource, TerminalPtyError>;
};
