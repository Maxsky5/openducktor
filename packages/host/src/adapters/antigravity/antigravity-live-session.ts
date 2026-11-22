import { randomUUID } from "node:crypto";
import {
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionUpdate,
} from "@agentclientprotocol/sdk/unstable";
import {
  type AgentSessionContextUsage,
  type AgentSessionGoal,
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  type AgentSessionScope,
  type AgentSessionTranscriptEvent,
  GOAL_SLASH_COMMAND,
  type RuntimeApprovalReplyOutcome,
  type SlashCommandCatalog,
} from "@openducktor/contracts";
import {
  type AcceptedAgentUserMessage,
  type AgentEvent,
  type AgentModelSelection,
  type AgentSessionGoalCommand,
  type AgentSessionHistoryMessage,
  type AgentSessionSummary,
  classifyAgentSessionActivity,
} from "@openducktor/core";
import { withSystemPromptHistoryMessage } from "../agent-sessions/system-prompt-history-message";
import type { AntigravityAgentConnection } from "./antigravity-agent-connection";
import { ANTIGRAVITY_GOAL_STOP_MESSAGE } from "./antigravity-goal";
import {
  type AntigravityLivePublisher,
  type AntigravityPublishOptions,
  toTranscriptEvents,
} from "./antigravity-live-change";

import {
  allowAntigravityPermissionOnce,
  type AntigravityQuestionForm,
  classifyAntigravityPermission,
  isManagedMcpPermission,
  rejectAntigravityPermission,
  toAntigravityApprovalRequest,
  toAntigravityPermissionResponse,
  toAntigravityQuestionForm,
  toAntigravityQuestionResponse,
} from "./antigravity-pending-input";

import { AntigravitySessionModel } from "./antigravity-session-model";
import {
  changesAntigravitySnapshot,
  isAntigravityTurnContent,
  toAntigravityContextUsage,
  toAntigravitySlashCommandCatalog,
} from "./antigravity-session-updates";
import type { AntigravityTranscript } from "./antigravity-transcript";
import { type AntigravitySendInput, AntigravityTurns } from "./antigravity-turn";

type AntigravityPendingApproval = {
  readonly request: RequestPermissionRequest;
  readonly approval: AgentSessionLivePendingApprovalRequest;
  readonly resolve: (response: RequestPermissionResponse) => void;
};

type AntigravityPendingQuestion = {
  readonly form: AntigravityQuestionForm;
  readonly resolve: (response: CreateElicitationResponse) => void;
};

/** The identity and setup values of a session that the runtime opens. */
export type AntigravityLiveSessionInput = {
  readonly ref: AgentSessionLiveRef;
  readonly sessionScope: AgentSessionScope;
  readonly systemPrompt: string;
  readonly title: string;
  readonly startedAt: string;
  readonly callerBindingId: string;
  readonly readOnly: boolean;
  /** True when the mode setting approves the permission requests that the session gets. */
  readonly approvesRequests: boolean;
  readonly transcript: AntigravityTranscript;
};

/**
 * The live state of one session that the shared `agy acp` process holds: its transcript, model,
 * running turn, and pending input. It answers the native requests of the session and publishes
 * each change in order.
 */
export class AntigravityLiveSession {
  readonly ref: AgentSessionLiveRef;
  readonly callerBindingId: string;
  readonly model: AntigravitySessionModel;
  /**
   * True during the setup: `session/load` replays the transcript, or the saved model applies. The
   * session stays out of the live state until the setup publish admits it.
   */
  loading = true;
  private readonly sessionScope: AgentSessionScope;
  private readonly startedAt: string;
  private readonly systemPrompt: string;
  private readonly readOnly: boolean;
  private readonly approvesRequests: boolean;
  private readonly transcript: AntigravityTranscript;
  private title: string;
  /** The last command list of the session. The setup publish sends it. */
  private latestSlashCommands: SlashCommandCatalog | null = null;
  private usage: AgentSessionContextUsage | null = null;
  private readonly pendingApprovals = new Map<string, AntigravityPendingApproval>();
  private readonly pendingQuestions = new Map<string, AntigravityPendingQuestion>();
  private readonly turns: AntigravityTurns;
  /** True while the stop message of a goal clear runs, so the goal no longer shows as active. */
  private goalClearing = false;

