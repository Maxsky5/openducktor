import type { CodexMappingContext, CodexMappingResult } from "./codex-canonical-events";
import type { CodexNotificationRecord, CodexServerRequestRecord } from "./types";

export type CodexLiveInput =
  | { kind: "notification"; notification: CodexNotificationRecord }
  | { kind: "server_request"; request: CodexServerRequestRecord }
  | { kind: "item_started"; item: Record<string, unknown> }
  | { kind: "item_completed"; item: Record<string, unknown> };

export type CodexThreadItemInput = {
  item: Record<string, unknown>;
  turn?: Record<string, unknown>;
  index: number;
  timestamp?: string;
  isFinalAgentMessage?: boolean;
};

export type CodexMapperState = Record<string, unknown> | undefined;

export interface CodexEventMapper<State extends CodexMapperState = undefined> {
  readonly name: string;
  createState(): State;
  fromLive(input: CodexLiveInput, ctx: CodexMappingContext, state: State): CodexMappingResult;
  fromThreadItem(
    input: CodexThreadItemInput,
    ctx: CodexMappingContext,
    state: State,
  ): CodexMappingResult;
}

export type RegisteredCodexEventMapper = CodexEventMapper<CodexMapperState>;

export const noCodexMapperState = (): undefined => undefined;
