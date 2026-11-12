import type { AgentFileSearchResultKind } from "@openducktor/core";
import { FileCode2, FileImage, FilePlay, FileText, FolderTree, Paintbrush } from "lucide-react";
import type { ReactElement } from "react";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import { resolveFileTypeIcon } from "@/components/ui/file-type-icons";
import { cn } from "@/lib/utils";

type AgentChatFileReferenceIconProps = {
  kind: AgentFileSearchResultKind;
  /** The path of the file, which picks the icon of its type, as the file tree shows it. */
  path: string;
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

/**
 * The icon of a file reference: the icon of the type of the file, as the file tree shows it, or
 * the icon of its kind when the file tree has none. A folder shows the folder icon.
 */
export function AgentChatFileReferenceIcon({
  kind,
  path,
  className,
}: AgentChatFileReferenceIconProps): ReactElement {
  if (kind !== "directory" && resolveFileTypeIcon(path)) {
    return <FileTypeIcon filePath={path} className={className} />;
  }
  const Icon = resolveFileReferenceIcon(kind);
  return <Icon className={cn("size-3.5", className)} />;
}
