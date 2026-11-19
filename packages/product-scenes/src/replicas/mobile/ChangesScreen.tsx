// The Changes view of a task in the mobile app, as changes-screen.tsx, branch-summary.tsx,
// changes-header.tsx, changes-rows.tsx, and changes-state.tsx in apps/mobile/src/features/review:
// the list header with the branch card, the notices, the pending comments with Send, the
// Uncommitted changes and Branch changes tabs, and the file list header, then the changed files
// as a tree. A tap on a file shows its diff under its row, and its menu control opens the file
// actions. A scene changes `data-scope` of the tabs, `data-expanded` of a file row, and shows the
// pending comments.
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CloudOff,
  Ellipsis,
  FilePlus,
  FileText,
  FolderGit2,
  GitBranch,
  List,
  ListTree,
  MessageSquare,
  Send,
  Target,
} from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { LineCounts } from "./DiffRows";
import { MobileScreen } from "./MobileScreen";
import { StackHeader } from "./StackHeader";
import "./ChangesScreen.css";

/** A row of the changed file tree: a folder, or a file with its Git change. */
export type ChangesRow =
  | { kind: "directory"; name: string; depth: number; files: number; add: number; del: number }
  | {
      kind: "file";
      id: string;
      name: string;
      change: "added" | "modified";
      depth: number;
      add: number;
      del: number;
    };

/** The empty state of Uncommitted changes, as emptyDiffCopy of frontend-core gives it. */
export const NO_CHANGES = "No changes detected";

type ChangesScreenProps = {
  id: string;
  /** The checkout, shortened in the middle as the card shows it. */
  branch: string;
  /** The comparison branch and the commits that the checkout is ahead of it. */
  target: string;
  ahead: number;
  rows: readonly ChangesRow[];
  /** The file whose diff `diff` shows under its row. */
  open: string;
  diff: ReactNode;
  /** Who gets the comments, as the app names the recipient. */
  recipient: string;
  hidden?: boolean | undefined;
};

function BranchCard({
  branch,
  target,
  ahead,
}: Pick<ChangesScreenProps, "branch" | "target" | "ahead">): ReactElement {
  return (
    <div className="mob-branch-card">
      <div className="mob-branch-line">
        <GitBranch />
        <span className="mob-branch-name">{branch}</span>
        <span className="mob-branch-upstream">
          <CloudOff />
          Not published
        </span>
      </div>
      <div className="mob-branch-line">
        <Target />
        <span className="mob-branch-name">{target}</span>
        <span className="mob-branch-ahead">
          <ArrowUp />
          {ahead}
        </span>
        <ChevronsUpDown />
      </div>
    </div>
  );
}

/** The pending comments and Send feedback, which opens the session of the recipient. */
function PendingComments({ recipient }: { recipient: string }): ReactElement {
  return (
    <div className="mob-pending-comments" data-pending-comments="" hidden>
      <div className="mob-pending-comments-text">
        <span className="mob-pending-comments-title">
          <span className="mob-pending-badge">Pending</span>
          <strong>1 comment</strong>
        </span>
        <span>It goes with the next message to the {recipient}.</span>
      </div>
      <span className="mob-sm-button" data-send-feedback="">
        <Send />
        Send
      </span>
    </div>
  );
}

/** The scope tabs, as CHANGES_SCOPE_OPTIONS of changes-model.ts names them. */
export const SCOPE_TABS = [
  { value: "uncommitted", label: "Uncommitted changes" },
  { value: "target", label: "Branch changes" },
] as const;

/** The tabs with the file count of Branch changes. Uncommitted changes has no file to count. */
function ScopeTabs({ count }: { count: number }): ReactElement {
  return (
    <div className="mob-scope-tabs" data-scope="uncommitted">
      {SCOPE_TABS.map(({ value, label }) => (
        <span key={value} className="mob-scope-tab" data-scope-tab={value} data-feedback="opacity">
          {label}
          {value === "target" && <span className="mob-scope-count">{count}</span>}
        </span>
      ))}
      <i className="mob-scope-indicator" />
    </div>
  );
}

