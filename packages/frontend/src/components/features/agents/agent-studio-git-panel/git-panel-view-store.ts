import type { GitChangeGroup } from "@openducktor/contracts";
import { useCallback } from "react";
import { create } from "zustand";
import type { GitPanelTab } from "./constants";

/** View state of one Git context. It stays in app memory, so tab and panel changes keep it. */
export type GitPanelContextView = {
  /** The tab that the user chose. A read that loads or fails does not change it. */
  selectedTab: GitPanelTab;
  commitMessage: string;
  collapsedGroups: readonly GitChangeGroup[];
};

const EMPTY_VIEW: GitPanelContextView = {
  selectedTab: "uncommitted",
  commitMessage: "",
  collapsedGroups: [],
};

/** A change of a view. It reads the current view, so quick changes do not lose each other. */
type GitPanelViewPatch = (view: GitPanelContextView) => Partial<GitPanelContextView>;

type GitPanelViewStore = {
  views: Record<string, GitPanelContextView>;
  update: (contextKey: string, patch: GitPanelViewPatch) => void;
};

export const useGitPanelViewStore = create<GitPanelViewStore>()((set) => ({
  views: {},
  update: (contextKey, patch) =>
    set((store) => {
      const view = readView(store.views, contextKey);
      return { views: { ...store.views, [contextKey]: { ...view, ...patch(view) } } };
    }),
}));

const readView = (
  views: Record<string, GitPanelContextView>,
  contextKey: string,
): GitPanelContextView => views[contextKey] ?? EMPTY_VIEW;

/** A setter bound to one context. */
export function useGitPanelViewUpdate(contextKey: string) {
  const update = useGitPanelViewStore((store) => store.update);
  return useCallback((patch: GitPanelViewPatch) => update(contextKey, patch), [contextKey, update]);
}

/** One field of a context view, so other field changes do not render the caller. */
export function useGitPanelViewField<Field extends keyof GitPanelContextView>(
  contextKey: string,
  field: Field,
): GitPanelContextView[Field] {
  return useGitPanelViewStore((store) => readView(store.views, contextKey)[field]);
}

/** Clears the submitted message only. Newer text stays for the next commit. */
export const clearSubmittedCommitMessage = (contextKey: string, submitted: string): void =>
  useGitPanelViewStore
    .getState()
    .update(contextKey, (view) => (view.commitMessage === submitted ? { commitMessage: "" } : {}));
