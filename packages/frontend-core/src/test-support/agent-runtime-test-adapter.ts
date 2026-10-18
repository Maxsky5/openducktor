import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {
  AgentRuntimeSessionControlPort,
  AgentSessionHistoryPort,
  AgentCatalogPort,
  AgentWorkspaceInspectionPort,
  AgentEvent,
  PolicyBoundSessionRef,
  ReplyApprovalInput,
  ReplyQuestionInput,
} from "@openducktor/core";
/** UI tests stub ports without constructing a native protocol adapter. */
export class AgentRuntimeTestAdapter {
  listRuntimeDefinitions() {
    return [OPENCODE_RUNTIME_DESCRIPTOR];
  }
  getRuntimeDefinition() {
    return OPENCODE_RUNTIME_DESCRIPTOR;
  }
  async startSession(
    _input: Parameters<AgentRuntimeSessionControlPort["startSession"]>[0],
  ): ReturnType<AgentRuntimeSessionControlPort["startSession"]> {
    throw new Error("Unexpected startSession");
  }
  async resumeSession(
    _input: Parameters<AgentRuntimeSessionControlPort["resumeSession"]>[0],
  ): ReturnType<AgentRuntimeSessionControlPort["resumeSession"]> {
    throw new Error("Unexpected resumeSession");
  }
  async continueInterruptedTurn(
    _input: Parameters<AgentRuntimeSessionControlPort["continueInterruptedTurn"]>[0],
  ): ReturnType<AgentRuntimeSessionControlPort["continueInterruptedTurn"]> {
    throw new Error("Unexpected continueInterruptedTurn");
  }
  async forkSession(
    _input: Parameters<AgentRuntimeSessionControlPort["forkSession"]>[0],
  ): ReturnType<AgentRuntimeSessionControlPort["forkSession"]> {
    throw new Error("Unexpected forkSession");
  }
  async sendUserMessage(
    _input: Parameters<AgentRuntimeSessionControlPort["sendUserMessage"]>[0],
  ): ReturnType<AgentRuntimeSessionControlPort["sendUserMessage"]> {
    throw new Error("Unexpected sendUserMessage");
  }
  async updateSessionModel(
    _input: Parameters<AgentRuntimeSessionControlPort["updateSessionModel"]>[0],
  ): ReturnType<AgentRuntimeSessionControlPort["updateSessionModel"]> {
    throw new Error("Unexpected updateSessionModel");
  }
  async stopSession(
    _input: Parameters<AgentRuntimeSessionControlPort["stopSession"]>[0],
  ): ReturnType<AgentRuntimeSessionControlPort["stopSession"]> {
    throw new Error("Unexpected stopSession");
  }
  async releaseSession(
    _input: Parameters<AgentRuntimeSessionControlPort["releaseSession"]>[0],
  ): ReturnType<AgentRuntimeSessionControlPort["releaseSession"]> {}
  async loadSessionHistory(
    _input: Parameters<AgentSessionHistoryPort["loadSessionHistory"]>[0],
  ): ReturnType<AgentSessionHistoryPort["loadSessionHistory"]> {
    return [];
  }
  async loadSessionTodos(
    _input: Parameters<AgentSessionHistoryPort["loadSessionTodos"]>[0],
  ): ReturnType<AgentSessionHistoryPort["loadSessionTodos"]> {
    return [];
  }
  async loadRuntimeCatalog(
    _input: Parameters<AgentCatalogPort["loadRuntimeCatalog"]>[0],
  ): ReturnType<AgentCatalogPort["loadRuntimeCatalog"]> {
    throw new Error("Unexpected loadRuntimeCatalog");
  }
  async searchFiles(
    _input: Parameters<AgentCatalogPort["searchFiles"]>[0],
  ): ReturnType<AgentCatalogPort["searchFiles"]> {
    return [];
  }
  async loadSessionDiff(
    _input: Parameters<AgentWorkspaceInspectionPort["loadSessionDiff"]>[0],
  ): ReturnType<AgentWorkspaceInspectionPort["loadSessionDiff"]> {
    return [];
  }
  async loadFileStatus(
    _input: Parameters<AgentWorkspaceInspectionPort["loadFileStatus"]>[0],
  ): ReturnType<AgentWorkspaceInspectionPort["loadFileStatus"]> {
    return [];
  }
  async subscribeEvents(
    _ref: PolicyBoundSessionRef,
    _listener: (event: AgentEvent) => void,
  ): Promise<() => void> {
    return () => {};
  }
  async replyApproval(_input: ReplyApprovalInput): Promise<void> {}
  async replyQuestion(_input: ReplyQuestionInput): Promise<void> {}
}
