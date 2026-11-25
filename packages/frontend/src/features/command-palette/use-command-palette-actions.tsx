import { commandDefinition } from "../shortcuts/catalogue";
import { shortcutActionIdSchema, type ShortcutActionId } from "@openducktor/contracts";
import {
  type KanbanTaskCardView,
  THEME_PREFERENCE_VALUES,
  type ThemePreference,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ChartSpline,
  Columns3,
  Compass,
  Cpu,
  Download,
  FolderOpen,
  FolderPlus,
  GitMerge,
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
  Workflow,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useDiagnosticsPanel } from "@/components/features/diagnostics";
import { useProcessesActions } from "@/components/features/processes/processes-context";
import { useFeatureTour } from "@/features/feature-tour/feature-tour-context";
import { TASK_CARD_VIEW_OPTIONS } from "@openducktor/frontend-core/tasks/board/task-card-view-options";
import { TASK_CARD_VIEW_ICONS } from "@/components/features/kanban/task-card-view-options";
import { SETTINGS_SECTIONS } from "@/components/features/settings/settings-modal-constants";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import { useTheme } from "@/components/layout/theme-provider";
import { useWorkspaceDialogs } from "@/components/layout/workspace-dialogs-context";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import {
  issueImportActionLabel,
  issueImportBlockedReason,
  runIssueImport,
  toIssueImportState,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-provider";
import { taskCreationBlockedReason } from "@openducktor/frontend-core/tasks/board/task-creation-availability";
import { WORKFLOWS_ROUTE } from "@/features/workflows/workflow-routes";
import { USAGE_PATH } from "@/pages";
import { KANBAN_PATH } from "@/pages/kanban/kanban-task-link";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useKanbanTaskCardView } from "@/state/mutations/use-kanban-task-card-view";
import { useManualMergeCheckState } from "@/state/providers/manual-merge-check-context";
import { useManualPullRequestSyncState } from "@/state/providers/manual-pull-request-sync-provider";
import {
  classifyDiagnosticsQueryError,
  taskStoreCheckQueryOptionsOrSkip,
} from "@openducktor/frontend-core/queries/checks";
import { repositoryGitProviderContextQueryOptionsOrSkip } from "@openducktor/frontend-core/queries/git-provider-context";
import type { WorkspaceScopeAction, WorkspaceScopeTarget } from "@/types/workspace-scope";
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