  constructor(
    input: AntigravityLiveSessionInput,
    private readonly connection: AntigravityAgentConnection,
    private readonly publisher: AntigravityLivePublisher,
  ) {
    this.ref = input.ref;
    this.callerBindingId = input.callerBindingId;
    this.sessionScope = input.sessionScope;
    this.startedAt = input.startedAt;
    this.systemPrompt = input.systemPrompt;
    this.readOnly = input.readOnly;
    this.approvesRequests = input.approvesRequests;
    this.transcript = input.transcript;
    this.title = input.title;
    this.model = new AntigravitySessionModel(connection, input.ref.externalSessionId);
    this.turns = new AntigravityTurns({
      ref: input.ref,
      connection,
      transcript: input.transcript,
      model: this.model,
      publish: (events) => this.publishInBackground(events),
      cancelPendingInput: () => this.cancelPendingInput(),
    });
  }

  /** True when the runtime holds the session with an open prompt. ACP has no status read. */
  get running(): boolean {
    return this.turns.running;
  }

  get contextUsage(): AgentSessionContextUsage | null {
    return this.usage;
  }

  snapshot(): AgentSessionLiveSnapshot {
    const pendingApprovals = [...this.pendingApprovals.values()].map((entry) => entry.approval);
    const pendingQuestions = [...this.pendingQuestions.values()].map((entry) => entry.form.request);
    const snapshot: AgentSessionLiveSnapshot = {
      ref: this.ref,
      activity: classifyAgentSessionActivity({
        runtimeActivity: this.turns.running ? "running" : "idle",
        pendingApprovals,
        pendingQuestions,
      }),
      title: this.title,
      startedAt: this.startedAt,
      pendingApprovals,
      pendingQuestions,
      contextUsage: this.usage,
    };
    if (this.sessionScope.kind === "repository") snapshot.repositoryScope = this.sessionScope;
    if (this.model.selection) snapshot.model = this.model.selection;
    const goal = this.goalSnapshot();
    if (goal) snapshot.goal = goal;
    return snapshot;
  }

  /**
   * The goal state that the snapshot shows. Antigravity continues a goal only while it works, or
   * with the next user message. A goal that the agent completed is complete, and a goal that it
   * cancelled without the stop message of OpenDucktor ended.
   */
  private goalSnapshot(): AgentSessionGoal | undefined {
    const goal = this.transcript.goal;
    if (!goal) return undefined;
    const { objective } = goal;
    if (goal.end === "met") return { objective, status: "complete" };
    if (goal.end === "cancelled")
      return { objective, status: "ended", reason: "The agent cancelled the goal." };
    return {
      objective,
      status: this.turns.running && !this.goalClearing ? "active" : "waiting_for_message",
    };
  }

  summary(): AgentSessionSummary {
    const summary: AgentSessionSummary = {
      externalSessionId: this.ref.externalSessionId,
      runtimeKind: "antigravity",
      workingDirectory: this.ref.workingDirectory,
      title: this.title,
      sessionAssociation: this.sessionScope,
      startedAt: this.startedAt,
      status: this.turns.running ? "running" : "idle",
    };
    if (this.model.selection) summary.model = this.model.selection;
    return summary;
  }

  /** The live projection of the history, with the initial instructions first. */
  history(): AgentSessionHistoryMessage[] {
    return withSystemPromptHistoryMessage(
      `antigravity-system-prompt:${this.ref.externalSessionId}`,
      { systemPrompt: this.systemPrompt, startedAt: this.startedAt },
      structuredClone(this.transcript.history),
    );
  }

  /** Keeps the native model values that `session/new` or `session/load` reported. */
  open(configOptions: readonly SessionConfigOption[] | null | undefined): void {
    this.model.open(configOptions);
  }

  /** Ends the `session/load` replay of the transcript. */
  finishReplay(): void {
    this.transcript.finishReplay();
  }

  /**
   * Ends the setup: applies the selected model, then publishes the session with its last command
   * list. A setup with no model keeps the native model of the session.
   */
  async completeSetup(
    model: AgentModelSelection | undefined,
    options: AntigravityPublishOptions,
  ): Promise<void> {
    if (model) await this.model.select(model);
    this.loading = false;
    await this.publish([], options, true);
  }

  /** Selects a model. `null` restores the native model of the session when it opened. */
  async selectModel(model: AgentModelSelection | null): Promise<void> {
    await this.model.select(model);
    await this.publish([]);
  }

