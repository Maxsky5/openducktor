import type {
  ContentBlock,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk/unstable";
import type { AgentTurnOutcome } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentModelSelection,
  AgentSessionHistoryMessage,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import { ANTIGRAVITY_COMPACT_COMMAND, compactionNotice } from "./antigravity-compaction";
import {
  ANTIGRAVITY_GOAL_STOP_MESSAGE,
  type AntigravityGoal,
  type AntigravityGoalEnd,
  pendingAntigravityGoalMarkerLength,
  readAntigravityGoalObjective,
  stripAntigravityGoalMarkers,
} from "./antigravity-goal";
import {
  type AntigravityToolState,
  mergeAntigravityToolState,
  toAntigravityEditPreview,
  toAntigravityToolPart,
} from "./antigravity-tool-parts";

const SLASH_COMMAND_ONLY = /^\/\S+$/;

type OpenItem = {
  readonly kind: "text" | "reasoning";
  readonly messageId: string;
  /** The shown text. A text item shows its stream without the goal markers. */
  text: string;
  /** The streamed text of a text item, with its goal markers. */
  raw: string;
  /** The goal markers of the item that the transcript already applied. */
  markers: number;
};

/** A user message of the transcript, in the form that the live event and history share. */
export type AntigravityUserMessage = {
  readonly text: string;
  readonly displayParts: AgentUserMessageDisplayPart[];
};

/** A live user message and the events that closed the item before it. */
export type AntigravityLiveUserMessage = {
  readonly closedItems: AgentEvent[];
  readonly userMessage: AcceptedAgentUserMessage;
};

/**
 * Projects the ACP updates of one session into transcript events and history messages. Live
 * updates and the `session/load` replay go through the same projector, so both give the same IDs.
 *
 * IDs come from the session ID, the turn index (the count of user messages, steers included), and
 * the index of the item in the turn. A new item starts at each change of update kind. Tool items
 * keep the native `toolCallId`.
 */
export class AntigravityTranscript {
  readonly history: AgentSessionHistoryMessage[] = [];
  private turn = 0;
  private itemIndex = 0;
  private openItem: OpenItem | null = null;
  private openUserMessage: { messageId: string; blocks: ContentBlock[] } | null = null;
  private lastTurnText: { messageId: string; text: string } | null = null;
  private readonly tools = new Map<string, { state: AntigravityToolState; messageId: string }>();
  private readonly declinedTools = new Set<string>();
  /** True while the transcript applies a `session/load` replay. */
  private replaying = false;
  private goalState: AntigravityGoal | null = null;
  /** True when the last user message asked the agent to stop its goal. */
  private goalStopAsked = false;

  constructor(
    private readonly sessionId: string,
    private readonly readUserChunks: (blocks: ContentBlock[]) => AntigravityUserMessage,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Starts a turn with a user message that OpenDucktor sent and the runtime admitted. The runtime
   * does not echo it, so the adapter publishes this event. A message that the runtime refuses
   * never gets here, so it changes no turn index.
   */
  addLiveUserMessage(input: {
    message: AntigravityUserMessage;
    model?: AgentModelSelection | undefined;
    /** When the user sent the message. It defaults to now. */
    sentAt?: string | undefined;
  }): AntigravityLiveUserMessage {
    const closedItems = this.closeOpenItem();
    const messageId = this.startTurn();
    const timestamp = input.sentAt ?? this.now();
    this.noteGoalMessage(input.message.text);
    const event: AcceptedAgentUserMessage = {
      type: "user_message",
      externalSessionId: this.sessionId,
      timestamp,
      messageId,
      message: input.message.text,
      parts: input.message.displayParts,
      state: "read",
    };
    if (input.model) event.model = input.model;
    const history: AgentSessionHistoryMessage = {
      messageId,
      role: "user",
      timestamp,
      text: input.message.text,
      displayParts: input.message.displayParts,
      state: "read",
      parts: [],
    };
    if (input.model) history.model = input.model;
    this.history.push(history);
    return { closedItems, userMessage: event };
  }

  /** The goal of the session, from its user messages and the goal markers of the replies. */
  get goal(): AntigravityGoal | null {
    return this.goalState;
  }

  /** Removes a goal that the agent already ended. It returns false when no ended goal is set. */
  forgetEndedGoal(): boolean {
    if (!this.goalState?.end) return false;
    this.goalState = null;
    return true;
  }

  /**
   * A `/goal` message sets the goal, and a new one replaces the goal before it. The stop message
   * of OpenDucktor asks the agent to cancel the goal, so its cancel removes the goal.
   */
  private noteGoalMessage(text: string): void {
    const objective = readAntigravityGoalObjective(text);
    if (objective) this.goalState = { objective };
    this.goalStopAsked = objective === null && text.trim() === ANTIGRAVITY_GOAL_STOP_MESSAGE;
  }

  private noteGoalEnds(ends: readonly AntigravityGoalEnd[]): void {
    for (const end of ends) {
      if (!this.goalState || this.goalState.end) continue;
      this.goalState =
        end === "cancelled" && this.goalStopAsked ? null : { ...this.goalState, end };
    }
  }

  /**
   * The notice of a turn that Stop or a runtime stop ended, in history and as the interruption of
   * the turn.
   */
  addInterruptionNotice(timestamp: string, message: string) {
    const messageId = `${this.sessionId}:t${this.turn}:stopped`;
    this.history.push({
      messageId,
      role: "system",
      timestamp,
      text: message,
      notice: { tone: "cancelled", reason: "session_interrupted", title: "Interrupted" },
      parts: [],
    });
    return { messageId, message };
  }

  /** Shows a finished compaction in history as its notice, in place of its `/compact` message. */
  completeCompaction(messageId: string, timestamp: string): void {
    const index = this.history.findIndex((entry) => entry.messageId === messageId);
    if (index >= 0) this.history[index] = compactionNotice(messageId, timestamp);
  }

  /** The ID that an admitted user message gets after `ahead` other admitted messages. */
  nextUserMessageId(ahead = 0): string {
    return `${this.sessionId}:t${this.turn + 1 + ahead}:user`;
  }

  /** Marks a tool call that the user or a policy declined. */
  markToolDeclined(toolCallId: string): AgentEvent[] {
    this.declinedTools.add(toolCallId);
    const entry = this.tools.get(toolCallId);
    if (!entry) return [];
    return [this.publishTool(entry.state, entry.messageId)];
  }

  /** Applies one update. `replay` updates come from `session/load`. */
  applyUpdate(update: SessionUpdate, mode: "live" | "replay"): AgentEvent[] {
    // A replay has no times, so its history entries carry the time of the read.
    this.replaying = mode === "replay";
    switch (update.sessionUpdate) {
      case "user_message_chunk":
        // Antigravity sends user messages only in a replay. The adapter publishes live ones.
        if (mode === "replay") this.applyUserChunk(update.content);
        return [];
      case "agent_message_chunk":
        return this.applyChunk("text", update.content);
      case "agent_thought_chunk":
        return this.applyChunk("reasoning", update.content);
      case "tool_call":
      case "tool_call_update":
        return this.applyTool(update);
      default:
        return [];
    }
  }

  /**
   * Ends the replay of a `session/load`. The last replayed turn ended before the load, so its
   * last reply is final.
   */
  finishReplay(): void {
    this.flushUserMessage();
    this.closeOpenItem();
    this.markLastTextFinal();
  }

  /** Ends a live turn. It closes the open item and confirms the final reply of a completed turn. */
  finishTurn(
    outcome: AgentTurnOutcome,
    model?: AgentModelSelection,
    startedAt?: string,
  ): AgentEvent[] {
    const events = this.closeOpenItem();
    const final = this.lastTurnText;
    if (outcome === "completed" && final) {
      const event: Extract<AgentEvent, { type: "assistant_message" }> = {
        type: "assistant_message",
        externalSessionId: this.sessionId,
        timestamp: this.now(),
        messageId: final.messageId,
        message: final.text,
      };
      if (model) event.model = model;
      events.push(event);
      // History shows the final reply as the live view does: with its model and end time.
      this.markLastTextFinal({ timestamp: event.timestamp, model, startedAt });
    }
    this.lastTurnText = null;
    return events;
  }

  /** Marks the time of a history entry as approximate while a replay runs. */
  private withTimeAccuracy(entry: AgentSessionHistoryMessage): AgentSessionHistoryMessage {
    if (this.replaying) entry.timestampIsApproximate = true;
    return entry;
  }

  private startTurn(): string {
    this.turn += 1;
    this.itemIndex = 0;
    this.lastTurnText = null;
    return `${this.sessionId}:t${this.turn}:user`;
  }

  private nextItemId(): string {
    this.itemIndex += 1;
    return `${this.sessionId}:t${this.turn}:i${this.itemIndex}`;
  }

  private applyUserChunk(block: ContentBlock): void {
    // OpenDucktor sends the text of one message as one block, so a second text block in a row
    // starts the next message, for example after a `/compact` turn that replays no output.
    // Antigravity replays a slash command and its arguments as two blocks: `/name`, then the
    // arguments after a space. A sent message never starts with a space.
    const previous = this.openUserMessage?.blocks.at(-1);
    if (
      block.type === "text" &&
      previous?.type === "text" &&
      !(SLASH_COMMAND_ONLY.test(previous.text) && /^\s/.test(block.text))
    ) {
      this.flushUserMessage();
    }
    if (!this.openUserMessage) {
      this.closeOpenItem();
      this.markLastTextFinal();
      this.openUserMessage = { messageId: this.startTurn(), blocks: [] };
    }
    this.openUserMessage.blocks.push(block);
  }

  private flushUserMessage(): void {
    const open = this.openUserMessage;
    if (!open) return;
    this.openUserMessage = null;
    const message = this.readUserChunks(open.blocks);
    this.noteGoalMessage(message.text);
    // History keeps a finished compaction as its notice, as the live view shows it.
    if (message.text.trim() === ANTIGRAVITY_COMPACT_COMMAND) {
      this.history.push(
        compactionNotice(open.messageId, this.now(), { timestampIsApproximate: true }),
      );
      return;
    }
    this.history.push({
      messageId: open.messageId,
      role: "user",
      timestamp: this.now(),
      timestampIsApproximate: true,
      text: message.text,
      displayParts: message.displayParts,
      state: "read",
      parts: [],
    });
  }

  private applyChunk(kind: OpenItem["kind"], block: ContentBlock): AgentEvent[] {
    this.flushUserMessage();
    if (block.type !== "text" || block.text.length === 0) return [];
    const events: AgentEvent[] = [];
    let item = this.openItem;
    if (item?.kind !== kind) {
      events.push(...this.closeOpenItem());
      item = { kind, messageId: this.nextItemId(), text: "", raw: "", markers: 0 };
      this.openItem = item;
      this.history.push(
        this.withTimeAccuracy({
          messageId: item.messageId,
          role: "assistant",
          timestamp: this.now(),
          text: "",
          parts: [],
        }),
      );
    }
    const shownBefore = item.text;
    if (kind === "text") this.streamText(item, block.text);
    else item.text += block.text;
    this.updateItemHistory(item, false);
    const timestamp = this.now();
    if (kind === "text") {
      this.lastTurnText = { messageId: item.messageId, text: item.text };
      const delta = item.text.slice(shownBefore.length);
      if (delta.length > 0) {
        events.push({
          type: "assistant_delta",
          externalSessionId: this.sessionId,
          timestamp,
          channel: "text",
          messageId: item.messageId,
          delta,
        });
      }
    } else {
      events.push(this.reasoningEvent(item, false));
    }
    return events;
  }

  private reasoningEvent(item: OpenItem, completed: boolean): AgentEvent {
    return {
      type: "assistant_part",
      externalSessionId: this.sessionId,
      timestamp: this.now(),
      part: {
        kind: "reasoning",
        messageId: item.messageId,
        partId: `${item.messageId}:reasoning`,
        text: item.text,
        completed,
      },
    };
  }

  private updateItemHistory(item: OpenItem, completed: boolean): void {
    const message = this.history.findLast((entry) => entry.messageId === item.messageId);
    if (message?.role !== "assistant") return;
    if (item.kind === "text") {
      message.text = item.text;
      return;
    }
    message.parts = [
      {
        kind: "reasoning",
        messageId: item.messageId,
        partId: `${item.messageId}:reasoning`,
        text: item.text,
        completed,
      },
    ];
  }

  /**
   * Adds a chunk to a text item. The item shows its text without the goal markers, and holds back
   * an end that can still grow into a marker, so the shown text only grows.
   */
  private streamText(item: OpenItem, chunk: string): void {
    item.raw += chunk;
    const { text, ends } = stripAntigravityGoalMarkers(item.raw);
    this.noteGoalEnds(ends.slice(item.markers));
    item.markers = ends.length;
    item.text = text.slice(0, text.length - pendingAntigravityGoalMarkerLength(text));
  }

  private closeOpenItem(): AgentEvent[] {
    const item = this.openItem;
    if (!item) return [];
    this.openItem = null;
    // A held end that never became a marker is text of the reply.
    if (item.kind === "text") {
      item.text = stripAntigravityGoalMarkers(item.raw).text;
      if (this.lastTurnText?.messageId === item.messageId)
        this.lastTurnText = { messageId: item.messageId, text: item.text };
    }
    this.updateItemHistory(item, true);
    if (item.kind === "reasoning") return [this.reasoningEvent(item, true)];
    return [
      {
        type: "assistant_part",
        externalSessionId: this.sessionId,
        timestamp: this.now(),
        part: {
          kind: "text",
          messageId: item.messageId,
          partId: `${item.messageId}:text`,
          text: item.text,
          completed: true,
        },
      },
    ];
  }

  private markLastTextFinal(completion?: {
    readonly timestamp: string;
    readonly model: AgentModelSelection | undefined;
    /** The start of the turn. A steer adds a user message, so history cannot count from it. */
    readonly startedAt: string | undefined;
  }): void {
    const final = this.lastTurnText;
    if (!final) return;
    const message = this.history.findLast((entry) => entry.messageId === final.messageId);
    if (message?.role !== "assistant" || message.parts.some((part) => part.kind === "step")) return;
    if (completion) {
      message.timestamp = completion.timestamp;
      if (completion.model) message.model = completion.model;
      if (completion.startedAt) {
        message.durationMs = Date.parse(completion.timestamp) - Date.parse(completion.startedAt);
      }
    }
    message.parts.push({
      kind: "step",
      messageId: final.messageId,
      partId: `${final.messageId}:finish`,
      phase: "finish",
      reason: "stop",
    });
  }

  /** Shows the change of a file edit that waits for approval, when its request shows it. */
  previewFileEdit(toolCall: ToolCallUpdate): AgentEvent[] {
    const content = toAntigravityEditPreview(toolCall);
    if (!content || !this.tools.has(toolCall.toolCallId)) return [];
    return this.applyTool({ toolCallId: toolCall.toolCallId, content });
  }

  private applyTool(update: ToolCall | ToolCallUpdate): AgentEvent[] {
    this.flushUserMessage();
    const events: AgentEvent[] = [];
    const existing = this.tools.get(update.toolCallId);
    let messageId = existing?.messageId;
    if (!messageId) {
      events.push(...this.closeOpenItem());
      this.nextItemId();
      messageId = `${this.sessionId}:tool:${update.toolCallId}`;
      this.history.push(
        this.withTimeAccuracy({
          messageId,
          role: "assistant",
          timestamp: this.now(),
          text: "",
          parts: [],
        }),
      );
    }
    const state = mergeAntigravityToolState(existing?.state, update);
    this.tools.set(update.toolCallId, { state, messageId });
    events.push(this.publishTool(state, messageId));
    return events;
  }

  private publishTool(state: AntigravityToolState, messageId: string): AgentEvent {
    const part = toAntigravityToolPart(state, messageId, this.declinedTools.has(state.toolCallId));
    const message = this.history.findLast((entry) => entry.messageId === messageId);
    if (message?.role === "assistant") message.parts = [part];
    return {
      type: "assistant_part",
      externalSessionId: this.sessionId,
      timestamp: this.now(),
      part,
    };
  }
}
