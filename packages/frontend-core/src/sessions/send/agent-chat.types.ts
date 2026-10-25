import type {
  AgentMessageQueueAction,
  AgentMessageQueueSnapshot,
  AgentMessageSubmitMode,
  AgentSessionUsageLimit,
  RuntimeApprovalReplyOutcome,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type {
  AgentChatComposerAttachment,
  AgentChatComposerDraft,
} from "../../drafts/agent-chat-composer-draft";
import type {
  ModelPickerFavoriteState,
  ModelPickerRuntime,
  ModelPickerSelectionPolicy,
  ModelPickerValue,
} from "../model-selection/model-picker-model";
import type { AgentChatSendResult } from "./agent-chat-send-result";

export type AgentChatEmptyStateModel = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  isActionPending?: boolean;
};

export type AgentChatTranscriptNoticeAction = {
  label: string;
  onAction: () => void;
  disabled?: boolean;
  isPending?: boolean;
};

export type AgentChatTranscriptNotice = {
  kind:
    | "runtime_waiting"
    | "session_loading"
    | "session_failed"
    | "session_history_warning"
    | "runtime_blocked"
    | "catalog_warning";
  severity: "loading" | "error";
  title: string;
  description: string;
  details?: Array<{ label: string; value: string }>;
  action?: AgentChatTranscriptNoticeAction;
};

export type AgentChatTaskToolName = "create_task" | "search_tasks" | "update_task";

export type AgentChatToolCallPresentation =
  | {
      kind: "regular" | "workflow";
      displayName: string;
    }
  | { kind: "artifact"; displayName: string; operation: "set" | "delete" }
  | { kind: "task"; displayName: string; taskTool: AgentChatTaskToolName }
  /** An `odt_browser_*` call. `action` is the browser action, such as `click`. */
  | { kind: "browser"; displayName: string; action: string };

export type AgentChatRuntimePresentation = {
  runtimeKind: RuntimeKind | null;
  presentToolCall: (toolName: string, displayLabel?: string) => AgentChatToolCallPresentation;
  supportedApprovalReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null;
};

export type AgentChatInterruptedTurnResumeModel = {
  isPending: boolean;
  isDisabled?: boolean;
  error: string | null;
  onResume: () => void;
  usageLimit?: AgentSessionUsageLimit | undefined;
};

export type AgentChatPendingSendAttachment = Pick<
  AgentChatComposerAttachment,
  "kind" | "mime" | "name"
>;

export type AgentChatPendingSendGroupKey = "review_comments" | "browser_annotations";

/** Items, such as review comments, that the next regular message carries after the user text. */
export type AgentChatPendingSendGroup = {
  key: AgentChatPendingSendGroupKey;
  count: number;
  accessibleLabel: string;
  /** A save problem. Send stays available. */
  warning?: string;
  /** Files that the next message adds. Send checks them like composer attachments. */
  attachments?: {
    items: AgentChatPendingSendAttachment[];
    /** Tells the user how to send the items without these files. */
    removalHint: string;
  };
};

export type AgentChatModelPicker = {
  runtimes: ModelPickerRuntime[];
  value: ModelPickerValue | null;
  selectionPolicy: ModelPickerSelectionPolicy;
  favoriteState: ModelPickerFavoriteState;
  onValueChange: (value: ModelPickerValue) => void;
  onOpenChange: (open: boolean) => void;
};

/** Queue actions that need no new content. A save carries an edited draft instead. */
export type AgentChatMessageQueueAction = Exclude<AgentMessageQueueAction, { kind: "save_edit" }>;

export type AgentChatMessageQueueModel = {
  queue: AgentMessageQueueSnapshot | null;
  onAction: (action: AgentChatMessageQueueAction) => Promise<void>;
  /** `editId` names the edit that the host reserved, so a stale Save cannot end a newer edit. */
  onSaveEdit: (
    edit: { readonly submissionId: string; readonly editId: string },
    draft: AgentChatComposerDraft,
  ) => Promise<void>;
};

/** The send state and actions that a chat composer reads. */
export type AgentChatSend = {
  messageQueue: AgentChatMessageQueueModel | null;
  /** Why the session cannot steer the running turn now, or null when it can. */
  steerBlockedReason: string | null;
  runningTurnModel: AgentModelCatalog["models"][number] | null;
  isSending: boolean;
  canSend?: boolean;
  onSend: (
    draft: AgentChatComposerDraft,
    mode: AgentMessageSubmitMode,
  ) => Promise<AgentChatSendResult>;
};
