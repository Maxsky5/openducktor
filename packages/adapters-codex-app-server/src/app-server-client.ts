import type {
  CodexAppServerClient,
  CodexAppServerFuzzyFileSearchParams,
  CodexAppServerFuzzyFileSearchResponse,
  CodexJsonRpcTransport,
  CodexModelListResponse,
  CodexSkillsListParams,
  CodexSkillsListResponse,
  CodexThreadCompactStartParams,
  CodexThreadForkParams,
  CodexThreadResumeParams,
  CodexThreadSetNameParams,
  CodexThreadStartParams,
  CodexTurnInterruptParams,
  CodexTurnStartParams,
  CodexTurnSteerParams,
} from "./types";

export const createCodexAppServerClient = (
  transport: CodexJsonRpcTransport,
): CodexAppServerClient => {
  return {
    async initialize(params) {
      await transport.request({ method: "initialize", params });
    },
    async modelList() {
      return transport.request<CodexModelListResponse>({ method: "model/list", params: {} });
    },
    async skillsList(params: CodexSkillsListParams) {
      return transport.request<CodexSkillsListResponse>({ method: "skills/list", params });
    },
    async threadStart(params: CodexThreadStartParams) {
      return transport.request({ method: "thread/start", params });
    },
    async threadSetName(params: CodexThreadSetNameParams) {
      return transport.request({ method: "thread/name/set", params });
    },
    async threadCompactStart(params: CodexThreadCompactStartParams) {
      return transport.request({ method: "thread/compact/start", params });
    },
    async threadResume(params: CodexThreadResumeParams) {
      return transport.request({ method: "thread/resume", params });
    },
    async threadFork(params: CodexThreadForkParams) {
      return transport.request({ method: "thread/fork", params });
    },
    async turnStart(params: CodexTurnStartParams) {
      return transport.request({ method: "turn/start", params });
    },
    async turnSteer(params: CodexTurnSteerParams) {
      return transport.request({ method: "turn/steer", params });
    },
    async turnInterrupt(params: CodexTurnInterruptParams) {
      return transport.request({ method: "turn/interrupt", params });
    },
    async fuzzyFileSearch(params: CodexAppServerFuzzyFileSearchParams) {
      return transport.request<CodexAppServerFuzzyFileSearchResponse>({
        method: "fuzzyFileSearch",
        params,
      });
    },
    async threadRead(params) {
      return transport.request({ method: "thread/read", params });
    },
    async threadList(params = {}) {
      return transport.request({ method: "thread/list", params });
    },
    async threadLoadedList(params = {}) {
      return transport.request({ method: "thread/loaded/list", params });
    },
    async threadTurnsList(params) {
      return transport.request({ method: "thread/turns/list", params });
    },
    async turnDiff(params) {
      return transport.request({ method: "turn/diff", params });
    },
  };
};