export type ActionArgs = {
  /**
   * Read task store and provider readiness only from the cache. The always-mounted app command
   * owner uses it, so navigation starts no readiness reads; the open palette fetches them.
   */
  cachedReadiness?: boolean;
  /** The selected workspace of the scope. Without it, workspace actions use the active one. */
  scopeWorkspace: WorkspaceRecord | null;
  query: string;
  openScopeChoice: (action: WorkspaceScopeAction, workspace: WorkspaceScopeTarget | null) => void;
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

const renderIcon = (Icon: typeof Plus): ReactNode => <Icon />;

const MERGE_CHECK_KEYWORDS = [
  "merge detection",
  "merged branches",
  "detect merges",
  "check merges",
  "close merged tasks",
  "refresh merge status",
];

/** Why the merge check cannot start: no open workspace, or a check that still runs. */
function useMergeCheckDisabledReason(openWorkspaceCount: number): string | null {
  const { pendingScope } = useManualMergeCheckState();
  if (openWorkspaceCount === 0) return "Open a workspace to check merged tasks.";
  if (pendingScope) return `Merge check is running for ${pendingScope.label}.`;
  return null;
}

/** Every app action of the palette. Workspace actions run in the target workspace. */
export function useCommandPaletteActions({
  scopeWorkspace,
  cachedReadiness = false,
  openScopeChoice,
  query,
  shell,
  pageCommands,
  runIntent,
  previousFocus,
}: ActionArgs): CommandPaletteActions {
  const { workspaces, activeWorkspace, closedWorkspaces } = useWorkspaceState();
  const target = scopeWorkspace ?? activeWorkspace;
  const syncTarget = workspaces.find((entry) => entry.workspaceId === target?.workspaceId) ?? null;
  const { pendingScope } = useManualPullRequestSyncState();
  let syncDisabledReason: string | null = null;
  if (workspaces.length === 0) syncDisabledReason = "Open a workspace to sync pull requests.";
  if (pendingScope) syncDisabledReason = `Pull request sync is running for ${pendingScope.label}.`;
  const { themePreference, setThemePreference } = useTheme();
  const { taskCardView, changeTaskCardView } = useKanbanTaskCardView();
  const { openSettings } = useSettingsModal();
  const { openDiagnostics } = useDiagnosticsPanel();
  const processes = useProcessesActions();
  const { openFeatureTour } = useFeatureTour();
  const { openWorkspaceDialog } = useWorkspaceDialogs();
  const navigate = useNavigate();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const repoPath = target?.repoPath ?? null;
  const taskStoreCheck = useQuery({
    ...taskStoreCheckQueryOptionsOrSkip(target),
    enabled: !cachedReadiness && target !== null,
  });
  const gitProvider = useQuery({
    ...repositoryGitProviderContextQueryOptionsOrSkip(target),
    enabled: !cachedReadiness && target !== null,
  });
  const mergeCheckDisabledReason = useMergeCheckDisabledReason(workspaces.length);

  return useMemo(() => {
    const icon = renderIcon;
    const appAction = (
      key:
        | ShortcutActionId
        | "new-task-from-query"
        | `switch:${string}`
        | `page:${ShortcutActionId}`,
      actionIcon: ReactNode,
      keywords: readonly string[],
      run: () => void,
      options: {
        label?: string;
        suggested?: boolean;
        checked?: boolean;
        disabledReason?: string | null;
      } = {},
    ): PaletteAction => {
      const shortcutId = shortcutActionIdSchema.safeParse(key).data;
      const label =
        options.label ?? (shortcutId ? commandDefinition(shortcutId)?.label : undefined);
      if (!label) throw new Error(`Palette action ${key} has no label.`);
      return {
        key: `action:${key}`,
        shortcutId,
        label,
        workspaceName: null,
        icon: actionIcon,
        keywords,
        suggested: options.suggested ?? false,
        disabledReason: options.disabledReason ?? null,
        checked: options.checked ?? false,
        run,
      };
    };

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
        key: Parameters<typeof appAction>[0],
        actionIcon: ReactNode,
        keywords: readonly string[],
        run: WorkspaceIntent["run"],
        options: { label?: string; suggested?: boolean; disabledReason?: string | null } = {},
      ): PaletteAction => ({
        ...appAction(
          key,
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
          icon(Plus),
          ["create task", "add task", "issue", "ticket"],
          ({ workflow }) => workflow.onCreateTask(),
          { suggested: true, disabledReason: blockedReason },
        ),
        workspaceAction(
          "new-chat",
          icon(MessageCirclePlus),
          ["create session", "chat", "conversation", "ask"],
          () => openWorkspaceDialog({ kind: "chat", workspace: target }, previousFocus()),
          { suggested: true },
        ),
        workspaceAction(
          "import-tasks",
          icon(Download),
          ["import issues", "github", "gitlab", "azure devops", "work items", "provider"],
          () =>
            runIssueImport(importState, {
              openImport: (provider) =>
                openWorkspaceDialog(
                  { kind: "import_tasks", workspace: target, provider },
                  previousFocus(),
                ),
              openSettings: () => openSettings(),
            }),
          {
            suggested: true,
            disabledReason: blockedReason ?? issueImportBlockedReason(importState),
            label: issueImportActionLabel(importState),
          },
        ),
        workspaceAction(
          "import-chat",
          icon(Import),
          ["import session", "external session", "claude", "codex", "opencode", "antigravity"],
          () => openWorkspaceDialog({ kind: "import_chat", workspace: target }, previousFocus()),
          { suggested: true },
        ),
        workspaceAction(
          "archived-chats",
          icon(Archive),
          ["archive", "history", "old sessions", "restore session", "chat"],
          () => openWorkspaceDialog({ kind: "archived_chats", workspace: target }, previousFocus()),
        ),
        workspaceAction(
          "refresh-tasks",
          icon(RefreshCcw),
          ["reload", "sync", "update tasks"],
          ({ refreshTasks }) => void refreshTasks(),
        ),
        workspaceAction(
          "kanban",
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
          icon(Plus),
          [],
          ({ workflow }) => workflow.onCreateTask({ initialTitle: title }),
          { disabledReason: blockedReason, label: `New task “${title}”` },
        );
      }
    }

    const settingsActions = SETTINGS_SECTIONS.map((section) =>
      appAction(
        `settings:${section.id}`,
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

    const workspaceSwitches = cachedReadiness
      ? []
      : workspaces
          .filter((workspace) => workspace.workspaceId !== activeWorkspace?.workspaceId)
          .map((workspace) =>
            appAction(
              `switch:${workspace.workspaceId}`,
              <WorkspaceTile workspace={workspace} size="xs" />,
              ["workspace", "repository", "project", "open workspace"],
              () => runIntent({ workspaceId: workspace.workspaceId, run: () => {} }),
              { label: `Switch to ${workspace.workspaceName}` },
            ),
          );

    const themeActions = THEME_PREFERENCE_VALUES.map((preference) =>
      appAction(
        `theme:${preference}`,
        icon(THEME_ICONS[preference]),
        THEME_KEYWORDS[preference],
        () => setThemePreference(preference),
        { checked: themePreference === preference },
      ),
    );

    const taskCardViewActions = TASK_CARD_VIEW_OPTIONS.map((option) =>
      appAction(
        `task-cards:${option.value}`,
        icon(TASK_CARD_VIEW_ICONS[option.value]),
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
        "sync-pull-requests",
        icon(RefreshCcw),
        ["sync pull requests", "refresh pull requests", "sync PRs"],
        () => openScopeChoice("pull_request_sync", syncTarget),
        { disabledReason: syncDisabledReason },
      ),
      appAction(
        "check-merged-tasks",
        icon(GitMerge),
        MERGE_CHECK_KEYWORDS,
        () => openScopeChoice("merge_check", syncTarget),
        { disabledReason: mergeCheckDisabledReason },
      ),
      appAction("settings", icon(Settings), ["preferences", "configure"], () => openSettings(), {
        suggested: true,
      }),
      ...settingsActions,
      appAction(
        "usage",
        icon(ChartSpline),
        ["tokens", "cost", "spend", "price", "statistics", "charts"],
        () => guardTransition(() => void navigate(USAGE_PATH)),
      ),
      appAction(
        "workflows",
        icon(Workflow),
        ["workflow library", "workflow editor", "custom workflow", "states", "roles"],
        () => guardTransition(() => void navigate(WORKFLOWS_ROUTE)),
      ),
      appAction("diagnostics", icon(ShieldCheck), ["health", "checks"], openDiagnostics),
      ...(processes
        ? [
            appAction(
              "processes",
              icon(Cpu),
              ["ports", "servers", "dev server", "kill", "stop process", "localhost"],
              processes.toggleProcesses,
            ),
          ]
        : []),
      appAction(
        "feature-tour",
        icon(Compass),
        ["feature tour", "onboarding", "introduction", "guide", "help", "learn"],
        () => openFeatureTour(previousFocus()),
      ),
      ...workspaceSwitches,
      appAction(
        "open-repository",
        icon(FolderPlus),
        ["add workspace", "new workspace", "folder", "repo"],
        () => shell.openRepositoryModal("add"),
      ),
      ...(closedWorkspaces.length > 0
        ? [
            appAction(
              "reopen-workspace",
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
        icon(shell.isSidebarOpen ? PanelLeftClose : PanelLeftOpen),
        ["toggle sidebar", "layout", "collapse", "expand"],
        () => shell.setSidebarOpen(!shell.isSidebarOpen),
        { label: shell.isSidebarOpen ? "Hide sidebar" : "Show sidebar" },
      ),
      ...pageCommands.map((command) => ({
        ...appAction(
          `page:${command.id}`,
          icon(command.icon),
          command.keywords,
          command.resolveRun?.() ?? command.run,
          { label: command.label },
        ),
        shortcutId: command.id,
      })),
    ];

    return { actions, createFromQuery };
  }, [
    cachedReadiness,
    target,
    syncTarget,
    syncDisabledReason,
    themePreference,
    setThemePreference,
    taskCardView,
    changeTaskCardView,
    openSettings,
    openDiagnostics,
    processes,
    openFeatureTour,
    openWorkspaceDialog,
    navigate,
    guardTransition,
    repoPath,
    taskStoreCheck.data,
    taskStoreCheck.error,
    gitProvider.data,
    gitProvider.error,
    mergeCheckDisabledReason,
    openScopeChoice,
    shell,
    pageCommands,
    runIntent,
    previousFocus,
    query,
    workspaces,
    activeWorkspace?.workspaceId,
    closedWorkspaces.length,
  ]);
}
