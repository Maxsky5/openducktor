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

type GitPanelViewStore = {
  views: Record<string, GitPanelContextView>;
  update: (contextKey: string, patch: Partial<GitPanelContextView>) => void;
};

export const useGitPanelViewStore = create<GitPanelViewStore>()((set) => ({
  views: {},
  update: (contextKey, patch) =>
    set((store) => ({
      views: { ...store.views, [contextKey]: { ...readView(store.views, contextKey), ...patch } },
    })),
}));

const readView = (
  views: Record<string, GitPanelContextView>,
  contextKey: string,
): GitPanelContextView => views[contextKey] ?? EMPTY_VIEW;

/** A setter bound to one context. */
export function useGitPanelViewUpdate(contextKey: string) {
  const update = useGitPanelViewStore((store) => store.update);
  return useCallback(
    (patch: Partial<GitPanelContextView>) => update(contextKey, patch),
    [contextKey, update],
  );
}

/** One field of a context view, so other field changes do not render the caller. */
export function useGitPanelViewField<Field extends keyof GitPanelContextView>(
  contextKey: string,
  field: Field,
): GitPanelContextView[Field] {
  return useGitPanelViewStore((store) => readView(store.views, contextKey)[field]);
}

/** The view of one context and a setter bound to it. */
export function useGitPanelContextView(contextKey: string) {
  const view = useGitPanelViewStore((store) => readView(store.views, contextKey));
  return { view, updateView: useGitPanelViewUpdate(contextKey) };
}

/** Clears the submitted message only. Newer text stays for the next commit. */
export const clearSubmittedCommitMessage = (contextKey: string, submitted: string): void => {
  const { views, update } = useGitPanelViewStore.getState();
  if (readView(views, contextKey).commitMessage === submitted) {
    update(contextKey, { commitMessage: "" });
  }
};
