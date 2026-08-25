import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type ClaudeSdkMessageEnvelope = {
  session_id?: string;
  type: SDKMessage["type"];
  uuid?: Exclude<SDKMessage["uuid"], undefined>;
};

type ClaudeSdkRequiredMessageEnvelope = ClaudeSdkMessageEnvelope & {
  session_id: string;
  uuid: Exclude<SDKMessage["uuid"], undefined>;
};

type ClaudeSdkAssistantMessage = Extract<SDKMessage, { type: "assistant" }>;

export type ClaudeSdkAssistantMessageProjection = ClaudeSdkRequiredMessageEnvelope &
  Pick<ClaudeSdkAssistantMessage, "type"> &
  Partial<
    Pick<
      ClaudeSdkAssistantMessage,
      "parent_tool_use_id" | "subagent_type" | "supersedes" | "task_description" | "timestamp"
    >
  > & {
    message: {
      content: readonly unknown[];
      id?: string;
      model?: string;
      role?: "assistant";
      stop_reason?: string | null;
    };
  };

type ClaudeSdkUserMessage = Extract<SDKMessage, { type: "user" }>;

export type ClaudeSdkUserMessageProjection = ClaudeSdkMessageEnvelope &
  Pick<ClaudeSdkUserMessage, "type"> &
  Partial<
    Pick<
      ClaudeSdkUserMessage,
      | "isSynthetic"
      | "origin"
      | "parent_tool_use_id"
      | "shouldQuery"
      | "timestamp"
      | "tool_use_result"
    >
  > & {
    message: {
      content: string | readonly unknown[];
      role?: ClaudeSdkUserMessage["message"]["role"];
    };
  };

type ClaudeSdkResultMessage = Extract<SDKMessage, { type: "result" }>;

export type ClaudeSdkResultMessageProjection = ClaudeSdkRequiredMessageEnvelope &
  Pick<ClaudeSdkResultMessage, "is_error" | "subtype" | "type"> &
  Partial<Pick<ClaudeSdkResultMessage, "duration_ms" | "origin" | "permission_denials">> & {
    errors?: readonly string[];
    result?: string;
    retracted_message_uuids?: readonly string[];
    stop_reason?: string | null;
    terminal_reason?: string;
    timestamp?: string;
  };

type ClaudeSdkStreamEventMessage = Extract<SDKMessage, { type: "stream_event" }>;

export type ClaudeSdkStreamEventMessageProjection = ClaudeSdkRequiredMessageEnvelope &
  Pick<ClaudeSdkStreamEventMessage, "type"> &
  Partial<Pick<ClaudeSdkStreamEventMessage, "parent_tool_use_id">> & {
    event: unknown;
  };

type ClaudeSdkToolProgressMessage = Extract<SDKMessage, { type: "tool_progress" }>;

export type ClaudeSdkToolProgressMessageProjection = Pick<
  ClaudeSdkToolProgressMessage,
  | "elapsed_time_seconds"
  | "parent_tool_use_id"
  | "session_id"
  | "tool_name"
  | "tool_use_id"
  | "type"
  | "uuid"
>;

type ClaudeSdkSystemMessage<Subtype extends string> = Extract<
  SDKMessage,
  { type: "system"; subtype: Subtype }
>;

type ClaudeSdkSessionStateChangedMessageProjection = Pick<
  ClaudeSdkSystemMessage<"session_state_changed">,
  "session_id" | "state" | "subtype" | "type" | "uuid"
>;

type ClaudeSdkLocalCommandOutputMessageProjection = Pick<
  ClaudeSdkSystemMessage<"local_command_output">,
  "content" | "session_id" | "subtype" | "type" | "uuid"
>;

export type ClaudeSdkModelRefusalFallbackMessageProjection = Pick<
  ClaudeSdkSystemMessage<"model_refusal_fallback">,
  "session_id" | "subtype" | "type" | "uuid"
> & {
  retracted_message_uuids?: readonly string[];
};

type ClaudeSdkCompactBoundaryMessageProjection = Pick<
  ClaudeSdkSystemMessage<"compact_boundary">,
  "session_id" | "subtype" | "type" | "uuid"
>;

type ClaudeSdkCommandsChangedMessageProjection = Pick<
  ClaudeSdkSystemMessage<"commands_changed">,
  "commands" | "session_id" | "subtype" | "type" | "uuid"
>;

type ClaudeSdkPermissionDeniedMessageProjection = Pick<
  ClaudeSdkSystemMessage<"permission_denied">,
  | "agent_id"
  | "decision_reason"
  | "decision_reason_type"
  | "message"
  | "session_id"
  | "subtype"
  | "tool_name"
  | "tool_use_id"
  | "type"
  | "uuid"
