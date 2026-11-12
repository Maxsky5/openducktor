// The Diffs tab of agent-studio-git-panel: the header of GitHeader.tsx, then the changed files.
// The Branch changes scope has no reset button: the product resets only uncommitted files.
// Without files it shows empty-diff-state.tsx. A scene flips data-git when the first file lands.
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  FolderGit2,
  MessageSquare,
  SquareSplitHorizontal,
  TextAlignJustify,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { filesLabel } from "../format";
import { GitHeader } from "./GitHeader";
import { byPath, type GitFile } from "./model";
import "./GitPanel.css";

type GitPanelProps = {
  files: readonly GitFile[];
  /** The commits of the task branch that the target branch does not have, and that a push sends. */
  ahead: number;
  /** The commits of the target branch that the task branch does not have. */
  behind?: number;
  /** The commits that a push sends. A branch without a remote branch shows no count. */
  push?: number;
  /** The task has a pull request, so Detect PR does not show. */
  pullRequest?: boolean;
  /** The diff under each open file. */
  diff?: ReactNode;
};

function FileItem({ file, diff }: { file: GitFile; diff: ReactNode }): ReactElement {
  const slash = file.path.lastIndexOf("/");
  return (
    <div className="st-file-item" data-file={file.path}>
      <div className="st-file">
        {file.open ? <ChevronDown className="i12" /> : <ChevronRight className="i12" />}
        {file.type === "added" ? (
          <FilePlus className="i14 add-ink" />
        ) : (
          <FileText className="i14 mod-ink" />
        )}
        <span className="st-file-name">
          <b>{file.path.slice(slash + 1)}</b>
          <small>{file.path.slice(0, slash)}</small>
        </span>
        <span className="st-file-stats">
          <span className="st-note-pill" hidden={!file.comments} data-note-pill="">
            <MessageSquare className="i12" />
            <span data-note-count="">{file.comments ?? 0}</span>
          </span>
          <span className="st-stats">
            <span className="add-ink" data-add="">
              +{file.add}
            </span>
            <span className="del-ink" hidden={file.del === 0} data-del="">
              -{file.del}
            </span>
          </span>
        </span>
      </div>
      {file.open && diff}
    </div>
  );
}

export function GitPanel({
  files,
  ahead,
  behind = 0,
  push = ahead,
  pullRequest = false,
  diff,
}: GitPanelProps): ReactElement {
  const totalAdd = files.reduce((sum, file) => sum + file.add, 0);
  const totalDel = files.reduce((sum, file) => sum + file.del, 0);
  return (
    <div className="st-git" data-panel="diffs" data-git={files.length > 0 ? "filled" : "empty"}>
      <GitHeader counts={{ ahead, behind, push }} files={files.length} pullRequest={pullRequest} />
      <div className="st-git-empty">
        <span>
          <FolderGit2 className="i20" />
        </span>
        <b>No changes detected</b>
        <small>File modifications will appear here once the agent starts editing.</small>
      </div>
      <div className="st-files-head">
        <span data-file-count="">{filesLabel(files.length)}</span>
        <span className="st-diff-style">
          <span>
            <SquareSplitHorizontal className="i12" />
          </span>
          <span data-active="">
            <TextAlignJustify className="i12" />
          </span>
        </span>
        <span className="st-totals">
          <span className="add-ink" data-total-add="">
            +{totalAdd}
          </span>
          <span className="del-ink" hidden={totalDel === 0} data-total-del="">
            -{totalDel}
          </span>
        </span>
      </div>
      <div className="st-files" data-files="">
        {byPath(files).map((file) => (
          <FileItem file={file} diff={diff} key={file.path} />
        ))}
      </div>
    </div>
  );
}
