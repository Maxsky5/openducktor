// A file edit card of agent-chat-file-edit-card.tsx: A for a new file, M for a changed file.
import { FilePlus, FileText } from "lucide-react";
import type { ReactElement } from "react";
import "./PatchCard.css";

type PatchCardProps = {
  path: string;
  kind: "A" | "M";
  add: number;
  del?: number;
  row?: string;
};

export function PatchCard({ path, kind, add, del = 0, row }: PatchCardProps): ReactElement {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  return (
    <div className="st-patch" data-row={row}>
      <div className="st-patch-head">
        {kind === "A" ? <FilePlus className="i14 add-ink" /> : <FileText className="i14 mod-ink" />}
        <span className="st-path">
          <span>{folder}</span>
          <b>{file}</b>
        </span>
        <span className="st-kind">{kind}</span>
        <span className="st-stats">
          <span className="add-ink">+{add}</span>
          {del > 0 && <span className="del-ink">-{del}</span>}
        </span>
      </div>
    </div>
  );
}
