// One check of diagnostics-card.tsx or diagnostics-runtime-row.tsx: the icon tile, the title with
// its value, the details, the status pill, and Restart for a runtime. A runtime that starts shows
// a progress line under the row. No static frame shows a runtime that starts.
import {
  Cable,
  Database,
  FolderTree,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { DiagStatus } from "./DiagStatus";
import type { DiagCheck, DiagTool } from "./model";
import "./DiagRow.css";

const TOOLS = {
  path: Terminal,
  git: GitBranch,
  "mcp-bridge": Cable,
  "repository-setup": FolderTree,
  "task-store": Database,
} satisfies Record<DiagTool, LucideIcon>;

export function DiagRow({
  id,
  runtime,
  tool,
  title,
  value,
  details,
  status,
  restart = false,
}: DiagCheck): ReactElement {
  const Tool = tool ? TOOLS[tool] : undefined;
  return (
    <div className="diag-row" data-diag={id}>
      <div className="diag-line">
        <span className="diag-tile">
          {runtime ? <RuntimeIcon kind={runtime} /> : Tool && <Tool />}
        </span>
        <div className="diag-text">
          <p className="diag-title">
            <span>{title}</span>
            {value && <code>{value}</code>}
          </p>
          {details.map((detail) => (
            <p className="diag-detail" key={`${detail.label ?? ""}-${detail.value}`}>
              {detail.label && <span>{detail.label}</span>}
              <span className={detail.path ? "path" : undefined}>{detail.value}</span>
            </p>
          ))}
        </div>
        <DiagStatus status={status} />
        {restart && (
          <span className="diag-restart">
            <RotateCcw className="i14" />
            Restart
          </span>
        )}
      </div>
      {restart && (
        <p className="diag-progress" hidden data-diag-progress="">
          <LoaderCircle className="i12 spin" />
          Starting the runtime…
        </p>
      )}
    </div>
  );
}
