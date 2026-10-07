import type { WorkspaceRecord } from "@openducktor/contracts";
import { MessageCirclePlus, MessagesSquare, Plus } from "lucide-react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router";
import { RepositoryBranchSwitcher } from "@/components/features/repository/repository-branch-switcher";
import { Button } from "@/components/ui/button";
import { buildNewWorkspaceSessionHref } from "@/features/session-navigation/session-navigation-target";
import { useRequiredTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";

/** The Sessions page before a conversation or task context is chosen. */
export function SessionsEmptyState({
  workspace,
}: {
  workspace: Pick<WorkspaceRecord, "workspaceId" | "workspaceName">;
}): ReactElement {
  const navigate = useNavigate();
  const { onCreateTask } = useRequiredTaskWorkflowActions();
  const openNewChat = (): void => {
    void navigate(buildNewWorkspaceSessionHref(workspace.workspaceId));
  };

  return (
    <section className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-card p-6 text-center">
      <MessagesSquare className="size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-foreground">Choose a session</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Select a task session or a workspace session in the sidebar, or start new work in{" "}
        {workspace.workspaceName}.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={onCreateTask}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          New task
        </Button>
        <Button type="button" variant="outline" onClick={openNewChat}>
          <MessageCirclePlus data-icon="inline-start" aria-hidden="true" />
          New chat
        </Button>
      </div>
      <div className="w-full max-w-xs pt-4 text-left">
        <RepositoryBranchSwitcher />
      </div>
    </section>
  );
}
