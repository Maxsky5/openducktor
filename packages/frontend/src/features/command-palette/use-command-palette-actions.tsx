import {
  type KanbanTaskCardView,
  THEME_PREFERENCE_VALUES,
  type ThemePreference,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  Columns3,
  Download,
  FolderOpen,
  FolderPlus,
  Import,
  Laptop,
  MessageCirclePlus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { useDiagnosticsPanel } from "@/components/features/diagnostics";
import { TASK_CARD_VIEW_OPTIONS } from "@/components/features/kanban/task-card-view-options";
import { SETTINGS_SECTIONS } from "@/components/features/settings/settings-modal-constants";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import { THEME_PREFERENCE_LABELS } from "@/components/layout/theme-preference";
import { useTheme } from "@/components/layout/theme-provider";
import { useWorkspaceDialogs } from "@/components/layout/workspace-dialogs";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import {
  issueImportActionLabel,
  issueImportBlockedReason,
  runIssueImport,
  toIssueImportState,
} from "@/pages/kanban/issue-import-provider";
import { taskCreationBlockedReason } from "@/pages/kanban/task-creation-availability";
import { KANBAN_PATH } from "@/pages/kanban/kanban-task-link";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useKanbanTaskCardView } from "@/state/mutations/use-kanban-task-card-view";
import {
  classifyDiagnosticsQueryError,
  taskStoreCheckQueryOptionsOrSkip,
} from "@/state/queries/checks";
import { repositoryGitProviderContextQueryOptionsOrSkip } from "@/state/queries/git-provider-context";
import type {
  CommandPalettePageCommand,
  CommandPaletteShell,
  PaletteAction,
} from "./command-palette-types";
import type { WorkspaceIntent } from "./use-workspace-intent-runner";

const THEME_ICONS = { light: Sun, dark: Moon, system: Laptop } as const;

/** Each theme has its own words, so "theme light" finds Light and not the other themes. */
const THEME_KEYWORDS = {
  light: ["appearance", "light mode", "day"],
  dark: ["appearance", "dark mode", "night"],
  system: ["appearance", "auto", "os setting"],
} satisfies Record<ThemePreference, readonly string[]>;

/** Each card view has its own words, so "dense" finds Compact and not Normal. */
const TASK_CARD_VIEW_KEYWORDS = {
  normal: ["kanban", "card view", "comfortable", "large cards"],
  compact: ["kanban", "card view", "dense", "density", "small cards"],
} satisfies Record<KanbanTaskCardView, readonly string[]>;

type ActionArgs = {
  /** The selected workspace of the scope. Without it, workspace actions use the active one. */
  scopeWorkspace: WorkspaceRecord | null;
  query: string;
  shell: CommandPaletteShell;
  pageCommands: readonly CommandPalettePageCommand[];
  runIntent: (intent: WorkspaceIntent) => void;
  /** The element that had focus before the palette opened. Dialogs return focus there. */
  previousFocus: () => HTMLElement | null;
};

export type CommandPaletteActions = {
  actions: PaletteAction[];
  /** `New task “<query>”`, or null for an empty query or when no workspace is open. */
  createFromQuery: PaletteAction | null;
};

const icon = (Icon: typeof Plus): ReactNode => <Icon />;

