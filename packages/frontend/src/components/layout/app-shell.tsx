import { DiagnosticsPanel } from "@/components/features/diagnostics";
import { LoaderCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { memo, type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { OpenRepositoryModal } from "@/components/features/repository/open-repository-modal";
import { AgentChatTranscriptCacheProvider } from "@/components/features/agents/agent-chat/agent-chat-transcript-cache-provider";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import { WorkspaceSidebar } from "@/components/layout/sidebar";
import { WorkspaceRail } from "@/components/layout/workspace-rail";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { Button } from "@/components/ui/button";
import { VisibleSessionTargetProvider } from "@/features/session-navigation/visible-session-target";
import { SessionReadStateProvider } from "@/features/session-navigation/session-read-state";
import { OnboardingPage } from "@/pages/onboarding/onboarding-page";
import {
  useActiveWorkspace,
  useWorkspacePresence,
  useWorkspaceState,
} from "@/state/app-state-provider";
import { repoConfigQueryOptions } from "@/state/queries/workspace";

type AppShellSidebarPreference = "opened" | "collapsed";

const APP_SHELL_LEFT_SIDEBAR_STORAGE_KEY = "openducktor:app-shell:left-sidebar";
const DEFAULT_APP_SHELL_SIDEBAR_PREFERENCE: AppShellSidebarPreference = "opened";
const NO_ACTIVE_WORKSPACE_ID = "__no_active_workspace__";

const isAppShellSidebarPreference = (value: string | null): value is AppShellSidebarPreference =>
  value === "opened" || value === "collapsed";

const readPersistedLeftSidebarPreference = (): AppShellSidebarPreference => {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return DEFAULT_APP_SHELL_SIDEBAR_PREFERENCE;
    }

    const preference = storage.getItem(APP_SHELL_LEFT_SIDEBAR_STORAGE_KEY);
    if (isAppShellSidebarPreference(preference)) {
      return preference;
    }

    return DEFAULT_APP_SHELL_SIDEBAR_PREFERENCE;
  } catch (error) {
    console.error("[app-shell] Failed to read persisted sidebar state.", { error });
    return DEFAULT_APP_SHELL_SIDEBAR_PREFERENCE;
  }
};

const persistLeftSidebarPreference = (preference: AppShellSidebarPreference): void => {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return;
    }

    storage.setItem(APP_SHELL_LEFT_SIDEBAR_STORAGE_KEY, preference);
  } catch (error) {
    console.error("[app-shell] Failed to persist sidebar state.", { preference, error });
  }
};

const WorkspaceAppShell = memo(function WorkspaceAppShell(): ReactElement {
  const { run: guardWorkspaceChange } = useWorkspacePreviewTransitionGuard();
  const activeWorkspace = useActiveWorkspace();
  const { workspaces } = useWorkspaceState();
  useQuery({
    ...repoConfigQueryOptions(activeWorkspace?.workspaceId ?? NO_ACTIVE_WORKSPACE_ID),
    enabled: activeWorkspace !== null,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const [isRepositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(
    () => readPersistedLeftSidebarPreference() === "opened",
  );
  useEffect(() => {
    if (workspaces.length === 0) setRepositoryModalOpen(true);
  }, [workspaces.length]);

  const handleRepositoryModalOpenChange = useCallback((open: boolean) => {
    setRepositoryModalOpen(open);
  }, []);

  const openRepositoryModal = useCallback(() => {
    setRepositoryModalOpen(true);
  }, []);

  const handleHideSidebar = useCallback(() => {
    setSidebarOpen(false);
    persistLeftSidebarPreference("collapsed");
  }, []);

  const handleShowSidebar = useCallback(() => {
    setSidebarOpen(true);
    persistLeftSidebarPreference("opened");
  }, []);

  return (
    <VisibleSessionTargetProvider>
      <SessionReadStateProvider>
        <div
          className="app-shell relative h-screen min-h-screen w-full overflow-hidden"
          data-sidebar-state={isSidebarOpen ? "open" : "collapsed"}
        >
          <div
            className="electron-native-controls-surface absolute left-0 top-0 z-10 w-[72px] bg-sidebar"
            aria-hidden="true"
          />
          <div className="flex h-full min-h-0 w-full">
            <WorkspaceRail onOpenRepositoryModal={openRepositoryModal} />

            <WorkspaceSidebar
              isOpen={isSidebarOpen}
              onHide={handleHideSidebar}
              onShow={handleShowSidebar}
              onOpenRepositoryModal={openRepositoryModal}
            />

            <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
              <main
                data-main-scroll-container="true"
                className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
              >
                <DiffWorkerProvider>
                  <AgentChatTranscriptCacheProvider>
                    <Outlet />
                  </AgentChatTranscriptCacheProvider>
                </DiffWorkerProvider>
              </main>
            </section>
          </div>
        </div>
        <OpenRepositoryModal
          open={isRepositoryModalOpen}
          canClose
          onOpenChange={handleRepositoryModalOpenChange}
          requestTransition={guardWorkspaceChange}
        />
      </SessionReadStateProvider>
    </VisibleSessionTargetProvider>
  );
});

export const AppShell = memo(function AppShell(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const onboardingStartedWithoutWorkspaceRef = useRef(false);
  const {
    hasWorkspaces,
    hasLoadedWorkspaceList,
    isLoadingWorkspaces,
    workspaceLoadError,
    retryWorkspaces,
  } = useWorkspacePresence();
  const isOnboardingRoute = location.pathname === "/onboarding";

  useEffect(() => {
    if (!isOnboardingRoute) {
      onboardingStartedWithoutWorkspaceRef.current = false;
    } else if (!isLoadingWorkspaces && !workspaceLoadError && !hasWorkspaces) {
      onboardingStartedWithoutWorkspaceRef.current = true;
    }
  }, [hasWorkspaces, isLoadingWorkspaces, isOnboardingRoute, workspaceLoadError]);

  const completeOnboarding = useCallback((): void => {
    navigate("/kanban", { replace: true, flushSync: true });
  }, [navigate]);

  const retryWorkspaceLoad = useCallback((): void => {
    void retryWorkspaces().catch(() => undefined);
  }, [retryWorkspaces]);

  if (isLoadingWorkspaces) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-4 animate-spin" />
          Loading workspaces…
        </div>
      </main>
    );
  }

  if (workspaceLoadError && !hasLoadedWorkspaceList) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div
          className="flex max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-6"
          role="alert"
        >
          <h1 className="font-semibold">OpenDucktor could not load your workspaces</h1>
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {workspaceLoadError.message}
          </p>
          <Button type="button" variant="outline" onClick={retryWorkspaceLoad}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  if (isOnboardingRoute) {
    if (hasWorkspaces && !onboardingStartedWithoutWorkspaceRef.current) {
      return <Navigate to="/kanban" replace />;
    }
    return (
      <OnboardingPage
        onComplete={completeOnboarding}
        headerActions={<DiagnosticsPanel triggerVariant="icon" />}
      />
    );
  }

  if (!hasWorkspaces) {
    return <Navigate to="/onboarding" replace />;
  }

  return <WorkspaceAppShell />;
});