  /**
   * Applies an update of the session. A loading session keeps the replay. A live session publishes
   * what changed. Both keep the last command list for the setup publish.
   */
  applyUpdate(update: SessionUpdate): void {
    if (this.loading) {
      this.transcript.applyUpdate(update, "replay");
      this.applyState(update);
      return;
    }
    if (isAntigravityTurnContent(update)) this.turns.acceptStart();
    const slashCommandsChanged = this.applyState(update);
    const events = this.transcript.applyUpdate(update, "live");
    if (events.length === 0 && !slashCommandsChanged && !changesAntigravitySnapshot(update)) return;
    this.publishInBackground(events, {}, slashCommandsChanged);
  }

  /** Applies the session state of an update. Returns true when the command list changed. */
  private applyState(update: SessionUpdate): boolean {
    switch (update.sessionUpdate) {
      case "usage_update":
        this.usage = toAntigravityContextUsage(update, this.model.selection);
        return false;
      case "session_info_update":
        // A Workspace Session keeps the title that OpenDucktor saved.
        if (update.title && this.sessionScope.kind !== "repository") this.title = update.title;
        return false;
      case "available_commands_update":
        this.latestSlashCommands = toAntigravitySlashCommandCatalog(update);
        return true;
      default:
        return false;
    }
  }

  /** Publishes the snapshot and events of the session, with its command list when it is asked. */
  private async publish(
    events: AgentEvent[],
    options: AntigravityPublishOptions = {},
    withSlashCommands = false,
  ): Promise<void> {
    await this.publisher({
      snapshots: [this.snapshot()],
      removedRefs: [],
      events: toTranscriptEvents(this.ref, events),
      ...options,
      ...(withSlashCommands &&
        this.latestSlashCommands && {
          slashCommands: { ref: this.ref, catalog: this.latestSlashCommands },
        }),
    });
  }

  /** Publishes a change without waiting. The live adapter reports a failed publish as a fault. */
  private publishInBackground(
    events: AgentEvent[],
    options?: AntigravityPublishOptions,
    withSlashCommands?: boolean,
  ): void {
    void this.publish(events, options, withSlashCommands).catch(() => undefined);
  }

  /**
   * Answers a native permission request. Calls of the managed OpenDucktor MCP server pass, because
   * that server registers only the tools of the session role. A read-only role refuses file
   * changes. Every other request waits for the user.
   */
  handlePermission(
    params: RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    this.turns.acceptStart();
    if (isManagedMcpPermission(params))
      return Promise.resolve(allowAntigravityPermissionOnce(params));
    if (this.readOnly && classifyAntigravityPermission(params) === "mutating") {
      this.publishInBackground([
        ...this.transcript.markToolDeclined(params.toolCall.toolCallId),
        {
          type: "session_policy_notice",
          externalSessionId: this.ref.externalSessionId,
          timestamp: this.connection.now(),
          messageId: `${this.ref.externalSessionId}:read-only:${params.toolCall.toolCallId}`,
          message: "OpenDucktor refused a file change, because this workflow role is read-only.",
        },
      ]);
      return Promise.resolve(rejectAntigravityPermission(params));
    }
    if (this.approvesRequests) return Promise.resolve(allowAntigravityPermissionOnce(params));
    // The row of a file edit shows its change while the user decides.
    const preview = this.transcript.previewFileEdit(params.toolCall);
    if (preview.length > 0) this.publishInBackground(preview);
    const requestId = randomUUID();
    const { promise, resolve } = Promise.withResolvers<RequestPermissionResponse>();
    this.pendingApprovals.set(requestId, {
      request: params,
      approval: toAntigravityApprovalRequest(requestId, params),
      resolve,
    });
    signal.addEventListener(
      "abort",
      () => {
        if (!this.pendingApprovals.delete(requestId)) return;
        resolve({ outcome: { outcome: "cancelled" } });
        this.publishInBackground([]);
      },
      { once: true },
    );
    this.publishInBackground([]);
    return promise;
  }

