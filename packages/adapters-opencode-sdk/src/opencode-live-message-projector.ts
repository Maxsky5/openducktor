import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageCompaction,
  SessionMessageSynthetic,
  SessionInboxInfo,
  SessionMessageToolStateCompleted,
  SessionMessageToolStateError,
  ToolContent,
  ToolContent1,
  V2Event,
} from "@opencode/client";
import type { AgentToolDenial } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentSessionHistoryMessage,
} from "@openducktor/core";
import {
  iso,
  assistantPartEvents,
  messageEvents,
  messageProjectionContext,
  projectInboxUser,
  projectVisibleInboxUser,
  projectMessages,
  waitingNotice,
} from "./opencode-message-projection";
import { isJobNotice } from "./opencode-job-projection";
import {
  openCodeStepStartedAt,
  type OpenCodeTurnRateEvidence,
} from "./opencode-turn-generation-rate";
import { isShellNotice } from "./opencode-shell-projection";

export class OpenCodeLiveMessageProjector {
  readonly messages = new Map<string, SessionMessageInfo>();
  readonly inbox = new Map<string, SessionInboxInfo>();
  /** Inputs that arrived in an idle session with no input ahead, so they start the turn. */
  private readonly startedTurns = new Set<string>();
  private readonly settledText = new Set<string>();
  private readonly settledInput = new Set<string>();
  private readonly retractedIds = new Set<string>();
  private unmarkedExecutionEnds = new Set<string>();
  // Older servers keep time.created when they restart a step with the same ID.
  private readonly legacyRestarts = new Map<string, number>();
  /** The permission prompts of running calls, by call ID. */
  private readonly asks = new Map<string, { requestId: string; roleRejected: boolean }>();
  private readonly denials = new Map<string, AgentToolDenial>();
  private projectionContext: ReturnType<OpenCodeLiveMessageProjector["createProjectionContext"]>;

  constructor(private readonly legacyTurnBoundaries = false) {
    this.projectionContext = this.createProjectionContext(this.messages.values());
  }

  /** Records the permission prompt that OpenCode raised for a tool call. */
  recordApprovalAsk(requestId: string, callId: string): void {
    // A snapshot read can list a prompt again; keep its role reject.
    if (this.asks.get(callId)?.requestId === requestId) return;
    this.asks.set(callId, { requestId, roleRejected: false });
  }

  /** Records that the host rejects the prompt for the read-only role, not for the user. */
  recordRoleReject(requestId: string): void {
    for (const ask of this.asks.values()) if (ask.requestId === requestId) ask.roleRejected = true;
  }

  /**
   * History can lag live events and omit tool progress.
   * Keep live updates and drop reverted calls without changing the live transcript.
   */
  projectHistory(
    messages: SessionMessageInfo[],
    inbox: readonly SessionInboxInfo[] = [],
    rateEvidence?: OpenCodeTurnRateEvidence,
  ): AgentSessionHistoryMessage[] {
    const history = messages.filter((message) => !this.retractedIds.has(message.id));
    const settledInput = new Set(this.settledInput);
    for (const message of history) {
      if (message.type !== "assistant") continue;
      for (const part of message.content)
        if (
          part.type === "tool" &&
          part.state.status === "streaming" &&
          part.state.input.length > 0
        )
          settledInput.add(part.id);
    }
    const merged = history.map((message) =>
      keepLiveMessage(message, this.messages.get(message.id), this.settledInput),
    );
    const ids = new Set(history.map((message) => message.id));
    for (const message of this.messages.values()) {
      if (ids.has(message.id)) continue;
      if (
        (message.type === "assistant" && message.content.some((part) => part.type === "tool")) ||
        message.type === "shell" ||
        isShellNotice(message) ||
        isJobNotice(message)
      )
        merged.push(message);
    }
    const waiting = new Map(inbox.map((item) => [item.id, item] as const));
    for (const item of this.inbox.values()) waiting.set(item.id, item);
    const context = messageProjectionContext(merged, waiting.values(), {
      messages: history,
      ...rateEvidence,
    });
    const completions = new Map(context.completions);
    for (const [callID, completion] of this.projectionContext.completions) {
      const saved = completions.get(callID);
      if (!saved || saved.created < completion.created) completions.set(callID, completion);
    }
    const completedReplies = new Set([
      ...context.completedReplies,
      ...this.projectionContext.completedReplies,
    ]);
    return projectMessages(
      merged,
      { ...context, completions, completedReplies, denials: this.denials },
      settledInput,
    );
  }

