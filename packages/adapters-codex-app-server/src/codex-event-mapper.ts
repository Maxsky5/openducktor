import type { CodexMappingContext, CodexMappingResult } from "./codex-canonical-events";
import type { JsonValue } from "@openducktor/contracts";
import type { CodexNotificationRecord, CodexServerRequestRecord } from "./types";

export type CodexLiveInput =
  | { kind: "notification"; notification: CodexNotificationRecord }
  | { kind: "server_request"; request: CodexServerRequestRecord }
  | { kind: "item_started"; item: Record<string, JsonValue> }
  | { kind: "item_completed"; item: Record<string, JsonValue> };

export type CodexThreadItemInput = {
  item: Record<string, JsonValue>;
  turn?: Record<string, JsonValue>;
  index: number;
  timestamp?: string;
  isFinalAgentMessage?: boolean;
};

export type CodexMapperState = Record<string, JsonValue> | undefined;

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
