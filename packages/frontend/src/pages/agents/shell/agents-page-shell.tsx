import type { SessionNavigationRecovery } from "@/features/session-navigation/use-session-navigation-recovery";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { SessionNavigationError } from "@/features/session-navigation/session-navigation-error";
import { Button } from "@/components/ui/button";
import type { ActiveWorkspace } from "@/types/state-slices";

export function AgentsPageShell({
  activeWorkspace,
  navigationPersistenceError,
  navigationPersistenceOperation,
  isRetryingNavigationPersistence = false,
  chatSettingsLoadError,
  gitProviderContextLoadError,
  onRetryNavigationPersistence,
  onRetryChatSettingsLoad,
  onRetryGitProviderContext,
  workspace,
  modalContent = null,
}: AgentsPageShellProps): ReactElement {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  if (navigationPersistenceError) {
    return (
      <SessionNavigationError
        scopeLabel="Task sessions"
        repositoryPath={workspaceRepoPath}
        error={navigationPersistenceError}
        operation={navigationPersistenceOperation}
        onRetry={onRetryNavigationPersistence}
        isPending={isRetryingNavigationPersistence}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 max-h-full flex-col overflow-hidden bg-card">
      {chatSettingsLoadError ? (
        <LoadErrorBanner
          error={chatSettingsLoadError}
          onRetry={onRetryChatSettingsLoad}
          repositoryPath={workspaceRepoPath}
          retryLabel="Retry load"
          title="Task sessions couldn't load chat settings."
        />
      ) : null}
      {gitProviderContextLoadError ? (
        <LoadErrorBanner
          error={gitProviderContextLoadError}
          onRetry={onRetryGitProviderContext}
          repositoryPath={workspaceRepoPath}
          retryLabel="Retry provider load"
          title="Task sessions couldn't load Git provider features."
        />
      ) : null}
      <div className="min-h-0 flex-1 bg-card">{workspace}</div>
      {modalContent}
    </div>
  );
}

type AgentsPageShellProps = {
  activeWorkspace: ActiveWorkspace | null;
  navigationPersistenceError: Error | null;
  navigationPersistenceOperation: SessionNavigationRecovery["navigationPersistenceOperation"];
  isRetryingNavigationPersistence?: boolean;
  chatSettingsLoadError: Error | null;
  gitProviderContextLoadError: Error | null;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onRetryGitProviderContext: () => void;
  workspace: ReactNode;
  modalContent?: ReactNode;
};

function LoadErrorBanner({
  error,
  onRetry,
  repositoryPath,
  retryLabel,
  title,
}: LoadErrorBannerProps): ReactElement {
  return (
    <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-destructive">{title}</p>
          {repositoryPath ? <p>{`Repository: ${repositoryPath}`}</p> : null}
          <p className="break-words font-mono text-xs">{error.message}</p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
        onClick={onRetry}
      >
        <RefreshCcw className="size-3.5" />
        {retryLabel}
      </Button>
    </div>
  );
}

type LoadErrorBannerProps = {
  error: Error;
  onRetry: () => void;
  repositoryPath: string | null;
  retryLabel: string;
  title: string;
};
