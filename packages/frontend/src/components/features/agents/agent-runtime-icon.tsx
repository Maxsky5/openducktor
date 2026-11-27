import { RUNTIME_ICON_GEOMETRY } from "@openducktor/theme/runtime-icons";
import type { RuntimeKind } from "@openducktor/contracts";
import { type ReactElement, useId } from "react";
import { cn } from "@/lib/utils";

const { antigravity, codex, claude, opencode } = RUNTIME_ICON_GEOMETRY;

type AgentRuntimeIconProps = {
  runtimeKind: RuntimeKind;
  className?: string;
};

type RuntimeBrandIconProps = {
  className: string | undefined;
};

function OpenCodeBrandIcon({ className }: RuntimeBrandIconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      viewBox={opencode.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        width={opencode.size}
        height={opencode.size}
        className="fill-[#131010] dark:fill-[#F1ECEC]"
      />
      <path d={opencode.centerPath} className="fill-[#5A5858] dark:fill-[#B7B1B1]" />
      <path
        d={opencode.outlinePath}
        className="fill-white dark:fill-[#211E1E]"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CodexBrandIcon({ className }: RuntimeBrandIconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      viewBox={codex.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path className="fill-[#0D0D0D] dark:fill-white" d={codex.path} />
    </svg>
  );
}

function ClaudeBrandIcon({ className }: RuntimeBrandIconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      viewBox={claude.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={claude.path} className="fill-[#D97757]" fillRule="nonzero" />
    </svg>
  );
}

function AntigravityBrandIcon({ className }: RuntimeBrandIconProps): ReactElement {
  // Each icon needs its own gradient ID, because SVG IDs are global in the document.
  const gradientId = useId();
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      viewBox={antigravity.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
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

export function AgentRuntimeIcon({ runtimeKind, className }: AgentRuntimeIconProps): ReactElement {
  switch (runtimeKind) {
    case "opencode":
      return <OpenCodeBrandIcon className={className} />;
    case "codex":
      return <CodexBrandIcon className={className} />;
    case "claude":
      return <ClaudeBrandIcon className={className} />;
    case "antigravity":
      return <AntigravityBrandIcon className={className} />;
  }

  const exhaustiveRuntimeKind: never = runtimeKind;
  return exhaustiveRuntimeKind;
}
