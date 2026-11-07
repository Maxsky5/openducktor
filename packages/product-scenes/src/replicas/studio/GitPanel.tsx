// The Diffs tab of agent-studio-git-panel: branch context, sync actions, diff scope, and files.
// The Branch changes scope has no reset button: the product resets only uncommitted files.
// Without files it shows empty-diff-state.tsx. A scene flips data-git when the first file lands.
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  FolderGit2,
  GitBranch,
  Link2,
  MessageSquare,
  Pencil,
  RefreshCw,
  SquareSplitHorizontal,
  Target,
  TextAlignJustify,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { TASK_BRANCH } from "../../sample/worktree";
import { filesLabel } from "../format";
import { Segment } from "../ui/Segment";
import { Segmented } from "../ui/Segmented";
import { byPath, type GitFile } from "./model";
import "./GitPanel.css";

type GitPanelProps = {
  files: readonly GitFile[];
  ahead: number;
  /** The diff under each open file. */
  diff?: ReactNode;
};

function Branches({ ahead }: { ahead: number }): ReactElement {
  return (
    <>
      <div className="st-branches">
        <div className="st-branch">
          <small>Current branch</small>
          <span>
            <GitBranch className="i14" />
            <code>{TASK_BRANCH}</code>
          </span>
        </div>
        <span className="st-arrow">
          <span>
            <ArrowRight className="i14" />
          </span>
          <b data-ahead="" hidden={ahead === 0}>
            {ahead}
          </b>
        </span>
        <div className="st-branch">
          <small>Target branch</small>
          <span>
            <Target className="i14" />
            <code>origin/main</code>
            <Pencil className="i14" />
          </span>
        </div>
      </div>
      <div className="st-git-actions">
        <span className="st-sync">
          <span>
            <RefreshCw className="i14" />
          </span>
          <span>
            <Target className="i14" />
          </span>
          <span>
            <ArrowDown className="i14" />
          </span>
          <span>
            <ArrowUp className="i14" />
            <b data-push="" hidden={ahead === 0}>
              {ahead}
            </b>
          </span>
        </span>
        <span className="st-detect" data-detect="">
          <Link2 />
          Detect PR
        </span>
      </div>
    </>
  );
}

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

export function GitPanel({ files, ahead, diff }: GitPanelProps): ReactElement {
  const totalAdd = files.reduce((sum, file) => sum + file.add, 0);
  const totalDel = files.reduce((sum, file) => sum + file.del, 0);
  return (
    <div className="st-git" data-panel="diffs" data-git={files.length > 0 ? "filled" : "empty"}>
      <Branches ahead={ahead} />
      <Segmented size="sm">
        <Segment>Uncommitted changes</Segment>
        <Segment active>Branch changes</Segment>
      </Segmented>
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
