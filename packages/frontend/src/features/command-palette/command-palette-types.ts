import type { WorkspaceRecord, WorkspaceSession, ShortcutActionId } from "@openducktor/contracts";
import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { OpenRepositoryModalView } from "@/components/features/repository/open-repository-modal";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

type CommandTarget = {
  kind: "app" | "workspace" | "task" | "chat" | "session" | "panel" | "item" | "overlay";
  key: string;
  sessionKey?: string;
};

/** A command that a page adds while it is mounted, such as the panel toggles of a session page. */
export type CommandPalettePageCommand = {
  id: ShortcutActionId;
  label: string;
  icon: LucideIcon;
  keywords: readonly string[];
  run: () => void;
  resolveRun?: () => (() => void) | null;
  target?: CommandTarget;
  focusRoot?: (() => HTMLElement | null) | undefined;
  isVisible?: () => boolean;
  disabledReason?: () => string | null;
  ownsInput?: boolean;
  /** Not listed by the palette: an action of one local view, or an app command below. */
  localOnly?: boolean;
  paletteOnly?: boolean;
  /** Registered by the app command owner. A page owner of the same command comes first. */
  appWide?: boolean;
};

export type CommandPaletteCommandRegistration = Omit<
  CommandPalettePageCommand,
  "label" | "icon" | "keywords"
> & { label?: string | undefined; icon?: LucideIcon; keywords?: readonly string[] };

/** Shell state that the palette reads and changes. */
export type CommandPaletteShell = {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  openRepositoryModal: (view: OpenRepositoryModalView) => void;
};

export type PaletteAction = {
  key: string;
  /** The shortcut command that this action runs, for its key caps. */
  shortcutId?: ShortcutActionId | undefined;
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
