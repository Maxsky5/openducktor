import type { SourceIssueReference } from "@openducktor/contracts";
import { ExternalLink, CircleDot } from "lucide-react";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { badgeVariants } from "@/components/ui/badge-variants";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";

export function TaskSourceIssueLink({
  sourceIssue,
  className,
}: {
  sourceIssue: SourceIssueReference;
  className?: string;
}): ReactElement {
  const provider = sourceIssue.providerId === "github" ? "GitHub" : "Azure DevOps";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void openExternalUrl(sourceIssue.url).catch((cause) =>
          toast.error("Failed to open source item", { description: errorMessage(cause) }),
        );
      }}
      className={cn(
        badgeVariants({ variant: "outline" }),
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      <CircleDot className="size-3.5" aria-hidden="true" />
      <span>
        {provider} #{sourceIssue.number}
      </span>
      <ExternalLink className="size-3" aria-hidden="true" />
    </button>
  );
}
