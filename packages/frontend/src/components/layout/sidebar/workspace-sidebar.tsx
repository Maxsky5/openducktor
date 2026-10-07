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
import { DiagnosticsPanel } from "@/components/features/diagnostics";
import { SettingsModal } from "@/components/features/settings/settings-modal";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  buildSessionNavigationHref,
  sessionNavigationTargetKey,
  type SessionNavigationTarget,
} from "@/features/session-navigation/session-navigation-target";
import { useSessionNavigationModel } from "@/features/session-navigation/use-session-navigation-model";
import { useVisibleSessionTarget } from "@/features/session-navigation/visible-session-target";
import { useWatchSessionBlockers } from "@/features/session-navigation/session-read-state";
import { useMinuteClock } from "@/lib/relative-time";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useSidebarSessionGrouping } from "@/state/mutations/use-sidebar-session-grouping";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { AppBrand } from "./app-brand";
import { SessionCreateSplitAction } from "./session-create-split-action";
import { SessionNavigationList } from "./session-navigation-list";
import { SessionNavigationRail } from "./session-navigation-rail";
import { SessionMenuProvider } from "./session-menu-provider";
import { SessionGroupingToggle } from "./session-grouping-toggle";
import { type SessionNavigationScope, SessionScopeSwitch } from "./session-scope-switch";
import { SidebarNavigation } from "./sidebar-navigation";
import { useRevealSelectedSession } from "./use-reveal-selected-session";
import { selectSessionEntry } from "./session-navigation-selection";

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
  const { grouping, disabled: groupingDisabled, changeGrouping } = useSidebarSessionGrouping();
  const { model, retrySource } = useSessionNavigationModel(scopedWorkspaces, grouping);
  useWatchSessionBlockers(model);
  const visibleTarget = useVisibleSessionTarget();
  const selection = selectSessionEntry(model, visibleTarget, grouping);
  const sessionsRegionRef = useRevealSelectedSession(model, selection, isOpen ? "list" : "rail");
  const now = useMinuteClock();
  const listScopeKey =
    scope === "all" ? scope : `${scope}:${activeWorkspace?.workspaceId ?? "none"}`;

  const navigation = useRef({
    activeWorkspace,
    visibleTarget,
    isSwitchingWorkspace,
    guardTransition,
    navigate,
    selectWorkspace,
  });
  useLayoutEffect(() => {
    navigation.current = {
      activeWorkspace,
      visibleTarget,
      isSwitchingWorkspace,
      guardTransition,
      navigate,
      selectWorkspace,
    };
  }, [
    activeWorkspace,
    visibleTarget,
    isSwitchingWorkspace,
    guardTransition,
    navigate,
    selectWorkspace,
  ]);
  const openEntry = useCallback(
    (entry: SessionNavigationEntry, target: SessionNavigationTarget = entry.target): void => {
      const {
        activeWorkspace,
        visibleTarget,
        isSwitchingWorkspace,
        guardTransition,
        navigate,
        selectWorkspace,
      } = navigation.current;
      // Reopening the visible session can cancel a pending workspace switch.
      if (
        !isSwitchingWorkspace &&
        visibleTarget &&
        sessionNavigationTargetKey(target) === sessionNavigationTargetKey(visibleTarget)
      )
        return;
      const href = buildSessionNavigationHref(target);
      guardTransition(() => {
        if (target.workspaceId === activeWorkspace?.workspaceId && !isSwitchingWorkspace) {
          void navigate(href);
          return;
        }
        // Selection reports host failures; leave the current conversation open on failure.
        void selectWorkspace(target.workspaceId, () => {
          void navigate(href);
        }).catch(() => {});
      });
    },
    [],
  );

  return (
    <SessionMenuProvider>
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
                <div className="electron-sidebar-brand">
                  <AppBrand />
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
            <div
              ref={sessionsRegionRef}
              className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3"
              data-sidebar-scroll-region="sessions"
            >
              <SessionNavigationList
                key={listScopeKey}
                model={model}
                selection={selection}
                now={now}
                onOpen={openEntry}
                onRetry={retrySource}
                footer={
                  scope === "all" ? (
                    <UnlistedWorkspacesNote onOpenRepositoryModal={onOpenRepositoryModal} />
                  ) : null
                }
              />
            </div>
            <div className="flex items-center gap-1 border-t border-sidebar-border p-2">
              <SettingsModal
                triggerClassName="flex-1 justify-start border-transparent bg-transparent px-3 shadow-none text-sidebar-foreground"
                triggerSize="default"
              />
              <DiagnosticsPanel
                triggerVariant="icon"
                triggerClassName="border-transparent bg-transparent shadow-none"
              />
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
            <div
              ref={sessionsRegionRef}
              className="hide-scrollbar min-h-0 w-full flex-1 overflow-y-auto px-0.5 pb-2 pt-1"
            >
              <SessionNavigationRail
                key={listScopeKey}
                model={model}
                selection={selection}
                now={now}
                onOpen={openEntry}
                onRetry={retrySource}
              />
            </div>
            <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-sidebar-border pt-2">
              <DiagnosticsPanel
                triggerClassName="size-9 border-transparent bg-transparent text-sidebar-muted-foreground shadow-none hover:text-sidebar-foreground"
                triggerVariant="icon"
              />
              <SettingsModal
                triggerClassName="size-9 border-transparent bg-transparent text-sidebar-muted-foreground shadow-none hover:text-sidebar-foreground"
                triggerSize="icon"
                triggerIconOnly
              />
            </div>
          </div>
        )}
      </aside>
    </SessionMenuProvider>
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
