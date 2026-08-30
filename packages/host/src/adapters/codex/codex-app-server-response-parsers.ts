import {
  parseCodexAppServerRequestResult,
  type CodexAppServerClientRequestMap,
  type CodexAppServerThread,
  type CodexAppServerThreadTurnsListResponse,
} from "@openducktor/contracts";
import type {
  CodexAppServerLoadedThreadListResponse,
  CodexAppServerThreadListResponse,
} from "../../ports/codex-app-server-port";

export const parseLoadedThreadListResponse = (
  value: CodexAppServerClientRequestMap["thread/loaded/list"]["result"],
): CodexAppServerLoadedThreadListResponse => {
  return parseCodexAppServerRequestResult("thread/loaded/list", value);
};

export const parseThreadListResponse = (
  value: CodexAppServerClientRequestMap["thread/list"]["result"],
): CodexAppServerThreadListResponse => {
  const response = parseCodexAppServerRequestResult("thread/list", value);
  return {
    data: response.data.map(({ id, cwd, status }) => ({ id, cwd, status: status.type })),
    nextCursor: response.nextCursor,
    backwardsCursor: response.backwardsCursor,
  };
};

export const parseThreadReadResponse = (
  value: CodexAppServerClientRequestMap["thread/read"]["result"],
): CodexAppServerThread => {
  return parseCodexAppServerRequestResult("thread/read", value).thread;
};

export const parseThreadTurnsListResponse = (
  value: CodexAppServerClientRequestMap["thread/turns/list"]["result"],
): CodexAppServerThreadTurnsListResponse => {
  return parseCodexAppServerRequestResult("thread/turns/list", value);
};
