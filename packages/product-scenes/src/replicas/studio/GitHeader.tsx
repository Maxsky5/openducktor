// The header of the Diffs tab in git-info-header.tsx: the task branch, the target branch with the
// commits ahead of it and behind it, the row of Git actions of git-header-actions.tsx, and the
// tabs of git-panel-tabs.tsx. A scene changes the counts and shows or hides Detect PR, which shows
// only while the task has no pull request. Each action has the hook `data-git-action`, and the
// count badge of an action has `data-badge`.
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  GitBranch,
  Link2,
  RefreshCw,
  Target,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { TASK_BRANCH } from "../../sample/worktree";
import "./GitHeader.css";

/** The commits of the task branch: against the target, and the commits to push. */
export type GitCounts = { ahead: number; behind: number; push: number };

type GitHeaderProps = {
  counts: GitCounts;
  /** The number of files on the Branch changes tab. */
  files: number;
  /** The task has a pull request, so Detect PR does not show. */
  pullRequest?: boolean;
};

/** The labels of the product: the views of constants.ts and the Detect PR button. */
export const GIT_HEADER_TEXT = {
  tabs: ["Uncommitted changes", "Branch changes", "History"],
  detect: "Detect PR",
} as const;

/** The target branch of the sample task. */
export const TARGET_BRANCH = "origin/main";

/** An icon button of the action row, with its count badge. A count of 0 hides the badge. */
function Action({
  id,
  children,
  count,
  tone,
}: {
  id: string;
  children: ReactNode;
  count?: number;
  tone?: "ahead" | "behind";
}): ReactElement {
  return (
    <span className="gh-action" data-git-action={id}>
      {children}
      {count !== undefined && (
        <b className="gh-badge" data-tone={tone} data-badge="" hidden={count === 0}>
          {count}
        </b>
      )}
    </span>
  );
}

export function GitHeader({ counts, files, pullRequest = false }: GitHeaderProps): ReactElement {
  const [uncommitted, branch, history] = GIT_HEADER_TEXT.tabs;
  return (
    <div className="gh">
      <div className="gh-branches">
        <span className="gh-chip gh-current">
          <GitBranch className="i14" />
          <span>{TASK_BRANCH}</span>
        </span>
        <ArrowRight className="i14 gh-to" />
        <span className="gh-chip gh-target">
          <Target className="i14" />
          <span>{TARGET_BRANCH}</span>
          <ChevronDown className="i12" />
        </span>
        <span className="gh-counts" data-counts="" hidden={counts.ahead + counts.behind === 0}>
          <span data-tone="ahead">
            <ArrowUp />
            <span data-ahead="">{counts.ahead}</span>
          </span>
          <span data-tone="behind">
            <ArrowDown />
            <span data-behind="">{counts.behind}</span>
          </span>
        </span>
      </div>
      <div className="gh-actions">
        <Action id="refresh">
          <RefreshCw className="i14" />
        </Action>
        <Action id="rebase" count={counts.behind} tone="behind">
          <Target className="i14" />
        </Action>
        <Action id="pull">
          <ArrowDown className="i14" />
        </Action>
        <Action id="push" count={counts.push} tone="ahead">
          <ArrowUp className="i14" />
        </Action>
        <span className="gh-detect" data-detect="" hidden={pullRequest}>
          <Link2 className="i16" />
          {GIT_HEADER_TEXT.detect}
        </span>
      </div>
      <div className="gh-tabs">
        <span className="gh-tab">{uncommitted}</span>
        <span className="gh-tab" data-active="">
          {branch}
          <span className="gh-count" data-branch-count="" hidden={files === 0}>
            {files}
          </span>
        </span>
        <span className="gh-tab">{history}</span>
      </div>
    </div>
  );
}
