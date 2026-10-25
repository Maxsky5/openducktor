import type { AgentSessionLiveRef, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ParentSessionRuntimeContext } from "@openducktor/frontend-core/sessions/transcript/subagent-session-key";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { createContext, use } from "react";
import type { HostDocumentKey } from "@/features/tasks/documents/document-rows";
import type { CodeLanguage } from "@/rich-content/code/highlight";
import type { DiffRow } from "@/rich-content/diff/diff-row-model";
import type { FileLinkHandler, TaskImageContext } from "@/rich-content/markdown/markdown-view";
import type { RowStateStore } from "./transcript-row-state";
import type { PresentToolCall } from "./transcript-row-type";
import type { VisibleRowsStore } from "./transcript-visibility";

/** The full diff or text of a file edit, which the reader opens from a row. */
export type TranscriptFullView =
  | { kind: "diff"; title: string; rows: readonly DiffRow[] }
  | { kind: "content"; title: string; code: string; language: CodeLanguage | null };

/**
 * The session facts and actions that transcript rows share. The values change only when the
 * session or its settings change, so streaming text does not render rows through it.
 */
export type TranscriptRowsContextValue = {
  /** The parent session of Subagent rows. */
  parentSession: ParentSessionRuntimeContext;
  /** The session reference of generated image reads. */
  sessionRef: AgentSessionLiveRef;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  presentToolCall: PresentToolCall;
  modelCatalog: AgentModelCatalog | null;
  supportsImageGeneration: boolean;
  expandFileDiffsByDefault: boolean;
  /** The task of `odt-asset:` images in Markdown, for task sessions. */
  imageContext: TaskImageContext | null;
  visibleRows: VisibleRowsStore;
  /** The streaming message and the Subagent pending input, which each row reads for itself. */
  rowState: RowStateStore;
  onOpenSubagent: (identity: AgentSessionIdentity) => void;
  onOpenTask: (taskId: string) => void;
  /** Opens a file link in the file viewer, or undefined when the session has no work views. */
  onFileLinkPress: FileLinkHandler | undefined;
  /** Opens a task document that an artifact tool saved, or null outside a task session. */
  onOpenDocument: ((document: HostDocumentKey) => void) | null;
  /** Opens a file that an artifact tool saved for a task of the workspace. */
  onOpenArtifact: (taskId: string, code: string) => void;
  /**
   * Opens a full diff or file text in a sheet. The list owns the sheet, because a sheet in a row
   * closes when the list detaches or unmounts the row.
   */
  openFullView: (view: TranscriptFullView) => void;
  /**
   * The reader opens or closes a part of the row with this key. The list reads the row height
   * before the change, so it can keep the row in place after the change.
   */
  beforeRowResize: (key: string) => void;
};

const TranscriptRowsContext = createContext<TranscriptRowsContextValue | null>(null);

export const TranscriptRowsProvider = TranscriptRowsContext;

export const useTranscriptRows = (): TranscriptRowsContextValue => {
  const value = use(TranscriptRowsContext);
  if (!value) throw new Error("Transcript rows need the session transcript list.");
  return value;
};