  /**
   * Returns the user message of an input that the event stream already showed, queued or
   * delivered, or null when the stream did not show it.
   */
  acceptedUserMessage(sessionID: string, id: string): AcceptedAgentUserMessage | null {
    const queued = this.inbox.get(id);
    if (queued?.type === "user")
      return projectInboxUser(queued, this.startedTurns.has(id) ? "read" : "queued");
    const delivered = this.messages.get(id);
    if (delivered?.type !== "user") return null;
    const { id: _id, time, type: _type, ...payload } = delivered;
    return projectInboxUser({ id, sessionID, time, payload }, "read");
  }

  /**
   * Replace the baseline and keep unsaved live updates on matching messages.
   * Return removed message IDs so the caller can drop stale transcript rows.
   */
  seed(messages: SessionMessageInfo[], unmarkedExecutionEnds?: ReadonlySet<string>): string[] {
    this.unmarkedExecutionEnds = new Set(unmarkedExecutionEnds);
    const previous = new Map(this.messages);
    const settledText = new Set(this.settledText);
    const settledInput = new Set(this.settledInput);
    this.messages.clear();
    this.settledText.clear();
    this.settledInput.clear();
    for (const snapshot of messages) {
      this.retractedIds.delete(snapshot.id);
      const live = previous.get(snapshot.id);
      const message = keepLiveMessage(
        keepLiveStepTiming(structuredClone(snapshot), live, this.legacyRestarts.get(snapshot.id)),
        live,
        settledInput,
      );
      this.messages.set(message.id, message);
      if (message.type !== "assistant") continue;
      let textOrdinal = 0;
      let reasoningOrdinal = 0;
      const liveParts = live?.type === "assistant" ? live.content : [];
      for (const part of message.content) {
        // Native history stores text at text.ended, while live deltas remain ephemeral.
        if (part.type === "text") {
          if (
            part.text.length > 0 ||
            message.time.completed !== undefined ||
            settledText.has(`${message.id}:${textOrdinal}`)
          )
            this.settledText.add(`${message.id}:${textOrdinal}`);
          else {
            const prior = liveParts.filter((item) => item.type === "text")[textOrdinal];
            if (prior?.type === "text") part.text = prior.text;
          }
          textOrdinal++;
        }
        if (part.type === "reasoning") {
          if (part.time?.completed === undefined && message.time.completed === undefined) {
            const prior = liveParts.filter((item) => item.type === "reasoning")[reasoningOrdinal];
            if (prior?.type === "reasoning") part.text = prior.text;
          }
          reasoningOrdinal++;
        }
        if (part.type === "tool" && part.state.status === "streaming") {
          const prior = liveParts.find((item) => item.type === "tool" && item.id === part.id);
          // OpenCode saves streaming input at input.ended; live deltas can still be partial.
          const nativePart =
            snapshot.type === "assistant"
              ? snapshot.content.find((item) => item.type === "tool" && item.id === part.id)
              : undefined;
          const hasSavedInput =
            nativePart?.type === "tool" &&
            nativePart.state.status === "streaming" &&
            nativePart.state.input.length > 0;
          if (hasSavedInput || settledInput.has(part.id)) this.settledInput.add(part.id);
          else if (prior?.type === "tool" && prior.state.status === "streaming")
            part.state.input = prior.state.input;
        }
      }
    }
    this.updateProjectionContext();
    return [...previous.keys()].filter((id) => !this.messages.has(id));
  }
  snapshotEvents(sessionID: string): AgentEvent[] {
    return [...this.messages.values()].flatMap((message) =>
      messageEvents(sessionID, message, this.projectionContext, this.settledInput),
    );
  }
  /**
   * Applies one event. `idle` is true when no native execution runs. An input that arrives then,
   * with no earlier input waiting, starts the turn, so it shows as read at once. Any other input
   * stays queued until OpenCode delivers it.
   */
  apply(event: V2Event, idle = false): AgentEvent[] {
    if (!("sessionID" in event.data)) return [];
    const sessionID = event.data.sessionID;
    if (sessionID === null) return [];
    const created = "created" in event ? event.created : Date.now();
    const base = { externalSessionId: sessionID, timestamp: iso(created) };
    const data = event.data;
    if (event.type === "session.inbox.enqueued") {
      const item: SessionInboxInfo = {
        id: event.data.inboxID,
        sessionID,
        time: { created },
        ...event.data.item,
      };
      const startsTurn = idle && this.inbox.size === 0;
      this.inbox.set(item.id, item);
      if (startsTurn) this.startedTurns.add(item.id);
      if (item.type !== "synthetic")
        return projectVisibleInboxUser(item, startsTurn ? "read" : "queued");
      // A result notice shows on the card of its call while it waits for delivery.
      this.updateProjectionContext();
      return this.resultCardEvents(sessionID, waitingNotice(item));
    }
    if (event.type === "session.inbox.cancelled") {
      const cancelled = this.inbox.get(event.data.inboxID);
      this.inbox.delete(event.data.inboxID);
      this.startedTurns.delete(event.data.inboxID);
      // The card keeps the result of a cancelled notice until it shows again: Stop session queues
      // the same result again with no wake, so its card does not flicker.
      if (cancelled?.type === "synthetic") this.updateProjectionContext();
      return [{ ...base, type: "transcript_retracted", messageIds: [event.data.inboxID] }];
    }
    if (event.type === "session.inbox.delivered") {
      const item = this.inbox.get(event.data.inboxID);
      if (!item) return [];
      this.inbox.delete(item.id);
      this.startedTurns.delete(item.id);
      if (item.type === "synthetic")
        return this.recordMessage(sessionID, {
          id: item.id,
          time: { created },
          type: "synthetic",
          ...item.payload,
        });
      if (item.type !== "user") return [];
      const message: Extract<SessionMessageInfo, { type: "user" }> = {
        id: item.id,
        time: { created },
        type: "user",
        ...item.payload,
      };
      this.messages.set(message.id, message);
      return projectVisibleInboxUser({ ...item, time: { created } }, "read");
    }
    if (event.type === "session.step.started") {
      const message: SessionMessageAssistant = {
        id: event.data.assistantMessageID,
        type: "assistant",
        agent: event.data.agent,
        model: event.data.model,
        time: { created: openCodeStepStartedAt(event) },
        content: [],
      };
      const existing = this.messages.get(message.id);
      if (existing?.type === "assistant") {
        if (message.time.created <= (this.legacyRestarts.get(message.id) ?? existing.time.created))
          return [];
        const supersededRate = this.projectionContext.generationRates.has(message.id);
        this.unmarkedExecutionEnds.delete(message.id);
        existing.agent = message.agent;
        existing.model = message.model;
        if (event.data.started === undefined) {
          this.legacyRestarts.set(message.id, message.time.created);
          existing.time = { created: existing.time.created };
        } else {
          existing.time = message.time;
        }
        delete existing.error;
        delete existing.finish;
        delete existing.tokens;
        this.updateProjectionContext();
        const updates = messageEvents(
          sessionID,
          existing,
          this.projectionContext,
          this.settledInput,
        );
        return supersededRate
          ? [{ ...base, type: "transcript_retracted", messageIds: [message.id] }, ...updates]
          : updates;
      }
      this.messages.set(message.id, message);
      this.updateProjectionContext();
      return messageEvents(sessionID, message, this.projectionContext, this.settledInput);
    }
    const messageID = "assistantMessageID" in data ? data.assistantMessageID : undefined;
    const message = messageID ? this.messages.get(messageID) : undefined;
    if (message?.type === "assistant") {
      if (event.type === "session.step.first-token" || event.type === "session.step.streamed") {
        if (event.type === "session.step.first-token") message.time.firstToken = created;
        else message.time.streamed = created;
        return [];
      }
      const toolID = "id" in data ? data.id : undefined;
      const tool = message.content.find((part) => part.type === "tool" && part.id === toolID);
      const ordinal = "ordinal" in data ? data.ordinal : undefined;
      const text = message.content.filter((part) => part.type === "text").at(ordinal ?? -1);
      const reasoning = message.content
        .filter((part) => part.type === "reasoning")
        .at(ordinal ?? -1);
      const textKey = `${message.id}:${ordinal}`;
      switch (event.type) {
        case "session.text.started":
          if (!text) message.content.push({ type: "text", text: "" });
          break;
        case "session.text.delta":
          if (text?.type === "text" && !this.settledText.has(textKey))
            text.text += event.data.delta;
          break;
        case "session.text.ended":
          if (text?.type === "text" && !this.settledText.has(textKey)) {
            text.text = event.data.text;
            this.settledText.add(textKey);
          }
          break;
        case "session.reasoning.started":
          if (!reasoning) message.content.push({ type: "reasoning", text: "", time: { created } });
          break;
        case "session.reasoning.delta":
          if (reasoning?.type === "reasoning" && reasoning.time?.completed === undefined)
            reasoning.text += event.data.delta;
          break;
        case "session.reasoning.ended":
          if (reasoning?.type === "reasoning") {
            reasoning.text = event.data.text;
            reasoning.time = { created: reasoning.time?.created ?? created, completed: created };
          }
          break;
        case "session.tool.input.started":
          if (!tool)
            message.content.push({
              type: "tool",
              id: event.data.id,
              name: event.data.name,
              time: { created },
              state: { status: "streaming", input: "" },
            });
          break;
        case "session.tool.input.delta":
          if (
            tool?.type === "tool" &&
            tool.state.status === "streaming" &&
            !this.settledInput.has(tool.id)
          )
            tool.state.input += event.data.delta;
          break;
        case "session.tool.input.ended":
          if (tool?.type === "tool" && tool.state.status === "streaming") {
            tool.state.input = event.data.text;
            this.settledInput.add(tool.id);
          }
          break;
        case "session.tool.called":
          if (tool?.type === "tool" && tool.state.status === "streaming") {
            tool.time.ran = created;
            tool.state = { status: "running", input: event.data.input, metadata: {} };
          }
          break;
        case "session.tool.progress":
          if (tool?.type === "tool" && tool.state.status === "running")
            tool.state.metadata = event.data.metadata;
          break;
        case "session.tool.success":
          if (tool?.type === "tool" && tool.state.status === "running") {
            tool.time.completed = created;
            const state: SessionMessageToolStateCompleted = {
              status: "completed",
              input: tool.state.input,
              content: resultContent(event.data.content),
            };
            if (event.data.metadata) state.metadata = event.data.metadata;
            tool.state = state;
            this.asks.delete(tool.id);
          }
          break;
        case "session.tool.failed":
          if (
            tool?.type === "tool" &&
            (tool.state.status === "streaming" || tool.state.status === "running")
          ) {
            tool.time.completed = created;
            const state: SessionMessageToolStateError = {
              status: "error",
              input: tool.state.status === "streaming" ? {} : tool.state.input,
              error: event.data.error,
            };
            if (event.data.content) state.content = resultContent(event.data.content);
            if (event.data.metadata) state.metadata = event.data.metadata;
            tool.state = state;
            this.recordDenial(tool.id, event.data.error);
          }
          break;
        case "session.step.ended":
          message.time.completed = created;
          message.finish = event.data.finish;
          message.tokens = event.data.tokens;
          message.cost = event.data.cost;
          break;
        case "session.step.failed":
          message.time.completed = created;
          message.error = event.data.error;
          if (event.data.tokens !== undefined && event.data.cost !== undefined) {
            message.tokens = event.data.tokens;
            message.cost = event.data.cost;
          }
          break;
        default:
          return [];
      }
      switch (event.type) {
        case "session.text.started":
        case "session.text.delta":
        case "session.text.ended":
          return assistantPartEvents(
            sessionID,
            message,
            { type: "text", ordinal: event.data.ordinal },
            this.projectionContext,
            this.settledInput,
          );
        case "session.reasoning.started":
        case "session.reasoning.delta":
        case "session.reasoning.ended":
          return assistantPartEvents(
            sessionID,
            message,
            { type: "reasoning", ordinal: event.data.ordinal },
            this.projectionContext,
            this.settledInput,
          );
        case "session.tool.input.started":
        case "session.tool.input.delta":
        case "session.tool.input.ended":
          return assistantPartEvents(
            sessionID,
            message,
            { type: "tool", id: event.data.id },
            this.projectionContext,
            this.settledInput,
          );
      }
      if (
        event.type === "session.tool.success" ||
        event.type === "session.tool.failed" ||
        event.type === "session.step.ended" ||
        event.type === "session.step.failed"
      )
        this.updateProjectionContext();
      return messageEvents(sessionID, message, this.projectionContext, this.settledInput);
    }
    let system: SessionMessageInfo | undefined;
    switch (event.type) {
      case "session.agent.selected":
        system = {
          id: event.id.replace(/^evt_/, "msg_"),
          type: "agent-switched",
          time: { created },
          agent: event.data.agent,
        };
        break;
      case "session.model.selected":
        system = {
          id: event.id.replace(/^evt_/, "msg_"),
          type: "model-switched",
          time: { created },
          model: event.data.model,
        };
        break;
      case "session.shell.started":
        system = {
          id: event.id.replace(/^evt_/, "msg_"),
          type: "shell",
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          time: { created },
        };
        break;
      case "session.shell.ended": {
        const shell = [...this.messages.values()].find(
          (message) => message.type === "shell" && message.shellID === event.data.shell.id,
        );
        if (shell?.type !== "shell")
          throw new Error(
            "The native shell completion has no retained start. Reload this conversation.",
          );
        system = {
          ...shell,
          status: event.data.shell.status,
          output: event.data.output,
          time: { ...shell.time, completed: created },
        };
        if (event.data.shell.exit !== undefined) system.exit = event.data.shell.exit;
        break;
      }
      case "session.synthetic":
        system = {
          id: event.id.replace(/^evt_/, "msg_"),
          type: "synthetic",
          time: { created },
          text: event.data.text,
        };
        if (event.data.description !== undefined) system.description = event.data.description;
        if (event.data.metadata) system.metadata = event.data.metadata;
        break;
      case "session.instructions.updated":
        if (event.data.text !== undefined)
          system = {
            id: event.id.replace(/^evt_/, "msg_"),
            type: "system",
            time: { created },
            text: event.data.text,
            description: `Instructions updated: ${Object.keys(event.data.delta).join(", ")}`,
            metadata: {
              ...event.metadata,
              notice: "instructions",
              instructionSources: Object.keys(event.data.delta),
            },
          };
        break;
      case "session.skill.activated":
        system = {
          id: event.id.replace(/^evt_/, "msg_"),
          type: "skill",
          time: { created },
          skill: event.data.id,
          name: event.data.name,
          text: event.data.text,
        };
        break;
      case "session.compaction.started": {
        const id = event.data.inputID ?? event.id.replace(/^evt_/, "msg_");
        if (this.messages.has(id)) return [];
        system = {
          id,
          type: "compaction",
          status: "running",
          reason: event.data.reason,
          summary: "",
          time: { created },
        };
        break;
      }
      case "session.compaction.ended": {
        const current = [...this.messages.values()].findLast(
          (item): item is SessionMessageCompaction => item.type === "compaction",
        );
        if (current && current.status !== "running") return [];
        system = {
          id: current?.id ?? event.id.replace(/^evt_/, "msg_"),
          type: "compaction",
          status: "completed",
          reason: event.data.reason,
          summary: event.data.text,
          time: current?.time ?? { created },
        };
        if (event.data.model) system.model = event.data.model;
        if (event.data.cost !== undefined) system.cost = event.data.cost;
        if (event.data.tokens) system.tokens = event.data.tokens;
        break;
      }
      case "session.compaction.failed": {
        const current = [...this.messages.values()].findLast(
          (item): item is SessionMessageCompaction => item.type === "compaction",
        );
        const id =
          current?.status === "running"
            ? current.id
            : (event.data.inputID ?? event.id.replace(/^evt_/, "msg_"));
        if (this.messages.get(id)?.type === "compaction" && current?.status === "failed") return [];
        system = {
          id,
          type: "compaction",
          status: "failed",
          reason: event.data.reason,
          error: event.data.error,
          time: current?.status === "running" ? current.time : { created },
        };
        break;
      }
      case "session.execution.failed":
      case "session.execution.succeeded":
      case "session.execution.interrupted": {
        // OpenCode keeps an execution that a shutdown interrupted, to continue it when it starts again,
        // so the turn stays unfinished with no notice. OpenCode 2.4.1 also ends a step whose
        // permission the user declined this way (`terminal` of `packages/core/src/session/execution.ts`).
        if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown")
          return [{ ...base, type: "session_status", status: { type: "idle" } }];
        const outcome =
          event.type === "session.execution.succeeded"
            ? "succeeded"
            : event.type === "session.execution.failed"
              ? "failed"
              : "interrupted";
        // The record of a failed turn gives its `turn_error`, with the ID of the record.
        system = {
          id: event.id.replace(/^evt_/, "msg_"),
          type: "idle",
          outcome,
          time: { created },
        };
        if (event.type === "session.execution.failed") system.error = event.data.error;
        if (event.metadata !== undefined) system.metadata = event.metadata;
        const recorded = this.recordMessage(sessionID, system);
        // The interruption notice is the idle event of an interrupted turn.
        if (outcome === "interrupted")
          return recorded.map((recordedEvent) =>
            recordedEvent.type === "session_idle"
              ? { ...recordedEvent, turnOutcome: "interrupted" }
              : recordedEvent,
          );
        return [
          ...recorded,
          {
            ...base,
            type: "session_idle",
            turnOutcome: outcome === "succeeded" ? "completed" : "failed",
          },
        ];
      }
      case "session.execution.started":
        return [{ ...base, type: "session_status", status: { type: "busy", message: null } }];
      case "session.status":
        return [
          {
            ...base,
            type: "session_status",
            status:
              event.data.status.type === "retry"
                ? {
                    type: "retry",
                    attempt: event.data.status.attempt,
                    message: event.data.status.message,
                    nextEpochMs: event.data.status.next,
                  }
                : event.data.status.type === "busy"
                  ? { type: "busy", message: null }
                  : { type: "idle" },
          },
        ];
      case "session.idle":
        return [{ ...base, type: "session_idle" }];
      case "session.revert.committed": {
        const ids = [...this.messages.keys()];
        const index = ids.indexOf(event.data.to);
        if (index < 0)
          throw new Error(
            "The native reversion target is absent from the retained transcript. Reload this conversation.",
          );
        const removed = ids.slice(index);
        for (const id of removed) {
          this.messages.delete(id);
          this.legacyRestarts.delete(id);
          this.unmarkedExecutionEnds.delete(id);
          this.retractedIds.add(id);
        }
        this.updateProjectionContext();
        return [{ ...base, type: "transcript_retracted", messageIds: removed }];
      }
    }
    return system ? this.recordMessage(sessionID, system) : [];
  }

