// One file of the Git panel diff in the unified style of @pierre/diffs. Each line keeps its
// number in data-line, so a scene can hover it and insert a review comment under it.
import { Plus } from "lucide-react";
import type { ReactElement } from "react";
import { HighlightedCode } from "./HighlightedCode";
import "./DiffView.css";

type DiffViewProps = { lines: readonly string[]; kind: "add" | "ctx" };

export function DiffView({ lines, kind }: DiffViewProps): ReactElement {
  return (
    <div className="st-diff">
      {lines.map((line, index) => (
        <div className={`st-line ${kind}`} data-line={index + 1} key={index}>
          <span>{index + 1}</span>
          <code>
            <HighlightedCode line={line} />
          </code>
          <span className="st-plus" data-comment-add="">
            <Plus className="i12" />
          </span>
        </div>
      ))}
    </div>
  );
}
