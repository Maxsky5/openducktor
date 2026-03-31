import type { AgentFileSearchResultKind } from "@openducktor/core";
import { FileCode2, FileImage, FilePlay, FileText, FolderTree, Paintbrush } from "lucide-react";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cn } from "@/lib/utils";

type AgentChatFileReferenceIconProps = {
  kind: AgentFileSearchResultKind;
  className?: string;
};

const resolveFileReferenceIcon = (kind: AgentFileSearchResultKind) => {
  switch (kind) {
    case "directory":
      return FolderTree;
    case "css":
      return Paintbrush;
    case "code":
      return FileCode2;
    case "image":
      return FileImage;
    case "video":
      return FilePlay;
    default:
      return FileText;
  }
};

export function AgentChatFileReferenceIcon({
  kind,
  className,
}: AgentChatFileReferenceIconProps): ReactElement {
  const Icon = resolveFileReferenceIcon(kind);

  return <Icon className={cn("size-3.5", className)} />;
}

export const getAgentChatFileReferenceIconMarkup = (kind: AgentFileSearchResultKind): string => {
  return renderToStaticMarkup(
    createElement(AgentChatFileReferenceIcon, {
      kind,
      className: "size-3.5",
    }),
  );
};
