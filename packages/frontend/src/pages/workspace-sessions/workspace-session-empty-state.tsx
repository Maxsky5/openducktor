import { MessageCirclePlus } from "lucide-react";
import { type ReactElement } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  hasSessions: boolean;
  onCreate: () => void;
};

export function WorkspaceSessionEmptyState({ hasSessions, onCreate }: Props): ReactElement {
  return (
    <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-card p-6 text-center">
      <MessageCirclePlus className="size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-lg font-semibold">Workspace chat</h1>
      <p className="text-muted-foreground">
        {hasSessions ? "Select a session above." : "No active sessions."}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Work with an agent outside a task. Choose a repository or worktree and start a conversation.
      </p>
      <Button onClick={onCreate}>
        <MessageCirclePlus />
        New chat
      </Button>
    </section>
  );
}
