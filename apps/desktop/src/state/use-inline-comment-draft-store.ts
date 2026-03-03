import { create } from "zustand";

export type InlineCommentDraft = {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  side: "original" | "modified";
  text: string;
  createdAt: number;
};

export type InlineCommentDraftStore = {
  drafts: InlineCommentDraft[];
  editingDraftId: string | null;

  addDraft: (draft: Omit<InlineCommentDraft, "id" | "createdAt">) => string;
  updateDraft: (id: string, text: string) => void;
  removeDraft: (id: string) => void;
  setEditing: (id: string | null) => void;
  clearAll: () => void;

  /** Format all drafts as a Markdown review message. */
  formatBatchMessage: () => string;
  getDraftCount: () => number;
};

let nextId = 0;
const generateId = (): string => `draft-${Date.now()}-${++nextId}`;

export const useInlineCommentDraftStore = create<InlineCommentDraftStore>((set, get) => ({
  drafts: [],
  editingDraftId: null,

  addDraft: (draft) => {
    const id = generateId();
    const newDraft: InlineCommentDraft = {
      ...draft,
      id,
      createdAt: Date.now(),
    };
    set((state) => ({ drafts: [...state.drafts, newDraft] }));
    return id;
  },

  updateDraft: (id, text) => {
    set((state) => ({
      drafts: state.drafts.map((d) => (d.id === id ? { ...d, text } : d)),
    }));
  },

  removeDraft: (id) => {
    set((state) => ({
      drafts: state.drafts.filter((d) => d.id !== id),
      editingDraftId: state.editingDraftId === id ? null : state.editingDraftId,
    }));
  },

  setEditing: (id) => {
    set({ editingDraftId: id });
  },

  clearAll: () => {
    set({ drafts: [], editingDraftId: null });
  },

  formatBatchMessage: () => {
    const { drafts } = get();
    if (drafts.length === 0) {
      return "";
    }

    // Group drafts by file path
    const grouped = new Map<string, InlineCommentDraft[]>();
    for (const draft of drafts) {
      const existing = grouped.get(draft.filePath) ?? [];
      existing.push(draft);
      grouped.set(draft.filePath, existing);
    }

    const sections: string[] = ["## Review Comments\n"];

    for (const [filePath, fileDrafts] of grouped) {
      const sortedDrafts = [...fileDrafts].sort((a, b) => a.startLine - b.startLine);

      for (const draft of sortedDrafts) {
        const lineRange =
          draft.startLine === draft.endLine
            ? `line ${draft.startLine}`
            : `lines ${draft.startLine}-${draft.endLine}`;
        const sideLabel = draft.side === "original" ? " (old)" : "";
        sections.push(`### \`${filePath}\` (${lineRange}${sideLabel})\n${draft.text}\n`);
      }
    }

    return sections.join("\n");
  },

  getDraftCount: () => get().drafts.length,
}));
