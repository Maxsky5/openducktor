import { create } from "zustand";
import type { DiffScope } from "@/features/agent-studio-git";

export type InlineCommentSide = "old" | "new";
export type InlineCommentStatus = "pending" | "sent";

export type InlineCommentContextLine = {
  lineNumber: number;
  text: string;
  isSelected: boolean;
};

export type InlineCommentDraft = {
  id: string;
  filePath: string;
  diffScope: DiffScope;
  startLine: number;
  endLine: number;
  side: InlineCommentSide;
  text: string;
  codeContext: InlineCommentContextLine[];
  language: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  status: InlineCommentStatus;
};

export type InlineCommentDraftSnapshot = Pick<InlineCommentDraft, "id" | "revision">;

export type AddInlineCommentDraftInput = {
  filePath: string;
  diffScope: DiffScope;
  startLine: number;
  endLine: number;
  side: InlineCommentSide;
  text: string;
  codeContext: InlineCommentContextLine[];
  language?: string | null;
};

export type InlineCommentDraftStore = {
  drafts: InlineCommentDraft[];
  draftStateKey: string | null;
  addDraft: (draft: AddInlineCommentDraftInput) => string;
  updateDraft: (id: string, text: string) => void;
  removeDraft: (id: string) => void;
  clearAll: () => void;
  markDraftsAsSent: (drafts: InlineCommentDraftSnapshot[]) => void;
  resetForContext: (draftStateKey: string) => void;
  getPendingDrafts: () => InlineCommentDraft[];
  formatBatchMessage: (drafts: InlineCommentDraft[]) => string;
  formatPendingBatchMessage: () => string;
  getDraftCount: () => number;
  getFileDraftCount: (filePath: string) => number;
  getDraftsForFile: (filePath: string) => InlineCommentDraft[];
};

const DIFF_SCOPE_LABELS: Record<DiffScope, string> = {
  uncommitted: "Uncommitted changes",
  target: "Branch changes",
};

let nextId = 0;
let nextRevision = 0;

const generateId = (): string => `draft-${Date.now()}-${++nextId}`;
const generateRevision = (): number => ++nextRevision;

const normalizeLineRange = (
  startLine: number,
  endLine: number,
): { startLine: number; endLine: number } => {
  return startLine <= endLine ? { startLine, endLine } : { startLine: endLine, endLine: startLine };
};

const normalizeDraftText = (text: string): string => text.trim();

const compareDrafts = (left: InlineCommentDraft, right: InlineCommentDraft): number => {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.diffScope.localeCompare(right.diffScope) ||
    left.side.localeCompare(right.side) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  );
};

const formatLineRange = (startLine: number, endLine: number): string => {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
};

const formatContextBlock = (
  codeContext: InlineCommentContextLine[],
  language: string | null,
): string => {
  const fence = typeof language === "string" && language.length > 0 ? language : "text";
  const lines = codeContext.map(({ lineNumber, text, isSelected }) => {
    const marker = isSelected ? ">" : " ";
    return `${marker} ${String(lineNumber).padStart(4, " ")} | ${text}`;
  });

  return ["Context:", "```" + fence, ...lines, "```"].join("\n");
};

export const useInlineCommentDraftStore = create<InlineCommentDraftStore>((set, get) => ({
  drafts: [],
  draftStateKey: null,

  addDraft: (draft) => {
    const text = normalizeDraftText(draft.text);
    if (text.length === 0) {
      throw new Error("Inline comments cannot be empty.");
    }

    const id = generateId();
    const { startLine, endLine } = normalizeLineRange(draft.startLine, draft.endLine);
    const newDraft: InlineCommentDraft = {
      id,
      filePath: draft.filePath,
      diffScope: draft.diffScope,
      startLine,
      endLine,
      side: draft.side,
      text,
      codeContext: draft.codeContext,
      language: draft.language ?? null,
      revision: generateRevision(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sentAt: null,
      status: "pending",
    };
    set((state) => ({ drafts: [...state.drafts, newDraft] }));
    return id;
  },

  updateDraft: (id, text) => {
    const normalizedText = normalizeDraftText(text);
    if (normalizedText.length === 0) {
      throw new Error("Inline comments cannot be empty.");
    }

    set((state) => ({
      drafts: state.drafts.map((draft) =>
        draft.id === id && draft.status === "pending"
          ? {
              ...draft,
              text: normalizedText,
              revision: generateRevision(),
              updatedAt: Date.now(),
            }
          : draft,
      ),
    }));
  },

  removeDraft: (id) => {
    set((state) => ({ drafts: state.drafts.filter((draft) => draft.id !== id) }));
  },

  clearAll: () => {
    set({ drafts: [] });
  },

  markDraftsAsSent: (drafts) => {
    if (drafts.length === 0) {
      return;
    }

    const sentAt = Date.now();
    const snapshots = new Map(drafts.map((draft) => [draft.id, draft.revision]));
    set((state) => ({
      drafts: state.drafts.map((draft) =>
        draft.status === "pending" && snapshots.get(draft.id) === draft.revision
          ? { ...draft, status: "sent", sentAt }
          : draft,
      ),
    }));
  },

  resetForContext: (draftStateKey) => {
    if (get().draftStateKey === draftStateKey) {
      return;
    }

    set({ drafts: [], draftStateKey });
  },

  getPendingDrafts: () =>
    get()
      .drafts.filter((draft) => draft.status === "pending")
      .sort(compareDrafts),

  formatBatchMessage: (drafts) => {
    if (drafts.length === 0) {
      return "";
    }

    const sections = drafts.map((draft, index) => {
      const { startLine, endLine } = normalizeLineRange(draft.startLine, draft.endLine);
      return [
        `### Comment ${index + 1}`,
        `File: \`${draft.filePath}\``,
        `Scope: ${DIFF_SCOPE_LABELS[draft.diffScope]}`,
        `Side: ${draft.side}`,
        `Lines: ${formatLineRange(startLine, endLine)}`,
        formatContextBlock(draft.codeContext, draft.language),
        `Comment: ${draft.text}`,
      ].join("\n");
    });

    return ["## Git Diff Comments", ...sections].join("\n\n");
  },

  formatPendingBatchMessage: () => {
    return get().formatBatchMessage(get().getPendingDrafts());
  },

  getDraftCount: () => get().drafts.filter((draft) => draft.status === "pending").length,

  getFileDraftCount: (filePath) =>
    get().drafts.filter((draft) => draft.filePath === filePath).length,

  getDraftsForFile: (filePath) =>
    get()
      .drafts.filter((draft) => draft.filePath === filePath)
      .sort(compareDrafts),
}));