  /** Updates the results of the call cards after a change of the messages or of the inbox. */
  updateProjectionContext(): void {
    this.projectionContext = this.createProjectionContext(this.messages.values());
  }

  private createProjectionContext(messages: Iterable<SessionMessageInfo>) {
    return {
      ...messageProjectionContext(messages, this.inbox.values(), {
        legacy: this.legacyTurnBoundaries,
        unmarkedExecutionEnds: this.unmarkedExecutionEnds,
      }),
      denials: this.denials,
    };
  }

  /**
   * OpenCode fails a call with `permission.rejected` for a deny rule and for a rejected prompt
   * with a message. With no prompt, a deny rule denied the call. After a prompt, only a host
   * reject for the read-only role is a denial; a user reject stays a plain rejected call.
   */
  private recordDenial(callId: string, error: SessionMessageToolStateError["error"]): void {
    const ask = this.asks.get(callId);
    this.asks.delete(callId);
    if (error.type !== "permission.rejected") return;
    if (ask && !ask.roleRejected) return;
    const denial: AgentToolDenial = { source: ask ? "read_only_role" : "permission_settings" };
    if (error.message) denial.reason = error.message;
    this.denials.set(callId, denial);
  }

  /** The events of the call cards whose result is the notice `message`. */
  private resultCardEvents(sessionID: string, message: SessionMessageSynthetic): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (message.metadata?.source === "subagent") {
      for (const assistant of this.messages.values()) {
        if (
          assistant.type !== "assistant" ||
          !assistant.content.some(
            (part) =>
              part.type === "tool" &&
              part.name === "subagent" &&
              "metadata" in part.state &&
              part.state.metadata?.sessionID === message.metadata?.childID,
          )
        )
          continue;
        events.push(
          ...messageEvents(sessionID, assistant, this.projectionContext, this.settledInput).filter(
            (event) => event.type === "assistant_part" && event.part.kind === "subagent",
          ),
        );
      }
    }
    if (isJobNotice(message)) {
      for (const owner of this.messages.values()) {
        if (owner.type !== "assistant") continue;
        for (const part of owner.content)
          if (
            part.type === "tool" &&
            this.projectionContext.jobs.results.get(part.id)?.noticeId === message.id
          )
            events.push(
              ...assistantPartEvents(
                sessionID,
                owner,
                { type: "tool", id: part.id },
                this.projectionContext,
                this.settledInput,
              ),
            );
      }
    }
    if (isShellNotice(message)) {
      for (const owner of this.messages.values()) {
        if (
          owner.type === "shell" &&
          this.projectionContext.shells.signals.get(owner.shellID)?.noticeId === message.id
        ) {
          events.push(
            ...messageEvents(sessionID, owner, this.projectionContext, this.settledInput),
          );
        }
        if (owner.type !== "assistant") continue;
        for (const part of owner.content) {
          if (
            part.type !== "tool" ||
            this.projectionContext.shells.results.get(part.id)?.noticeId !== message.id
          )
            continue;
          events.push(
            ...assistantPartEvents(
              sessionID,
              owner,
              { type: "tool", id: part.id },
              this.projectionContext,
              this.settledInput,
            ),
          );
        }
      }
    }
    return events;
  }

  private recordMessage(sessionID: string, message: SessionMessageInfo): AgentEvent[] {
    const completedReplies = this.projectionContext.completedReplies;
    this.messages.set(message.id, message);
    if (message.type === "synthetic" || message.type === "idle") this.updateProjectionContext();
    const events = messageEvents(sessionID, message, this.projectionContext, this.settledInput);
    if (message.type === "idle" && message.outcome === "succeeded") {
      for (const id of this.projectionContext.completedReplies) {
        if (completedReplies.has(id)) continue;
        const reply = this.messages.get(id);
        if (reply)
          events.push(
            ...messageEvents(sessionID, reply, this.projectionContext, this.settledInput).filter(
              (event) => event.type === "assistant_message",
            ),
          );
      }
    }
    if (message.type === "synthetic") events.push(...this.resultCardEvents(sessionID, message));
    return events;
  }
}

