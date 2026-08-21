import type {
  CodexAppServerClient,
  CodexAppServerFuzzyFileSearchParams,
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
  jsonValueSchema,
  parseCodexAppServerClientRequest,
  parseCodexAppServerRequestResult,
  type CodexAppServerRequestMethod,
  type CodexAppServerRequestParams,
} from "@openducktor/contracts";

const requestCodex = async <Method extends CodexAppServerRequestMethod>(
  transport: CodexJsonRpcTransport,
  method: Method,
  params: CodexAppServerRequestParams<Method>,
) => {
  const request = parseCodexAppServerClientRequest({ method, params });
  const wireParams = jsonValueSchema.parse(request.params);
  const result = await transport.request({ method, params: wireParams });
  return parseCodexAppServerRequestResult(method, result);
};

export const createCodexAppServerClient = (
  transport: CodexJsonRpcTransport,
): CodexAppServerClient => {
  return {
    async initialize(params) {
      await requestCodex(transport, "initialize", params);
    },
    async modelList() {
      return requestCodex(transport, "model/list", {});
    },
    async skillsList(params: CodexSkillsListParams) {
      return requestCodex(transport, "skills/list", params);
    },
    async threadStart(params: CodexThreadStartParams) {
      return requestCodex(transport, "thread/start", params);
    },
    async threadSetName(params: CodexThreadSetNameParams) {
      return requestCodex(transport, "thread/name/set", params);
    },
    async threadCompactStart(params: CodexThreadCompactStartParams) {
      return requestCodex(transport, "thread/compact/start", params);
    },
    async threadResume(params: CodexThreadResumeParams) {
      return requestCodex(transport, "thread/resume", params);
    },
    async threadFork(params: CodexThreadForkParams) {
      return requestCodex(transport, "thread/fork", params);
    },
    async turnStart(params: CodexTurnStartParams) {
      return requestCodex(transport, "turn/start", params);
    },
    async turnSteer(params: CodexTurnSteerParams) {
      return requestCodex(transport, "turn/steer", params);
    },
    async turnInterrupt(params: CodexTurnInterruptParams) {
      return requestCodex(transport, "turn/interrupt", params);
    },
    async fuzzyFileSearch(params: CodexAppServerFuzzyFileSearchParams) {
      return requestCodex(transport, "fuzzyFileSearch", params);
    },
    async threadRead(params) {
      return requestCodex(transport, "thread/read", params);
    },
    async threadList(params = {}) {
      return requestCodex(transport, "thread/list", params);
    },
    async threadLoadedList(params = {}) {
      return requestCodex(transport, "thread/loaded/list", params);
    },
    async threadTurnsList(params) {
      return requestCodex(transport, "thread/turns/list", params);
    },
  };
};
