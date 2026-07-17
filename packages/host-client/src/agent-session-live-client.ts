import {
  type AcceptedAgentUserMessage,
  type AgentSessionContextUsage,
  type AgentSessionControlForkInput,
  type AgentSessionControlReleaseInput,
  type AgentSessionControlResumeInput,
  type AgentSessionControlSendInput,
  type AgentSessionControlStartInput,
  type AgentSessionControlStopInput,
  type AgentSessionControlSummary,
  type AgentSessionControlUpdateModelInput,
  type AgentSessionLiveListInput,
  type AgentSessionLiveLoadContextInput,
  type AgentSessionLiveReadInput,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRefreshInput,
  type AgentSessionLiveReplyApprovalInput,
  type AgentSessionLiveReplyQuestionInput,
  type AgentSessionLiveSnapshot,
  acceptedAgentUserMessageSchema,
  agentSessionContextUsageSchema,
  agentSessionControlForkInputSchema,
  agentSessionControlReleaseInputSchema,
  agentSessionControlResumeInputSchema,
  agentSessionControlSendInputSchema,
  agentSessionControlStartInputSchema,
  agentSessionControlStopInputSchema,
  agentSessionControlSummarySchema,
  agentSessionControlUpdateModelInputSchema,
  agentSessionLiveListInputSchema,
  agentSessionLiveLoadContextInputSchema,
  agentSessionLiveReadInputSchema,
  agentSessionLiveReadResultSchema,
  agentSessionLiveRefreshInputSchema,
  agentSessionLiveReplyApprovalInputSchema,
  agentSessionLiveReplyQuestionInputSchema,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray } from "./invoke-utils";

export class HostAgentSessionLiveClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async agentSessionControlStart(
    input: AgentSessionControlStartInput,
  ): Promise<AgentSessionControlSummary> {
    const payload = await this.invokeFn(
      "agent_session_control_start",
      agentSessionControlStartInputSchema.parse(input),
    );
    return agentSessionControlSummarySchema.parse(payload);
  }

  async agentSessionControlResume(
    input: AgentSessionControlResumeInput,
  ): Promise<AgentSessionControlSummary> {
    const payload = await this.invokeFn(
      "agent_session_control_resume",
      agentSessionControlResumeInputSchema.parse(input),
    );
    return agentSessionControlSummarySchema.parse(payload);
  }

  async agentSessionControlFork(
    input: AgentSessionControlForkInput,
  ): Promise<AgentSessionControlSummary> {
    const payload = await this.invokeFn(
      "agent_session_control_fork",
      agentSessionControlForkInputSchema.parse(input),
    );
    return agentSessionControlSummarySchema.parse(payload);
  }

  async agentSessionControlSend(
    input: AgentSessionControlSendInput,
  ): Promise<AcceptedAgentUserMessage> {
    const payload = await this.invokeFn(
      "agent_session_control_send",
      agentSessionControlSendInputSchema.parse(input),
    );
    return acceptedAgentUserMessageSchema.parse(payload);
  }

  async agentSessionControlUpdateModel(input: AgentSessionControlUpdateModelInput): Promise<void> {
    await this.invokeFn(
      "agent_session_control_update_model",
      agentSessionControlUpdateModelInputSchema.parse(input),
    );
  }

  async agentSessionControlStop(input: AgentSessionControlStopInput): Promise<void> {
    await this.invokeFn(
      "agent_session_control_stop",
      agentSessionControlStopInputSchema.parse(input),
    );
  }

  async agentSessionControlRelease(input: AgentSessionControlReleaseInput): Promise<void> {
    await this.invokeFn(
      "agent_session_control_release",
      agentSessionControlReleaseInputSchema.parse(input),
    );
  }

  async agentSessionLiveRefresh(input: AgentSessionLiveRefreshInput): Promise<void> {
    await this.invokeFn(
      "agent_session_live_refresh",
      agentSessionLiveRefreshInputSchema.parse(input),
    );
  }

  async agentSessionLiveList(
    input: AgentSessionLiveListInput,
  ): Promise<AgentSessionLiveSnapshot[]> {
    const payload = await this.invokeFn(
      "agent_session_live_list",
      agentSessionLiveListInputSchema.parse(input),
    );
    return parseArray(agentSessionLiveSnapshotSchema, payload, "agent_session_live_list");
  }

  async agentSessionLiveRead(
    input: AgentSessionLiveReadInput,
  ): Promise<AgentSessionLiveReadResult> {
    const payload = await this.invokeFn(
      "agent_session_live_read",
      agentSessionLiveReadInputSchema.parse(input),
    );
    return agentSessionLiveReadResultSchema.parse(payload);
  }

  async agentSessionLiveLoadContext(
    input: AgentSessionLiveLoadContextInput,
  ): Promise<AgentSessionContextUsage | null> {
    const payload = await this.invokeFn(
      "agent_session_live_load_context",
      agentSessionLiveLoadContextInputSchema.parse(input),
    );
    return agentSessionContextUsageSchema.nullable().parse(payload);
  }

  async agentSessionLiveReplyApproval(input: AgentSessionLiveReplyApprovalInput): Promise<void> {
    await this.invokeFn(
      "agent_session_live_reply_approval",
      agentSessionLiveReplyApprovalInputSchema.parse(input),
    );
  }

  async agentSessionLiveReplyQuestion(input: AgentSessionLiveReplyQuestionInput): Promise<void> {
    await this.invokeFn(
      "agent_session_live_reply_question",
      agentSessionLiveReplyQuestionInputSchema.parse(input),
    );
  }
}
