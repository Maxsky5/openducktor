import { MessageCirclePlus, Plus } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useNavigate } from "react-router";
import { TaskCreateModal } from "@/components/features/task-create/task-create-modal";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import { WorkspaceSessionCreateDialog } from "@/pages/workspace-sessions/workspace-session-create-dialog";
import { useActiveWorkspace, useTasksState } from "@/state/app-state-provider";

type WorkspaceCreateActionsProps = { compact?: boolean };

function WorkspaceTaskCreateModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { tasks } = useTasksState();
  return <TaskCreateModal open={open} onOpenChange={onOpenChange} tasks={tasks} />;
}

export default function WorkspaceCreateActions({
  compact = false,
}: WorkspaceCreateActionsProps): ReactElement {
  const [taskOpen, setTaskOpen] = useState(false);
  const taskMounted = useDialogPresence(taskOpen);
  const [chatOpen, setChatOpen] = useState(false);
  const chatMounted = useDialogPresence(chatOpen);
  const workspace = useActiveWorkspace();
  const navigate = useNavigate();
  const buttonSize = compact ? "icon" : "default";
  const buttonClassName = compact
    ? "size-9"
    : "w-full justify-start gap-2 rounded-lg px-3 text-sm font-medium text-sidebar-foreground";
  return (
    <>
      <div className="flex flex-col gap-1 border-t border-sidebar-border pt-3">
        <Button
          variant="ghost"
          size={buttonSize}
          className={buttonClassName}
          aria-label="New task"
          title="New task"
          disabled={!workspace}
          onClick={() => setTaskOpen(true)}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          {!compact && "New task"}
        </Button>
        <Button
          variant="ghost"
          size={buttonSize}
          className={buttonClassName}
          aria-label="New chat"
          title="New chat"
          disabled={!workspace}
          onClick={() => setChatOpen(true)}
        >
          <MessageCirclePlus />
          {!compact && "New chat"}
        </Button>
      </div>
      {taskMounted && workspace && (
        <WorkspaceTaskCreateModal
          key={workspace.workspaceId}
          open={taskOpen}
          onOpenChange={setTaskOpen}
        />
      )}
      {chatMounted && workspace && (
        <WorkspaceSessionCreateDialog
          key={`chat-${workspace.workspaceId}`}
          open={chatOpen}
          workspace={workspace}
          onClose={() => setChatOpen(false)}
          onCreated={(session) => {
            setChatOpen(false);
            navigate(`/chats?session=${encodeURIComponent(session.id)}`);
          }}
        />
      )}
    </>
  );
}
