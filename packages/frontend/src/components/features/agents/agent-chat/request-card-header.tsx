import { ChevronDown, CircleDotDashed, ShieldAlert } from "lucide-react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type RequestCardHeaderProps = {
  kind: "permission" | "question";
  description: string | undefined;
  isSubagent: boolean;
  status: ReactNode;
  isExpanded: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export function RequestCardHeader({
  kind,
  description,
  isSubagent,
  status,
  isExpanded,
  triggerRef,
}: RequestCardHeaderProps): ReactElement {
  const isPermission = kind === "permission";
  const Icon = isPermission ? ShieldAlert : CircleDotDashed;
  const actionLabel = isExpanded ? "Collapse" : "Expand";

  return (
    <header>
      <CollapsibleTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 rounded-xl px-3 py-1.5 text-left whitespace-normal"
          aria-label={`${actionLabel} ${kind} request`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-foreground">
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  isPermission ? "text-warning-muted" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span className="text-[13px] font-semibold">
                {isPermission ? "Approval required" : "Input needed"}
              </span>
              {isSubagent ? (
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground",
                    isPermission ? "border-warning-border bg-background" : "border-input bg-muted",
                  )}
                >
                  Subagent request
                </span>
              ) : null}
            </span>
            {description ? (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {description}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span
              className={cn(
                "text-[11px] font-medium",
                isPermission ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {status}
            </span>
            <ChevronDown aria-hidden="true" className={cn("size-4", !isExpanded && "-rotate-90")} />
          </span>
        </Button>
      </CollapsibleTrigger>
    </header>
  );
}