/** Every app action of the palette. Workspace actions run in the target workspace. */
export function useCommandPaletteActions({
  scopeWorkspace,
  query,
  shell,
  pageCommands,
  runIntent,
  previousFocus,
}: ActionArgs): CommandPaletteActions {
  const { workspaces, activeWorkspace, closedWorkspaces } = useWorkspaceState();
  const target = scopeWorkspace ?? activeWorkspace;
  const { themePreference, setThemePreference } = useTheme();
  const { taskCardView, changeTaskCardView } = useKanbanTaskCardView();
  const { openSettings } = useSettingsModal();
  const { openDiagnostics } = useDiagnosticsPanel();
  const { openWorkspaceDialog } = useWorkspaceDialogs();
  const repoPath = target?.repoPath ?? null;
  const taskStoreCheck = useQuery(taskStoreCheckQueryOptionsOrSkip(repoPath));
  const gitProvider = useQuery(repositoryGitProviderContextQueryOptionsOrSkip(repoPath));

  const appAction = (
    key: string,
    label: string,
    actionIcon: ReactNode,
    keywords: readonly string[],
    run: () => void,
    options: { suggested?: boolean; checked?: boolean; disabledReason?: string | null } = {},
  ): PaletteAction => ({
    key: `action:${key}`,
    label,
    workspaceName: null,
    icon: actionIcon,
    keywords,
    suggested: options.suggested ?? false,
    disabledReason: options.disabledReason ?? null,
    checked: options.checked ?? false,
    run,
  });

  const workspaceActions: PaletteAction[] = [];
  let createFromQuery: PaletteAction | null = null;
  if (target) {
    const blockedReason = taskCreationBlockedReason({
      data: taskStoreCheck.data ?? null,
      error: taskStoreCheck.error
        ? classifyDiagnosticsQueryError(taskStoreCheck.error).message
        : null,
    });
    const importState = toIssueImportState(gitProvider.data, gitProvider.error);
    const workspaceAction = (
      key: string,
      label: string,
      actionIcon: ReactNode,
      keywords: readonly string[],
      run: WorkspaceIntent["run"],
      options: { suggested?: boolean; disabledReason?: string | null } = {},
    ): PaletteAction => ({
      ...appAction(
        key,
        label,
        actionIcon,
        keywords,
        () => runIntent({ workspaceId: target.workspaceId, run }),
        options,
      ),
      workspaceName: target.workspaceName,
    });

    workspaceActions.push(
      workspaceAction(
        "new-task",
        "New task",
        icon(Plus),
        ["create task", "add task", "issue", "ticket"],
        ({ workflow }) => workflow.onCreateTask(),
        { suggested: true, disabledReason: blockedReason },
      ),
      workspaceAction(
        "new-chat",
        "New chat",
        icon(MessageCirclePlus),
        ["create chat", "conversation", "session", "ask"],
        () => openWorkspaceDialog({ kind: "chat", workspace: target }, previousFocus()),
        { suggested: true },
      ),
      workspaceAction(
        "import-tasks",
        issueImportActionLabel(importState),
        icon(Download),
        ["import issues", "github", "azure devops", "work items", "provider"],
        () =>
          runIssueImport(importState, {
            openImport: (provider) =>
              openWorkspaceDialog(
                { kind: "import_tasks", workspace: target, provider },
                previousFocus(),
              ),
            openSettings: () => openSettings(),
          }),
        { suggested: true, disabledReason: blockedReason ?? issueImportBlockedReason(importState) },
      ),
      workspaceAction(
        "import-chat",
        "Import chat from an external runtime",
        icon(Import),
        ["import session", "external session", "claude", "codex", "opencode"],
        () => openWorkspaceDialog({ kind: "import_chat", workspace: target }, previousFocus()),
        { suggested: true },
      ),
      workspaceAction(
        "archived-chats",
        "Archived chats",
        icon(Archive),
        ["archive", "history", "old chats", "restore chat"],
        () => openWorkspaceDialog({ kind: "archived_chats", workspace: target }, previousFocus()),
      ),
      workspaceAction(
        "refresh-tasks",
        "Refresh tasks",
        icon(RefreshCcw),
        ["reload", "sync", "update tasks"],
        ({ refreshTasks }) => void refreshTasks(),
      ),
      workspaceAction(
        "kanban",
        "Go to Kanban",
        icon(Columns3),
        ["board", "tasks", "home", "open kanban"],
        ({ navigate }) => navigate(KANBAN_PATH),
        { suggested: true },
      ),
    );

    const title = query.trim();
    if (title) {
      createFromQuery = workspaceAction(
        "new-task-from-query",
        `New task “${title}”`,
        icon(Plus),
        [],
        ({ workflow }) => workflow.onCreateTask({ initialTitle: title }),
        { disabledReason: blockedReason },
      );
    }
  }

  const settingsActions = SETTINGS_SECTIONS.map((section) =>
    appAction(
      `settings:${section.id}`,
      `Settings: ${section.label}`,
      icon(section.icon),
      ["settings", "preferences", "configure"],
      () =>
        openSettings({
          deepLink:
            section.id === "repositories"
              ? { kind: "repository-configuration", repositoryPath: repoPath }
              : { kind: "global", section: section.id },
        }),
    ),
  );

  const workspaceSwitches = workspaces
    .filter((workspace) => workspace.workspaceId !== activeWorkspace?.workspaceId)
    .map((workspace) =>
      appAction(
        `switch:${workspace.workspaceId}`,
        `Switch to ${workspace.workspaceName}`,
        <WorkspaceTile workspace={workspace} size="xs" />,
        ["workspace", "repository", "project", "open workspace"],
        () => runIntent({ workspaceId: workspace.workspaceId, run: () => {} }),
      ),
    );

  const themeActions = THEME_PREFERENCE_VALUES.map((preference) =>
    appAction(
      `theme:${preference}`,
      `Theme: ${THEME_PREFERENCE_LABELS[preference]}`,
      icon(THEME_ICONS[preference]),
      THEME_KEYWORDS[preference],
      () => setThemePreference(preference),
      { checked: themePreference === preference },
    ),
  );

  const taskCardViewActions = TASK_CARD_VIEW_OPTIONS.map((option) =>
    appAction(
      `task-cards:${option.value}`,
      `Task cards: ${option.label}`,
      icon(option.icon),
      TASK_CARD_VIEW_KEYWORDS[option.value],
      () => changeTaskCardView(option.value),
      {
        checked: taskCardView === option.value,
        disabledReason: taskCardView === null ? "Settings are not loaded yet." : null,
      },
    ),
  );

  const actions = [
    ...workspaceActions,
    appAction(
      "settings",
      "Open settings",
      icon(Settings),
      ["preferences", "configure"],
      () => openSettings(),
      { suggested: true },
    ),
    ...settingsActions,
    appAction(
      "diagnostics",
      "Open diagnostics",
      icon(ShieldCheck),
      ["health", "checks"],
      openDiagnostics,
    ),
    ...workspaceSwitches,
    appAction(
      "open-repository",
      "Open repository",
      icon(FolderPlus),
      ["add workspace", "new workspace", "folder", "repo"],
      () => shell.openRepositoryModal("add"),
    ),
    ...(closedWorkspaces.length > 0
      ? [
          appAction(
            "reopen-workspace",
            "Reopen a workspace",
            icon(FolderOpen),
            ["closed workspace", "restore workspace"],
            () => shell.openRepositoryModal("reopen"),
          ),
        ]
      : []),
    ...themeActions,
    ...taskCardViewActions,
    appAction(
      "sidebar",
      shell.isSidebarOpen ? "Hide sidebar" : "Show sidebar",
      icon(shell.isSidebarOpen ? PanelLeftClose : PanelLeftOpen),
      ["toggle sidebar", "layout", "collapse", "expand"],
      () => shell.setSidebarOpen(!shell.isSidebarOpen),
    ),
    ...pageCommands.map((command) =>
      appAction(
        `page:${command.id}`,
        command.label,
        icon(command.icon),
        command.keywords,
        command.run,
      ),
    ),
  ];

  return { actions, createFromQuery };
}
