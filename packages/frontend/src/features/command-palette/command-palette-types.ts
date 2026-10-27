import type { WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { OpenRepositoryModalView } from "@/components/features/repository/open-repository-modal";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

/** A command that a page adds while it is mounted, such as the panel toggles of a session page. */
export type CommandPalettePageCommand = {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords: readonly string[];
  run: () => void;
};

/** Shell state that the palette reads and changes. */
export type CommandPaletteShell = {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  openRepositoryModal: (view: OpenRepositoryModalView) => void;
};

export type PaletteAction = {
  key: string;
  label: string;
  /** The target workspace of a workspace action. */
  workspaceName: string | null;
  icon: ReactNode;
  /** Other words that find the action. */
  keywords: readonly string[];
  /** Shown with an empty query. */
  suggested: boolean;
  /** Why the action cannot run now, or null when it can. */
  disabledReason: string | null;
  checked: boolean;
  run: () => void;
};

export type PaletteTask = { key: string; workspace: WorkspaceRecord; task: TaskCard };

export type PaletteChat = {
  key: string;
  workspace: WorkspaceRecord;
  session: WorkspaceSession;
  title: string;
};

/** One action in the action list of a task or chat row. */
export type PaletteRowAction = {
  key: string;
  label: string;
  /** Short text after the label, such as the role of the latest session. */
  detail?: string;
  keywords: readonly string[];
  icon: ReactElement;
  destructive: boolean;
  disabled: boolean;
  run: () => void;
};
