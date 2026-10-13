import type { GitFileDiff } from "@openducktor/contracts";
import type { AgentStudioGitPanelModel } from "./types";
import { useFileListSearch, useFileListState } from "./use-file-list-state";

const NO_DIFFS: GitFileDiff[] = [];

export type PanelFileLists = ReturnType<typeof usePanelFileLists>;

/** List states live above the tab content, so a tab change keeps search and open directories. */
export function usePanelFileLists(model: AgentStudioGitPanelModel) {
  const local = model.scopeStatesByScope.uncommitted.localChanges;
  const search = useFileListSearch(model.subjectKey);
  const subjectKey = model.subjectKey;
  const unstaged = useFileListState({
    subjectKey,
    listKey: "unstaged",
    fileDiffs: local?.unstaged.fileDiffs ?? NO_DIFFS,
    search,
  });
  const staged = useFileListState({
    subjectKey,
    listKey: "staged",
    fileDiffs: local?.staged.fileDiffs ?? NO_DIFFS,
    search,
  });
  const conflicted = useFileListState({
    subjectKey,
    listKey: "conflicted",
    fileDiffs: local?.conflicted.fileDiffs ?? NO_DIFFS,
    search,
  });
  const target = useFileListState({
    subjectKey,
    listKey: "target",
    fileDiffs: model.scopeStatesByScope.target.fileDiffs,
    search,
  });
  return { search, local: { unstaged, staged, conflicted }, target };
}
