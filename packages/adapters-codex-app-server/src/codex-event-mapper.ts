import type { CodexMappingContext, CodexMappingResult } from "./codex-canonical-events";
import type { CodexAppServerThreadItem, CodexAppServerTurn } from "@openducktor/contracts";
import type { CodexNotificationRecord, CodexServerRequestRecord } from "./types";

export type CodexTimedThreadItem = CodexAppServerThreadItem & {
  startedAtMs?: number;
  completedAtMs?: number;
};

export type CodexLiveInput =
  | { kind: "notification"; notification: CodexNotificationRecord }
  | { kind: "server_request"; request: CodexServerRequestRecord }
  | { kind: "item_started"; item: CodexTimedThreadItem }
  | { kind: "item_completed"; item: CodexTimedThreadItem };

export type CodexThreadItemInput = {
  item: CodexTimedThreadItem;
  turn?: CodexAppServerTurn;
  index: number;
  timestamp?: string;
  isFinalAgentMessage?: boolean;
};

export interface CodexEventMapper<State = undefined> {
  readonly name: string;
  createState(): State;
  fromLive(input: CodexLiveInput, ctx: CodexMappingContext, state: State): CodexMappingResult;
  fromThreadItem(
    input: CodexThreadItemInput,
    ctx: CodexMappingContext,
    state: State,
  ): CodexMappingResult;
}

export type RegisteredCodexEventMapper = {
  readonly name: string;
  fromLive(input: CodexLiveInput, ctx: CodexMappingContext): CodexMappingResult;
  fromThreadItem(input: CodexThreadItemInput, ctx: CodexMappingContext): CodexMappingResult;
};

export const registerCodexEventMapper = <State>(
  mapper: CodexEventMapper<State>,
): RegisteredCodexEventMapper => {
  const state = mapper.createState();
  return {
    name: mapper.name,
    fromLive: (input, ctx) => mapper.fromLive(input, ctx, state),
    fromThreadItem: (input, ctx) => mapper.fromThreadItem(input, ctx, state),
  };
};

export const noCodexMapperState = (): undefined => undefined;