>;

type ClaudeSdkTaskStartedMessage = ClaudeSdkSystemMessage<"task_started">;
type ClaudeSdkTaskStartedMessageProjection = Pick<
  ClaudeSdkTaskStartedMessage,
  "description" | "session_id" | "subtype" | "task_id" | "type" | "uuid"
> &
  Partial<
    Pick<
      ClaudeSdkTaskStartedMessage,
      "prompt" | "skip_transcript" | "subagent_type" | "task_type" | "tool_use_id" | "workflow_name"
    >
  >;

type ClaudeSdkTaskProgressMessage = ClaudeSdkSystemMessage<"task_progress">;
type ClaudeSdkTaskProgressMessageProjection = Pick<
  ClaudeSdkTaskProgressMessage,
  "session_id" | "subtype" | "task_id" | "type" | "uuid"
> &
  Partial<
    Pick<
      ClaudeSdkTaskProgressMessage,
      "description" | "last_tool_name" | "subagent_type" | "summary" | "tool_use_id" | "usage"
    >
  >;

type ClaudeSdkTaskUpdatedMessage = ClaudeSdkSystemMessage<"task_updated">;
type ClaudeSdkTaskUpdatedMessageProjection = Pick<
  ClaudeSdkTaskUpdatedMessage,
  "patch" | "session_id" | "subtype" | "task_id" | "type" | "uuid"
>;

type ClaudeSdkTaskNotificationMessage = ClaudeSdkSystemMessage<"task_notification">;
type ClaudeSdkTaskNotificationMessageProjection = Pick<
  ClaudeSdkTaskNotificationMessage,
  "session_id" | "status" | "subtype" | "task_id" | "type" | "uuid"
> &
  Partial<
    Pick<
      ClaudeSdkTaskNotificationMessage,
      "output_file" | "skip_transcript" | "summary" | "tool_use_id" | "usage"
    >
  >;

export type ClaudeSdkSubagentSystemMessageProjection =
  | ClaudeSdkTaskStartedMessageProjection
  | ClaudeSdkTaskProgressMessageProjection
  | ClaudeSdkTaskUpdatedMessageProjection
  | ClaudeSdkTaskNotificationMessageProjection;

type ClaudeSdkHandledSystemSubtype =
  | "commands_changed"
  | "compact_boundary"
  | "local_command_output"
  | "model_refusal_fallback"
  | "permission_denied"
  | "session_state_changed"
  | "task_notification"
  | "task_progress"
  | "task_started"
  | "task_updated";

type ClaudeSdkSystemMessageUnion = Extract<SDKMessage, { type: "system" }>;
type ClaudeSdkIgnoredSystemMessageProjection = ClaudeSdkMessageEnvelope & {
  subtype: Exclude<ClaudeSdkSystemMessageUnion["subtype"], ClaudeSdkHandledSystemSubtype>;
  type: "system";
};

type ClaudeSdkHandledTopLevelType =
  | "assistant"
  | "result"
  | "stream_event"
  | "system"
  | "tool_progress"
  | "user";

type ClaudeSdkIgnoredTopLevelMessageProjection = ClaudeSdkMessageEnvelope & {
  type: Exclude<SDKMessage["type"], ClaudeSdkHandledTopLevelType>;
};

export type ClaudeSdkMessageProjection =
  | ClaudeSdkAssistantMessageProjection
  | ClaudeSdkUserMessageProjection
  | ClaudeSdkResultMessageProjection
  | ClaudeSdkStreamEventMessageProjection
  | ClaudeSdkToolProgressMessageProjection
  | ClaudeSdkSessionStateChangedMessageProjection
  | ClaudeSdkLocalCommandOutputMessageProjection
  | ClaudeSdkModelRefusalFallbackMessageProjection
  | ClaudeSdkCompactBoundaryMessageProjection
  | ClaudeSdkCommandsChangedMessageProjection
  | ClaudeSdkPermissionDeniedMessageProjection
  | ClaudeSdkSubagentSystemMessageProjection
  | ClaudeSdkIgnoredSystemMessageProjection
  | ClaudeSdkIgnoredTopLevelMessageProjection;

type ClaudeSdkMessageFixtureInputFor<Message extends ClaudeSdkMessageProjection> =
  Message extends ClaudeSdkMessageProjection
    ? Omit<Message, "session_id" | "uuid"> & Partial<Pick<Message, "session_id" | "uuid">>
    : never;

export type ClaudeSdkMessageFixtureInput =
  ClaudeSdkMessageFixtureInputFor<ClaudeSdkMessageProjection>;
