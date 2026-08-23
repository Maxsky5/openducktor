import {
  jsonValueSchema,
  parseCodexAppServerRequestResult,
  type CodexAppServerThread,
  type CodexAppServerThreadTurnsListResponse,
} from "@openducktor/contracts";
import type {
  CodexAppServerLoadedThreadListResponse,
  CodexAppServerThreadListResponse,
} from "../../ports/codex-app-server-port";

export const parseLoadedThreadListResponse = (
  value: unknown,
): CodexAppServerLoadedThreadListResponse => {
  const payload = jsonValueSchema.parse(value);
  return parseCodexAppServerRequestResult("thread/loaded/list", payload);
};

export const parseThreadListResponse = (value: unknown): CodexAppServerThreadListResponse => {
  const payload = jsonValueSchema.parse(value);
  const response = parseCodexAppServerRequestResult("thread/list", payload);
  return {
    data: response.data.map(({ id, cwd, status }) => ({ id, cwd, status: status.type })),
    nextCursor: response.nextCursor,
    backwardsCursor: response.backwardsCursor,
  };
};

export const parseThreadReadResponse = (value: unknown): CodexAppServerThread => {
  const payload = jsonValueSchema.parse(value);
  return parseCodexAppServerRequestResult("thread/read", payload).thread;
};

export const parseThreadTurnsListResponse = (
  value: unknown,
): CodexAppServerThreadTurnsListResponse => {
  const payload = jsonValueSchema.parse(value);
  return parseCodexAppServerRequestResult("thread/turns/list", payload);
};