function Row({ row, open }: { row: ChangesRow; open: boolean }): ReactElement {
  const indent: CSSProperties & { "--depth": number } = { "--depth": row.depth };
  if (row.kind === "directory") {
    return (
      <div className="mob-change-row" data-kind="directory" style={indent}>
        <ChevronDown />
        <span className="mob-change-name">{row.name}</span>
        <span className="mob-change-files">{row.files}</span>
        <LineCounts add={row.add} del={row.del} />
      </div>
    );
  }
  const Icon = row.change === "added" ? FilePlus : FileText;
  // The box draws the line under the row, so the file menu anchors to the row alone.
  return (
    <div className="mob-change-box">
      <div
        className="mob-change-row"
        data-kind="file"
        data-file={row.id}
        data-expanded={open ? "false" : undefined}
        data-feedback="highlight"
        style={indent}
      >
        <ChevronRight className="mob-change-closed" />
        <ChevronDown className="mob-change-open" />
        <Icon className="mob-change-status" data-change={row.change} />
        <span className="mob-change-name" data-file-name="">
          {row.name}
        </span>
        {open && (
          <span className="mob-change-comments" data-comment-count="" hidden>
            <MessageSquare />1
          </span>
        )}
        <LineCounts add={row.add} del={row.del} />
        {open && (
          <span className="mob-change-more" data-file-menu="" data-feedback="opacity">
            <Ellipsis />
          </span>
        )}
      </div>
    </div>
  );
}

/** The changed file count, the line totals, and the tree and list toggle of FileListHeader. */
function FileListHeader({
  files,
  add,
  del,
}: {
  files: number;
  add: number;
  del: number;
}): ReactElement {
  return (
    <div className="mob-changes-totals" data-scope-panel="target">
      <span>{files} changed files</span>
      <LineCounts add={add} del={del} />
      <span className="mob-changes-toggle">
        <span data-active="">
          <ListTree />
        </span>
        <span>
          <List />
        </span>
      </span>
    </div>
  );
}

export function ChangesScreen({
  id,
  branch,
  target,
  ahead,
  rows,
  open,
  diff,
  recipient,
  hidden,
}: ChangesScreenProps): ReactElement {
  const files = rows.filter((row) => row.kind === "file");
  const add = files.reduce((sum, row) => sum + row.add, 0);
  const del = files.reduce((sum, row) => sum + row.del, 0);
  return (
    <MobileScreen id={id} over hidden={hidden} className="mob-changes">
      <StackHeader title="Changes" />
      <div className="mob-changes-body">
        <div className="mob-changes-header">
          <BranchCard branch={branch} target={target} ahead={ahead} />
          {/* The notices: none for this branch. The empty box keeps its gaps, as in the app. */}
          <div />
          <PendingComments recipient={recipient} />
          <div>
            <ScopeTabs count={files.length} />
            <FileListHeader files={files.length} add={add} del={del} />
          </div>
        </div>
        <div className="mob-changes-empty" data-scope-panel="uncommitted">
          <span>
            <FolderGit2 />
          </span>
          {NO_CHANGES}
        </div>
        <div className="mob-changes-list" data-scope-panel="target">
          {rows.map((row) => {
            const isOpen = row.kind === "file" && row.id === open;
            return (
              <div key={row.kind === "file" ? row.id : `${row.depth}/${row.name}`}>
                <Row row={row} open={isOpen} />
                {isOpen && (
                  <div className="mob-changes-diff mob-review-page" data-file-diff="" hidden>
                    {diff}
                    <i className="mob-changes-diff-end" />
                  </div>
                )}
              </div>
            );
          })}
          <p className="mob-changes-hint">
            Tap a line in a diff to comment on it. Comments go with the next message to the{" "}
            {recipient}.
          </p>
        </div>
      </div>
    </MobileScreen>
  );
}
