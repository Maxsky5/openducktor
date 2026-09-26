import { createContext, use } from "react";
import type { TaskExecutionSelectedFile } from "../task-execution-file-explorer-model";

export type ChatFileLinkOwner = {
  repoPath: string | null;
  ownerKey: string;
  onSelectFile(file: TaskExecutionSelectedFile, trigger: HTMLAnchorElement): void;
} & (
  | { taskId: string | null; kind?: never; workingDirectory?: never }
  | { kind: "workspace"; workingDirectory: string | null; taskId?: never }
);

export const ChatFileLinkContext = createContext<
  ((href: string, trigger: HTMLAnchorElement) => void) | null
>(null);
export const useChatFileLinkAction = () => use(ChatFileLinkContext);
