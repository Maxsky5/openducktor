import { RUNTIME_ICON_GEOMETRY } from "@openducktor/theme/runtime-icons";
import type { ReactElement } from "react";
import type { RuntimeKind } from "../../sample/models";
import "./RuntimeIcon.css";

const { codex, claude, opencode } = RUNTIME_ICON_GEOMETRY;

export function RuntimeIcon({ kind }: { kind: RuntimeKind }): ReactElement {
  switch (kind) {
    case "codex":
      return (
        <svg className="runtime-logo codex-logo" viewBox={codex.viewBox} aria-hidden="true">
          <path fill="currentColor" d={codex.path} />
        </svg>
      );
    case "claude":
      return (
        <svg className="runtime-logo claude-logo" viewBox={claude.viewBox} aria-hidden="true">
          <path fill="currentColor" d={claude.path} />
        </svg>
      );
    case "opencode":
      return (
        <svg className="runtime-logo opencode-logo" viewBox={opencode.viewBox} aria-hidden="true">
          <rect width={opencode.size} height={opencode.size} fill="currentColor" />
          <path d={opencode.centerPath} className="opencode-center" />
          <path d={opencode.outlinePath} fillRule="evenodd" className="opencode-outline" />
        </svg>
      );
  }
}
