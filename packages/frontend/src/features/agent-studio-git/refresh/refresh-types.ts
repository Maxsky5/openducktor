import type { DiffDataState, GitDiffRefreshMode } from "../contracts";

export type DiffRefreshContext = {
  requestContextKey: string;
  repoPath: string;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffDataState["diffScope"];
};

export type RefreshScopeContext = Pick<
  DiffRefreshContext,
  "repoPath" | "targetBranch" | "workingDir" | "scope"
>;

export type RefreshRequest = {
  context: DiffRefreshContext;
  mode: GitDiffRefreshMode;
};
