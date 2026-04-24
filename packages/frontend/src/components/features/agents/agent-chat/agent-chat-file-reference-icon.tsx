import type { AgentFileSearchResultKind } from "@openducktor/core";
import { FileCode2, FileImage, FilePlay, FileText, FolderTree, Paintbrush } from "lucide-react";
import type { ReactElement } from "react";
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

const FILE_REFERENCE_ICON_MARKUP = {
  directory: {
    name: "folder-tree",
    paths:
      '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"></path><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"></path><path d="M3 5a2 2 0 0 0 2 2h3"></path><path d="M3 3v13a2 2 0 0 0 2 2h3"></path>',
  },
  css: {
    name: "paintbrush",
    paths:
      '<path d="m14.622 17.897-10.68-2.913"></path><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"></path><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"></path>',
  },
  code: {
    name: "file-code-corner",
    paths:
      '<path d="M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="m5 16-3 3 3 3"></path><path d="m9 22 3-3-3-3"></path>',
  },
  image: {
    name: "file-image",
    paths:
      '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><circle cx="10" cy="12" r="2"></circle><path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"></path>',
  },
  video: {
    name: "file-play",
    paths:
      '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M15.033 13.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56v-4.704a.645.645 0 0 1 .967-.56z"></path>',
  },
  default: {
    name: "file-text",
    paths:
      '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
  },
} satisfies Record<AgentFileSearchResultKind, { name: string; paths: string }>;

export function AgentChatFileReferenceIcon({
  kind,
  className,
}: AgentChatFileReferenceIconProps): ReactElement {
  const Icon = resolveFileReferenceIcon(kind);

  return <Icon className={cn("size-3.5", className)} />;
}

export const getAgentChatFileReferenceIconMarkup = (
  kind: AgentFileSearchResultKind,
  className = "size-3.5",
): string => {
  const { name, paths } = FILE_REFERENCE_ICON_MARKUP[kind] ?? FILE_REFERENCE_ICON_MARKUP.default;
  const classes = ["lucide", `lucide-${name}`, className].filter(Boolean).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${classes}" aria-hidden="true">${paths}</svg>`;
};
