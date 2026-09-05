import {
  type AcceptedAgentUserMessage,
  type AgentRepositorySessionStartInput,
  type AgentSessionContextUsage,
  type AgentSessionControlForkInput,
  type AgentSessionControlReleaseInput,
  type AgentSessionControlResumeInput,
  type AgentSessionControlSendInput,
  type AgentSessionControlStopInput,
  type AgentSessionControlSummary,
  type AgentSessionControlUpdateModelInput,
  type AgentSessionLiveListInput,
  type AgentSessionLiveLoadContextInput,
  type AgentSessionLiveLoadDiffInput,
  type AgentSessionLiveReadInput,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRefreshInput,
  type AgentSessionLiveReplyApprovalInput,
  type AgentSessionLiveReplyQuestionInput,
  type AgentSessionLiveSnapshot,
  type AgentWorkflowSessionStartInput,
  type FileDiff,
  acceptedAgentUserMessageSchema,
  agentSessionContextUsageSchema,
  agentSessionControlForkInputSchema,
  agentSessionControlReleaseInputSchema,
  agentSessionControlResumeInputSchema,
  agentSessionControlSendInputSchema,
  agentRepositorySessionStartInputSchema,
  agentSessionControlStopInputSchema,
  agentSessionControlSummarySchema,
  agentSessionControlUpdateModelInputSchema,
  agentSessionLiveListInputSchema,
  agentSessionLiveLoadContextInputSchema,
  agentSessionLiveLoadDiffInputSchema,
  agentSessionLiveLoadDiffResultSchema,
  agentSessionLiveReadInputSchema,
  agentSessionLiveReadResultSchema,
  agentSessionLiveRefreshInputSchema,
  agentSessionLiveReplyApprovalInputSchema,
  agentSessionLiveReplyQuestionInputSchema,
  agentSessionLiveSnapshotSchema,
  agentWorkflowSessionStartInputSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { arrayResultSchema, voidResultSchema } from "./invoke-utils";

export class HostAgentSessionLiveClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async agentSessionControlStart(
    input: AgentRepositorySessionStartInput,
  ): Promise<AgentSessionControlSummary> {
    return this.invokeFn(
      "agent_session_control_start",
      agentRepositorySessionStartInputSchema.parse(input),
      agentSessionControlSummarySchema,
    );
  }

  async agentSessionWorkflowStart(
    input: AgentWorkflowSessionStartInput,
  ): Promise<AgentSessionControlSummary> {
    return this.invokeFn(
      "agent_session_workflow_start",
      agentWorkflowSessionStartInputSchema.parse(input),
      agentSessionControlSummarySchema,
    );
  }

  async agentSessionControlResume(
    input: AgentSessionControlResumeInput,
  ): Promise<AgentSessionControlSummary> {
    return this.invokeFn(
      "agent_session_control_resume",
      agentSessionControlResumeInputSchema.parse(input),
      agentSessionControlSummarySchema,
    );
  }

  async agentSessionControlFork(
    input: AgentSessionControlForkInput,
  ): Promise<AgentSessionControlSummary> {
    return this.invokeFn(
      "agent_session_control_fork",
      agentSessionControlForkInputSchema.parse(input),
      agentSessionControlSummarySchema,
    );
  }

  async agentSessionControlSend(
    input: AgentSessionControlSendInput,
  ): Promise<AcceptedAgentUserMessage> {
    return this.invokeFn(
      "agent_session_control_send",
      agentSessionControlSendInputSchema.parse(input),
      acceptedAgentUserMessageSchema,
    );
  }

  async agentSessionControlUpdateModel(input: AgentSessionControlUpdateModelInput): Promise<void> {
    await this.invokeFn(
      "agent_session_control_update_model",
      agentSessionControlUpdateModelInputSchema.parse(input),
      voidResultSchema,
    );
  }

  async agentSessionControlStop(input: AgentSessionControlStopInput): Promise<void> {
    await this.invokeFn(
      "agent_session_control_stop",
      agentSessionControlStopInputSchema.parse(input),
      voidResultSchema,
    );
  }

  async agentSessionControlRelease(input: AgentSessionControlReleaseInput): Promise<void> {
    await this.invokeFn(
      "agent_session_control_release",
      agentSessionControlReleaseInputSchema.parse(input),
      voidResultSchema,
    );
  }

  async agentSessionLiveRefresh(input: AgentSessionLiveRefreshInput): Promise<void> {
    await this.invokeFn(
      "agent_session_live_refresh",
      agentSessionLiveRefreshInputSchema.parse(input),
      voidResultSchema,
    );
  }

  async agentSessionLiveList(
    input: AgentSessionLiveListInput,
  ): Promise<AgentSessionLiveSnapshot[]> {
    return this.invokeFn(
      "agent_session_live_list",
      agentSessionLiveListInputSchema.parse(input),
      arrayResultSchema(agentSessionLiveSnapshotSchema, "agent_session_live_list"),
    );
  }

  async agentSessionLiveRead(
    input: AgentSessionLiveReadInput,
  ): Promise<AgentSessionLiveReadResult> {
    return this.invokeFn(
      "agent_session_live_read",
      agentSessionLiveReadInputSchema.parse(input),
      agentSessionLiveReadResultSchema,
    );
  }

  async agentSessionLiveLoadContext(
    input: AgentSessionLiveLoadContextInput,
  ): Promise<AgentSessionContextUsage | null> {
    return this.invokeFn(
      "agent_session_live_load_context",
      agentSessionLiveLoadContextInputSchema.parse(input),
      agentSessionContextUsageSchema.nullable(),
    );
  }

  async agentSessionLiveLoadDiff(input: AgentSessionLiveLoadDiffInput): Promise<FileDiff[]> {
    return this.invokeFn(
      "agent_session_live_load_diff",
      agentSessionLiveLoadDiffInputSchema.parse(input),
      agentSessionLiveLoadDiffResultSchema,
    );
  }

  async agentSessionLiveReplyApproval(input: AgentSessionLiveReplyApprovalInput): Promise<void> {
    await this.invokeFn(
      "agent_session_live_reply_approval",
      agentSessionLiveReplyApprovalInputSchema.parse(input),
      voidResultSchema,
    );
  }

  async agentSessionLiveReplyQuestion(input: AgentSessionLiveReplyQuestionInput): Promise<void> {
    await this.invokeFn(
      "agent_session_live_reply_question",
      agentSessionLiveReplyQuestionInputSchema.parse(input),
      voidResultSchema,
    );
  }
}
