import { create } from "zustand";
import type { DiffScope } from "@/features/agent-studio-git";

export type InlineCommentSide = "old" | "new";
export type InlineCommentStatus = "pending" | "submitting" | "sent";

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
  submissionId: string | null;
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
  beginSubmittingDrafts: (drafts: InlineCommentDraftSnapshot[]) => string | null;
  restoreSubmittingDrafts: (submissionId: string) => void;
  markSubmittingDraftsAsSent: (submissionId: string) => void;
  resetForContext: (draftStateKey: string) => void;
  getPendingDrafts: () => InlineCommentDraft[];
  formatBatchMessage: (drafts: InlineCommentDraft[]) => string;
  formatPendingBatchMessage: () => string;
  getDraftCount: () => number;
  getFileDraftCount: (filePath: string) => number;
  getDraftsForFile: (filePath: string) => InlineCommentDraft[];
};

let nextId = 0;
let nextRevision = 0;
let nextSubmissionId = 0;

const generateId = (): string => `draft-${Date.now()}-${++nextId}`;
const generateRevision = (): number => ++nextRevision;
const generateSubmissionId = (): string => `submission-${Date.now()}-${++nextSubmissionId}`;

const normalizeLineRange = (
  startLine: number,
  endLine: number,
): { startLine: number; endLine: number } => {
  return startLine <= endLine ? { startLine, endLine } : { startLine: endLine, endLine: startLine };
};

const normalizeDraftText = (text: string): string => text.trim();

const isDraftSnapshotMatch = (
  draft: InlineCommentDraft,
  snapshot: InlineCommentDraftSnapshot,
): boolean => draft.id === snapshot.id && draft.revision === snapshot.revision;

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

const formatSelectedCodeLines = (codeContext: InlineCommentContextLine[]): string[] => {
  const selectedLines = codeContext.filter((line) => line.isSelected);
  const lines = (selectedLines.length > 0 ? selectedLines : codeContext).map(
    ({ lineNumber, text }) => {
      return `${lineNumber} | ${text}`;
    },
  );

  return lines;
};

const formatLineRange = (startLine: number, endLine: number): string => {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
};

const formatSelectedContextBlock = (
  codeContext: InlineCommentContextLine[],
  language: string | null,
): string => {
  const fence = typeof language === "string" && language.length > 0 ? language : "text";
  return ["Context:", `\`\`\`${fence}`, ...formatSelectedCodeLines(codeContext), "```"].join("\n");
};

const mapCommentSideToChange = (side: InlineCommentSide): "added" | "removed" => {
  return side === "old" ? "removed" : "added";
};

const DIFF_SCOPE_LABELS: Record<DiffScope, string> = {
  uncommitted: "uncommitted changes",
  target: "branch changes",
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
      submissionId: null,
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
    const draft = get().drafts.find((candidate) => candidate.id === id);
    if (draft?.status === "submitting") {
      throw new Error("Cannot edit a git diff comment while it is being sent.");
    }

    set((state) => ({
      drafts: state.drafts.map((currentDraft) =>
        currentDraft.id === id && currentDraft.status === "pending"
          ? {
              ...currentDraft,
              text: normalizedText,
              revision: generateRevision(),
              submissionId: null,
              updatedAt: Date.now(),
            }
          : currentDraft,
      ),
    }));
  },

  removeDraft: (id) => {
    const draft = get().drafts.find((candidate) => candidate.id === id);
    if (draft?.status === "submitting") {
      throw new Error("Cannot remove a git diff comment while it is being sent.");
    }

    set((state) => ({ drafts: state.drafts.filter((currentDraft) => currentDraft.id !== id) }));
  },

  clearAll: () => {
    set({ drafts: [] });
  },

  beginSubmittingDrafts: (drafts) => {
    if (drafts.length === 0) {
      return null;
    }

    const submissionId = generateSubmissionId();
    let didTransition = false;
    set((state) => ({
      drafts: state.drafts.map((draft) => {
        if (
          draft.status === "pending" &&
          drafts.some((snapshot) => isDraftSnapshotMatch(draft, snapshot))
        ) {
          didTransition = true;
          return {
            ...draft,
            status: "submitting",
            submissionId,
          };
        }
        return draft;
      }),
    }));
    return didTransition ? submissionId : null;
  },

  restoreSubmittingDrafts: (submissionId) => {
    if (submissionId.length === 0) {
      return;
    }

    set((state) => ({
      drafts: state.drafts.map((draft) =>
        draft.status === "submitting" && draft.submissionId === submissionId
          ? { ...draft, status: "pending", submissionId: null }
          : draft,
      ),
    }));
  },

  markSubmittingDraftsAsSent: (submissionId) => {
    if (submissionId.length === 0) {
      return;
    }

    const sentAt = Date.now();
    set((state) => ({
      drafts: state.drafts.map((draft) =>
        draft.status === "submitting" && draft.submissionId === submissionId
          ? { ...draft, status: "sent", submissionId: null, sentAt }
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
        `Diff: ${DIFF_SCOPE_LABELS[draft.diffScope]}`,
        `Change: ${mapCommentSideToChange(draft.side)}`,
        `Lines: ${formatLineRange(startLine, endLine)}`,
        formatSelectedContextBlock(draft.codeContext, draft.language),
        `Instruction: ${draft.text}`,
      ].join("\n");
    });

    return ["## Git Diff Comments", ...sections].join("\n\n");
  },

  formatPendingBatchMessage: () => {
    return get().formatBatchMessage(get().getPendingDrafts());
  },

  getDraftCount: () => get().getPendingDrafts().length,

  getFileDraftCount: (filePath) =>
    get().drafts.filter((draft) => draft.filePath === filePath).length,

  getDraftsForFile: (filePath) =>
    get()
      .drafts.filter((draft) => draft.filePath === filePath)
      .sort(compareDrafts),
}));
