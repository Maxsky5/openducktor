import type { AgentFileSearchResultKind } from "@openducktor/core";
import { FileCode2, FileText, FolderTree, Paintbrush } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type AgentChatFileReferenceIconProps = {
  kind: AgentFileSearchResultKind;
  className?: string;
};

export function AgentChatFileReferenceIcon({
  kind,
  className,
}: AgentChatFileReferenceIconProps): ReactElement {
  const Icon =
    kind === "directory"
      ? FolderTree
      : kind === "css"
        ? Paintbrush
        : kind === "ts"
          ? FileCode2
          : FileText;

  return <Icon className={cn("size-3.5", className)} />;
}
