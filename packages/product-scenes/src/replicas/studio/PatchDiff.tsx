// A patch in PierrePreloadedDiffViewer of pierre-diff-viewer.tsx, as the comments of the CI Checks
// tab show it: the unified style, bars on the changed lines, and long lines that wrap. A patch with
// one hunk has no hunk separator.
import type { ReactElement } from "react";
import { patchLines } from "./comments";
import { HighlightedCode } from "./HighlightedCode";
import "./DiffView.css";
import "./PatchDiff.css";

export function PatchDiff({ patch }: { patch: string }): ReactElement {
  return (
    <div className="pd-diff">
      {patchLines(patch).map((line, index) => (
        // The lines of a patch never change order, so the index is a stable key.
        <div className="pd-line" data-kind={line.kind} key={index}>
          <span>{line.number}</span>
          <code>
            <HighlightedCode line={line.text} />
          </code>
        </div>
      ))}
    </div>
  );
}
