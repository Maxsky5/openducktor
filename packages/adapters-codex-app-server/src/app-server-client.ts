import type {
  CodexAppServerClient,
  CodexAppServerFuzzyFileSearchParams,
  CodexJsonRpcRequest,
  CodexJsonRpcTransport,
  CodexSkillsListParams,
  CodexThreadCompactStartParams,
  CodexThreadForkParams,
  CodexThreadResumeParams,
  CodexThreadSetNameParams,
  CodexThreadStartParams,
  CodexTurnInterruptParams,
  CodexTurnStartParams,
  CodexTurnSteerParams,
} from "./types";
import {
  parseCodexAppServerRequestResult,
  type CodexAppServerClientRequestMap,
} from "@openducktor/contracts";

const requestCodex = async <Method extends CodexJsonRpcRequest["method"]>(
  transport: CodexJsonRpcTransport,
  request: Extract<CodexJsonRpcRequest, { method: Method }>,
): Promise<CodexAppServerClientRequestMap[Method]["result"]> => {
  const result = await transport.request(request);
  return parseCodexAppServerRequestResult(request.method, result);
};

export const createCodexAppServerClient = (
  transport: CodexJsonRpcTransport,
): CodexAppServerClient => {
  return {
    async initialize(params) {
      await requestCodex(transport, { method: "initialize", params });
    },
    async modelList() {
      return requestCodex(transport, { method: "model/list", params: {} });
    },
    async skillsList(params: CodexSkillsListParams) {
      return requestCodex(transport, { method: "skills/list", params });
    },
    async threadStart(params: CodexThreadStartParams) {
      return requestCodex(transport, { method: "thread/start", params });
    },
    async threadSetName(params: CodexThreadSetNameParams) {
      return requestCodex(transport, { method: "thread/name/set", params });
    },
    async threadCompactStart(params: CodexThreadCompactStartParams) {
      return requestCodex(transport, { method: "thread/compact/start", params });
    },
    async threadResume(params: CodexThreadResumeParams) {
      return requestCodex(transport, { method: "thread/resume", params });
    },
    async threadFork(params: CodexThreadForkParams) {
      return requestCodex(transport, { method: "thread/fork", params });
    },
    async turnStart(params: CodexTurnStartParams) {
      return requestCodex(transport, { method: "turn/start", params });
    },
    async turnSteer(params: CodexTurnSteerParams) {
      return requestCodex(transport, { method: "turn/steer", params });
    },
    async turnInterrupt(params: CodexTurnInterruptParams) {
      return requestCodex(transport, { method: "turn/interrupt", params });
    },
    async fuzzyFileSearch(params: CodexAppServerFuzzyFileSearchParams) {
      return requestCodex(transport, { method: "fuzzyFileSearch", params });
    },
    async threadRead(params) {
      return requestCodex(transport, { method: "thread/read", params });
    },
    async threadList(params = {}) {
      return requestCodex(transport, { method: "thread/list", params });
    },
    async threadLoadedList(params = {}) {
      return requestCodex(transport, { method: "thread/loaded/list", params });
    },
    async threadTurnsList(params) {
      return requestCodex(transport, { method: "thread/turns/list", params });
    },
  };
};
