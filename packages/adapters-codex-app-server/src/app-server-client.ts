import type {
  CodexAppServerClient,
  CodexJsonRpcTransport,
  CodexModelListResponse,
  CodexThreadForkParams,
  CodexThreadResumeParams,
  CodexThreadStartParams,
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
    async threadStart(params: CodexThreadStartParams) {
      return transport.request({ method: "thread/start", params });
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
