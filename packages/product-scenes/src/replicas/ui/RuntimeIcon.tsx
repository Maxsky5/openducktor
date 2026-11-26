import { RUNTIME_ICON_GEOMETRY } from "@openducktor/theme/runtime-icons";
import { type ReactElement, useId } from "react";
import type { RuntimeKind } from "../../sample/models";
import "./RuntimeIcon.css";

const { antigravity, codex, claude, opencode } = RUNTIME_ICON_GEOMETRY;

/** The brand mark of Antigravity, as agent-runtime-icon.tsx fills it with its gradient. */
function AntigravityIcon(): ReactElement {
  // Each mark needs its own gradient id, because SVG ids are global in the document.
  const gradientId = useId();
  return (
    <svg className="runtime-logo antigravity-logo" viewBox={antigravity.viewBox} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} {...antigravity.gradientVector}>
          {antigravity.gradientStops.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
      </defs>
      <path d={antigravity.path} fill={`url(#${gradientId})`} />
    </svg>
  );
}

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
    case "antigravity":
      return <AntigravityIcon />;
  }
}