/** An older baseline can miss live timing, or show the previous attempt of a restarted step. */
const keepLiveStepTiming = (
  saved: SessionMessageInfo,
  live: SessionMessageInfo | undefined,
  legacyRestartAt: number | undefined,
): SessionMessageInfo => {
  if (saved.type !== "assistant" || live?.type !== "assistant") return saved;
  if (saved.time.created < live.time.created) return live;
  if (saved.time.created !== live.time.created) return saved;

  const savedStreamEnd = saved.time.streamed;
  const savedCompletion = saved.time.completed;
  if (
    legacyRestartAt !== undefined &&
    ((savedStreamEnd !== undefined && savedStreamEnd < legacyRestartAt) ||
      (savedCompletion !== undefined && savedCompletion < legacyRestartAt))
  )
    return live;

  const message = { ...saved, time: { ...live.time, ...saved.time } };
  if (live.time.completed !== undefined && savedCompletion === undefined) {
    if (live.finish !== undefined) message.finish = live.finish;
    if (live.error !== undefined) message.error = live.error;
    if (live.tokens !== undefined) message.tokens = live.tokens;
  }
  return message;
};

/** Keep unsaved live progress, but use saved final results. */
const keepLiveMessage = (
  message: SessionMessageInfo,
  live: SessionMessageInfo | undefined,
  settledInput: ReadonlySet<string>,
): SessionMessageInfo => {
  if (
    message.type === "shell" &&
    live?.type === "shell" &&
    message.status === "running" &&
    live.status !== "running"
  )
    return live;
  if (message.type !== "assistant" || live?.type !== "assistant") return message;
  const liveTools = new Map(
    live.content.filter((part) => part.type === "tool").map((part) => [part.id, part] as const),
  );
  const content = message.content.map((part) => {
    if (part.type !== "tool") return part;
    const prior = liveTools.get(part.id);
    liveTools.delete(part.id);
    if (!prior) return part;
    if (part.state.status === "completed" || part.state.status === "error") {
      if (prior.state.status === "streaming" || !prior.state.metadata) return part;
      let metadata = prior.state.metadata;
      // Progress alone cannot confirm that a foreground call finished in the background.
      if (
        part.name === "subagent" &&
        part.state.status === "completed" &&
        prior.state.status === "running" &&
        part.state.input.background !== true
      ) {
        const { status: _status, ...progress } = metadata;
        metadata = progress;
      }
      return {
        ...part,
        state: { ...part.state, metadata: { ...metadata, ...part.state.metadata } },
      };
    }
    if (part.state.status === "streaming") {
      if (prior.state.status === "streaming" && !settledInput.has(prior.id)) return part;
      return prior;
    }
    if (prior.state.status === "streaming") return part;
    if (prior.state.status === "completed" || prior.state.status === "error") return prior;
    return {
      ...part,
      state: { ...part.state, metadata: { ...part.state.metadata, ...prior.state.metadata } },
    };
  });
  return {
    ...message,
    content: liveTools.size === 0 ? content : insertMissingTools(content, live.content),
  };
};