  /** Shows an `elicitation/create` form as a question request, or declines a form it cannot show. */
  handleElicitation(
    params: CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<CreateElicitationResponse> {
    this.turns.acceptStart();
    const requestId = randomUUID();
    const form = toAntigravityQuestionForm(requestId, params);
    if (!form) {
      this.publishInBackground([
        {
          type: "session_policy_notice",
          externalSessionId: this.ref.externalSessionId,
          timestamp: this.connection.now(),
          messageId: `${this.ref.externalSessionId}:question:${requestId}`,
          message:
            "Antigravity asked a question in a form that OpenDucktor cannot show, so OpenDucktor declined it.",
        },
      ]);
      return Promise.resolve({ action: "decline" });
    }
    const { promise, resolve } = Promise.withResolvers<CreateElicitationResponse>();
    this.pendingQuestions.set(requestId, { form, resolve });
    signal.addEventListener(
      "abort",
      () => {
        if (!this.pendingQuestions.delete(requestId)) return;
        resolve({ action: "cancel" });
        this.publishInBackground([]);
      },
      { once: true },
    );
    this.publishInBackground([]);
    return promise;
  }

  pendingApproval(requestId: string): AgentSessionLivePendingApprovalRequest {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) throw new Error(`Antigravity approval '${requestId}' is no longer pending.`);
    return pending.approval;
  }

  /** Replies to the exact native request of a pending approval. */
  replyApproval(requestId: string, outcome: RuntimeApprovalReplyOutcome): Promise<void> {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) throw new Error(`Antigravity approval '${requestId}' is no longer pending.`);
    const response = toAntigravityPermissionResponse(pending.request, outcome);
    this.pendingApprovals.delete(requestId);
    const events =
      outcome === "reject"
        ? this.transcript.markToolDeclined(pending.request.toolCall.toolCallId)
        : [];
    pending.resolve(response);
    return this.publish(events);
  }

  /** Replies to the exact native request of a pending question. */
  replyQuestion(requestId: string, answers: string[][]): Promise<void> {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending) throw new Error(`Antigravity question '${requestId}' is no longer pending.`);
    const response = toAntigravityQuestionResponse(pending.form, answers);
    this.pendingQuestions.delete(requestId);
    pending.resolve(response);
    return this.publish([]);
  }

  /** Closes the pending approvals and questions of the session without a user reply. */
  private cancelPendingInput(): void {
    for (const pending of this.pendingApprovals.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingApprovals.clear();
    for (const pending of this.pendingQuestions.values()) pending.resolve({ action: "cancel" });
    this.pendingQuestions.clear();
  }

  /** Sends one message as a new turn or as a steer of the running turn. */
  send(input: AntigravitySendInput): Promise<AcceptedAgentUserMessage> {
    this.goalClearing = false;
    return this.turns.send(input);
  }

  /**
   * Runs a goal action as a message. `set` sends `/goal <objective>`, and a new goal replaces the
   * goal before it. Antigravity has no clear command: `clear` removes a goal that already ended, or
   * sends the stop message that its documentation names, and the goal leaves when the agent cancels
   * it. A running turn gets the message as a steer.
   */
  async controlGoal(
    command: Extract<AgentSessionGoalCommand, { kind: "set" | "clear" }>,
    options: Omit<AntigravitySendInput, "parts" | "delivery">,
  ): Promise<void> {
    const delivery = this.turns.running ? "steer" : "new_turn";
    if (command.kind === "set") {
      this.goalClearing = false;
      await this.turns.send({
        ...options,
        parts: [
          { kind: "slash_command", command: GOAL_SLASH_COMMAND },
          { kind: "text", text: command.objective },
        ],
        delivery,
      });
      return;
    }
    if (this.transcript.forgetEndedGoal()) {
      await this.publish([]);
      return;
    }
    if (!this.transcript.goal) return;
    this.goalClearing = true;
    try {
      await this.turns.send({
        ...options,
        parts: [{ kind: "text", text: ANTIGRAVITY_GOAL_STOP_MESSAGE }],
        delivery,
      });
    } catch (cause) {
      this.goalClearing = false;
      this.publishInBackground([]);
      throw cause;
    }
  }

  /** Stops the running turn and waits until the runtime ends it, within the deadline. */
  stop(deadlineMs: number): Promise<void> {
    return this.turns.stop(deadlineMs);
  }

  /** Drops the running turn of a session that leaves the runtime. */
  close(reason: string): void {
    this.turns.close(reason);
  }

  /** The terminal events of a turn that the runtime stopped running. */
  settle(reason: string): AgentSessionTranscriptEvent[] {
    return this.turns.settle(reason);
  }
}
