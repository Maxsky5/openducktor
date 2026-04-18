import { AlertTriangle, RefreshCcw } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { ActiveWorkspace } from "@/types/state-slices";

type AgentsPageShellProps = {
  activeWorkspace: ActiveWorkspace | null;
  navigationPersistenceError: Error | null;
  chatSettingsLoadError: Error | null;
  activeTabValue: string;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onTabValueChange: (value: string) => void;
  taskTabs: ReactNode;
  workspace: ReactNode;
  modalContent?: ReactNode;
};

export function AgentsPageShell({
  activeWorkspace,
  navigationPersistenceError,
  chatSettingsLoadError,
  activeTabValue,
  onRetryNavigationPersistence,
  onRetryChatSettingsLoad,
  onTabValueChange,
  taskTabs,
  workspace,
  modalContent = null,
}: AgentsPageShellProps): ReactElement {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  if (navigationPersistenceError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-card p-4">
        <div className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-destructive-border bg-destructive-surface px-4 py-4 text-sm text-destructive-muted">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0 space-y-2">
              <p className="font-medium text-destructive">
                Agent Studio couldn&apos;t restore saved navigation context.
              </p>
              {workspaceRepoPath ? <p>{`Repository: ${workspaceRepoPath}`}</p> : null}
              <p className="break-words font-mono text-xs">{navigationPersistenceError.message}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
              onClick={onRetryNavigationPersistence}
            >
              <RefreshCcw className="size-3.5" />
              Retry restore
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Tabs
      value={activeTabValue}
      onValueChange={onTabValueChange}
      className="h-full min-h-0 max-h-full gap-0 overflow-hidden bg-card"
    >
      {taskTabs}
      {chatSettingsLoadError ? (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-destructive">
                Agent Studio couldn&apos;t load chat settings.
              </p>
              {workspaceRepoPath ? <p>{`Repository: ${workspaceRepoPath}`}</p> : null}
              <p className="break-words font-mono text-xs">{chatSettingsLoadError.message}</p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
            onClick={onRetryChatSettingsLoad}
          >
            <RefreshCcw className="size-3.5" />
            Retry load
          </Button>
        </div>
      ) : null}
      <TabsContent value={activeTabValue} className="m-0 min-h-0 flex-1 bg-card p-0">
        {workspace}
      </TabsContent>
      {modalContent}
    </Tabs>
  );
}
