import { PanelLeftClose, PanelLeftOpen, TriangleAlert } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchTaskArtifacts } from "@openducktor/frontend-core/queries/artifacts";
import { DiagnosticsTrigger } from "@/components/features/diagnostics";
import { SettingsModal } from "@/components/features/settings/settings-modal";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CommandPaletteTrigger } from "@/features/command-palette/command-palette-trigger";
import {
  sessionNavigationTargetKey,
  type SessionNavigationTarget,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";
import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";
import { useSessionGrouping } from "@openducktor/frontend-core/sessions/navigation/use-session-grouping";
import { useSessionNavigationModel } from "@openducktor/frontend-core/sessions/navigation/use-session-navigation-model";
import { useVisibleSessionControls } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { useWatchSessionBlockers } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state/app-state-provider";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { AppBrand } from "./app-brand";
import { SessionCreateSplitAction } from "./session-create-split-action";
import { SessionNavigationList } from "./session-navigation-list";
import { SessionNavigationRail } from "./session-navigation-rail";
import { SessionGroupingToggle } from "./session-grouping-toggle";
import { type SessionNavigationScope, SessionScopeSwitch } from "./session-scope-switch";
import { SidebarNavigation } from "./sidebar-navigation";
import { SessionSelectionScope } from "./session-selection-scope";

type WorkspaceSidebarProps = {
  isOpen: boolean;
  onHide: () => void;
  onShow: () => void;
  onOpenRepositoryModal: () => void;
};

const SESSION_SCOPE_STORAGE_KEY = "openducktor:sidebar:session-scope";

type SessionScopeState = {
  scope: SessionNavigationScope;
  error: string | null;
};

function UnlistedWorkspacesNote({
  onOpenRepositoryModal,
}: {
  onOpenRepositoryModal: () => void;
}): ReactElement | null {
  const { closedWorkspaces, incompleteRemovals } = useWorkspaceState();
  if (closedWorkspaces.length === 0 && incompleteRemovals.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-sidebar-border px-2.5 py-2 text-xs text-sidebar-muted-foreground">
      {closedWorkspaces.length > 0 ? (
        <p>
          {`Not listed because they are closed: ${closedWorkspaces
            .map((workspace) => workspace.workspaceName)
            .join(", ")}.`}{" "}
          <button
            type="button"
            className="cursor-pointer font-medium text-sidebar-foreground underline underline-offset-2"
            onClick={onOpenRepositoryModal}
          >
            Reopen a workspace
          </button>
        </p>
      ) : null}
      {incompleteRemovals.map((removal) => (
        <p key={removal.workspace.workspaceId}>
          {`${removal.workspace.workspaceName} is not listed because its removal is incomplete. Finish it from the warning button in the workspace list.`}
        </p>
      ))}
    </div>
  );
}

/** The collapsed list keeps the unlisted workspaces behind one warning button. */
function CollapsedUnlistedWorkspaces({
  onOpenRepositoryModal,
}: {
  onOpenRepositoryModal: () => void;
}): ReactElement | null {
  const { closedWorkspaces, incompleteRemovals } = useWorkspaceState();
  const [open, setOpen] = useState(false);
  const count = closedWorkspaces.length + incompleteRemovals.length;
  if (count === 0) return null;
  const label = `${count} ${count === 1 ? "workspace is" : "workspaces are"} not listed`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-warning-accent hover:text-warning-accent"
          aria-label={label}
          title={label}
        >
          <TriangleAlert className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 p-2">
        <UnlistedWorkspacesNote
          onOpenRepositoryModal={() => {
            setOpen(false);
            onOpenRepositoryModal();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The sidebar lists task and workspace sessions with the saved workspace scope. */
export function WorkspaceSidebar({
  isOpen,
  onHide,
  onShow,
  onOpenRepositoryModal,
}: WorkspaceSidebarProps): ReactElement {
  const queryClient = useQueryClient();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const { workspaces, activeWorkspace, isSwitchingWorkspace, selectWorkspace } =
    useWorkspaceState();
  const navigate = useNavigate();
  const [{ scope, error: scopeError }, setScope] = useState(readScope);
  useEffect(() => {
    if (scopeError === null) return;
    toast.error("Could not restore the session list scope.", {
      description: `Allow local storage for this app, then reload. ${scopeError}`,
    });
  }, [scopeError]);
  const changeScope = useCallback((scope: SessionNavigationScope) => {
    try {
      globalThis.localStorage.setItem(SESSION_SCOPE_STORAGE_KEY, scope);
      setScope({ scope, error: null });
    } catch (error) {
      toast.error("Could not save the session list scope.", {
        description: `Allow local storage for this app, then try again. ${errorMessage(error)}`,
      });
    }
  }, []);
  const scopedWorkspaces = useMemo(() => {
    if (scope === "all") return workspaces;
    return activeWorkspace ? [activeWorkspace] : [];
  }, [activeWorkspace, scope, workspaces]);
  const { grouping, disabled: groupingDisabled, changeGrouping } = useSessionGrouping();
  const { model, retrySource } = useSessionNavigationModel(scopedWorkspaces, grouping);
  useWatchSessionBlockers(model);
  const { readVisible } = useVisibleSessionControls();
  const now = useMinuteClock();
  const listScopeKey =
    scope === "all" ? scope : `${scope}:${activeWorkspace?.workspaceId ?? "none"}`;

  const navigation = useRef({
    queryClient,
    activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
    isSwitchingWorkspace,
    guardTransition,
    navigate,
    readVisible,
    selectWorkspace,
  });
  useLayoutEffect(() => {
    navigation.current = {
      queryClient,
      activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
      isSwitchingWorkspace,
      guardTransition,
      navigate,
      readVisible,
      selectWorkspace,
    };
  }, [
    queryClient,
    activeWorkspace?.workspaceId,
    isSwitchingWorkspace,
    guardTransition,
    navigate,
    readVisible,
    selectWorkspace,
  ]);
  const openEntry = useCallback(
    (entry: SessionNavigationEntry, target: SessionNavigationTarget = entry.target): void => {
      const {
        queryClient,
        activeWorkspaceId,
        isSwitchingWorkspace,
        guardTransition,
        navigate,
        readVisible,
        selectWorkspace,
      } = navigation.current;
      const visible = readVisible();
      // Reopening the visible session can cancel a pending workspace switch.
      if (
        !isSwitchingWorkspace &&
        visible &&
        sessionNavigationTargetKey(target) === sessionNavigationTargetKey(visible.target)
      )
        return;
      const href = buildSessionNavigationHref(target);
      guardTransition(() => {
        if (target.kind !== "workspace_session") {
          void prefetchTaskArtifacts(
            queryClient,
            entry.workspace.repoPath,
            target.taskId,
            target.role,
          );
        }
        // The Sessions page opens the workspace that the address names.
        void navigate(href);
        // An entry of the active workspace cancels a pending switch. Selection reports failures.
        if (isSwitchingWorkspace && target.workspaceId === activeWorkspaceId) {
          void selectWorkspace(target.workspaceId).catch(() => {});
        }
      });
    },
    [],
  );

  return (
    <aside
      aria-label="Sessions sidebar"
      className={cn(
        "workspace-sidebar flex h-full min-w-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
        isOpen ? "w-80" : "w-16",
      )}
    >
      {isOpen ? (
        <>
          <div className="electron-sidebar-content-open flex flex-col gap-3 border-b border-sidebar-border p-4">
            <div className="electron-sidebar-heading flex items-center justify-between gap-2">
              <div className="electron-sidebar-brand flex min-w-0 flex-1 items-center justify-between gap-2">
                <AppBrand />
                <CommandPaletteTrigger className="electron-sidebar-search" />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mt-0.5 size-8 shrink-0 text-sidebar-muted-foreground hover:text-sidebar-foreground"
                onClick={onHide}
                aria-label="Hide sidebar"
                title="Hide sidebar"
              >
                <PanelLeftClose className="size-4" />
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <SidebarNavigation onBeforeNavigate={guardTransition} />
              <SessionCreateSplitAction />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
            <div className="min-w-0 flex-1">
              <SessionScopeSwitch
                scope={scope}
                onScopeChange={changeScope}
                workspace={activeWorkspace}
              />
            </div>
            <SessionGroupingToggle
              grouping={grouping}
              onChange={changeGrouping}
              disabled={groupingDisabled}
            />
          </div>
          <SessionSelectionScope
            model={model}
            grouping={grouping}
            mode="list"
            className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3"
          >
            <SessionNavigationList
              key={listScopeKey}
              model={model}
              now={now}
              onOpen={openEntry}
              onRetry={retrySource}
              footer={
                scope === "all" ? (
                  <UnlistedWorkspacesNote onOpenRepositoryModal={onOpenRepositoryModal} />
                ) : null
              }
            />
          </SessionSelectionScope>
          <div className="flex items-center gap-1 border-t border-sidebar-border p-2">
            <SettingsModal
              triggerClassName="flex-1 justify-start border-transparent bg-transparent px-3 shadow-none text-sidebar-foreground"
              triggerSize="default"
            />
            <DiagnosticsTrigger className="border-transparent bg-transparent shadow-none" />
          </div>
        </>
      ) : (
        <div className="electron-sidebar-content-collapsed flex h-full min-h-0 flex-col items-center gap-2 px-1 py-2">
          <div className="electron-sidebar-collapsed-title-row flex w-full items-center justify-center">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="electron-sidebar-collapsed-toggle size-8 text-sidebar-muted-foreground hover:text-sidebar-foreground"
              onClick={onShow}
              aria-label="Show sidebar"
              title="Show sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </div>
          <div className="flex w-full flex-col items-center gap-1.5">
            <CommandPaletteTrigger compact />
            <SidebarNavigation compact onBeforeNavigate={guardTransition} />
            <SessionCreateSplitAction compact />
          </div>
          <div className="flex w-full shrink-0 flex-col items-center gap-2 border-t border-sidebar-border pt-2">
            <SessionScopeSwitch
              scope={scope}
              onScopeChange={changeScope}
              workspace={activeWorkspace}
              compact
            />
            {scope === "all" ? (
              <CollapsedUnlistedWorkspaces onOpenRepositoryModal={onOpenRepositoryModal} />
            ) : null}
          </div>
          <SessionSelectionScope
            model={model}
            grouping={grouping}
            mode="rail"
            className="hide-scrollbar min-h-0 w-full flex-1 overflow-y-auto px-0.5 pb-2 pt-1"
          >
            <SessionNavigationRail
              key={listScopeKey}
              model={model}
              now={now}
              onOpen={openEntry}
              onRetry={retrySource}
            />
          </SessionSelectionScope>
          <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-sidebar-border pt-2">
            <DiagnosticsTrigger className="size-9 border-transparent bg-transparent text-sidebar-muted-foreground shadow-none hover:text-sidebar-foreground" />
            <SettingsModal
              triggerClassName="size-9 border-transparent bg-transparent text-sidebar-muted-foreground shadow-none hover:text-sidebar-foreground"
              triggerSize="icon"
              triggerIconOnly
            />
          </div>
        </div>
      )}
    </aside>
  );
}

function readScope(): SessionScopeState {
  try {
    const saved = globalThis.localStorage.getItem(SESSION_SCOPE_STORAGE_KEY);
    return { scope: saved === "all" ? "all" : "current", error: null };
  } catch (error) {
    return { scope: "current", error: errorMessage(error) };
  }
}