/** Tool IDs and text or reasoning ordinals stay stable when history omits live tools. */
const insertMissingTools = (
  content: SessionMessageAssistant["content"],
  live: SessionMessageAssistant["content"],
): SessionMessageAssistant["content"] => {
  const positions = new Map(contentKeys(content).map((key, index) => [key, index]));
  const inserts = new Map<number, SessionMessageAssistant["content"]>();
  const keys = contentKeys(live);
  let pending: SessionMessageAssistant["content"] = [];
  let after = 0;
  for (const [index, part] of live.entries()) {
    const at = positions.get(keys[index]!);
    if (at === undefined) {
      if (part.type === "tool") pending.push(part);
      continue;
    }
    if (pending.length > 0) {
      const group = inserts.get(at);
      if (group) group.push(...pending);
      else inserts.set(at, pending);
      pending = [];
    }
    after = at + 1;
  }
  if (pending.length > 0) {
    const group = inserts.get(after);
    if (group) group.push(...pending);
    else inserts.set(after, pending);
  }
  const merged = content.flatMap((part, index) => [...(inserts.get(index) ?? []), part]);
  merged.push(...(inserts.get(content.length) ?? []));
  return merged;
};

const contentKeys = (content: SessionMessageAssistant["content"]): string[] => {
  const ordinals = { text: 0, reasoning: 0 };
  return content.map((part) =>
    part.type === "tool" ? `tool:${part.id}` : `${part.type}:${ordinals[part.type]++}`,
  );
};

const resultContent = ([first, ...rest]: [ToolContent1, ...ToolContent1[]]): [
  ToolContent,
  ...ToolContent[],
] => {
  const map = (item: ToolContent1): ToolContent => {
    if (item.type === "text") return { type: "text", text: item.text };
    const file: Extract<ToolContent, { type: "file" }> = {
      type: "file",
      uri: item.uri,
      mime: item.mime,
    };
    if (item.name !== undefined) file.name = item.name;
    return file;
  };
  return [map(first), ...rest.map(map)];
};
