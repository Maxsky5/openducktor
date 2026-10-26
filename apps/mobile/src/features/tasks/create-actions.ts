import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  issueImportActionLabel,
  issueImportBlockedReason,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-provider";
import { useRouter } from "expo-router";
import { useFeedbackStore } from "@/app-shell/app-services";
import { useBoardAvailability } from "./board/use-board-availability";
import { routes } from "@/navigation/routes";
import { haptics } from "@/ui/haptics";
import type { IconName } from "@/ui/icon";

type CreateActionId = "task" | "chat" | "import";

export type CreateAction = {
  id: CreateActionId;
  label: string;
  accessibilityLabel: string;
  icon: IconName;
  /** Why the action cannot run now, or null when it can. */
  blockedReason: string | null;
};

const NO_WORKSPACE = "Open a workspace on the host first.";

const workspaceActions = (
  creationBlockedReason: string | null,
  importLabel: string,
  importBlockedReason: string | null,
): CreateAction[] => [
  {
    id: "task",
    label: "New Task",
    accessibilityLabel: "New task",
    icon: "clipboard-list",
    blockedReason: creationBlockedReason,
  },
  {
    id: "chat",
    label: "New Chat",
    accessibilityLabel: "New chat",
    icon: "message-circle-plus",
    blockedReason: null,
  },
  {
    id: "import",
    label: "Import",
    accessibilityLabel: importLabel,
    icon: "download",
    blockedReason: importBlockedReason ?? creationBlockedReason,
  },
];

/** The create actions without a workspace: each one says to open a workspace first. */
export const NO_WORKSPACE_ACTIONS: readonly CreateAction[] = workspaceActions(
  NO_WORKSPACE,
  "Import",
  NO_WORKSPACE,
).map((action) => ({ ...action, blockedReason: NO_WORKSPACE }));

/** The create actions of a workspace, with the availability that the board also uses. */
export const useWorkspaceCreateActions = (workspace: WorkspaceRecord): CreateAction[] => {
  const { creationBlockedReason, importState } = useBoardAvailability(workspace);
  return workspaceActions(
    creationBlockedReason,
    issueImportActionLabel(importState),
    issueImportBlockedReason(importState),
  );
};

/** Opens the sheet of an action, or tells why the action cannot run now. */
export const useRunCreateAction = (workspaceId: string | null, onClose: () => void) => {
  const router = useRouter();
  const { feedback } = useFeedbackStore();
  return (action: CreateAction): void => {
    if (action.blockedReason !== null || workspaceId === null) {
      haptics.error();
      feedback.show("info", action.blockedReason ?? NO_WORKSPACE);
      return;
    }
    haptics.selection();
    onClose();
    if (action.id === "task") router.push(routes.newTask(workspaceId));
    if (action.id === "chat") router.push(routes.newChat(workspaceId));
    if (action.id === "import") router.push(routes.importIssues(workspaceId));
  };
};
