import type { RuntimeKind } from "@openducktor/contracts";
import { Bot } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type AgentRuntimeIconProps = {
  runtimeKind: RuntimeKind;
  className?: string;
};

function OpenCodeBrandIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="512" height="512" className="fill-[#131010] dark:fill-[#F1ECEC]" />
      <path d="M320 224V352H192V224H320Z" className="fill-[#5A5858] dark:fill-[#B7B1B1]" />
      <path
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
        className="fill-white dark:fill-[#211E1E]"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function AgentRuntimeIcon({ runtimeKind, className }: AgentRuntimeIconProps): ReactElement {
  if (runtimeKind === "opencode") {
    return <OpenCodeBrandIcon {...(className ? { className } : {})} />;
  }

  return <Bot aria-hidden="true" className={cn("size-4 shrink-0", className)} />;
}
