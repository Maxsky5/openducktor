import type { AgentMessageQueueAction, AgentMessageTarget } from "@openducktor/contracts";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CssPresenceList, useCssPresence } from "@/components/ui/css-presence";
import { TooltipProvider } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";
import type { AgentChatComposerModel, AgentChatMessageQueueModel } from "./agent-chat.types";
import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";
import { clearQueuedMessageEditDraft } from "./agent-chat-queued-message-drafts";
import {
  type EditingQueuedMessage,
  QueuedMessageEditor,
  type QueuedMessageEditorCatalog,
} from "./agent-chat-queued-message-editor";
import { QueuedMessageStack } from "./agent-chat-queued-message-stack";
import type { QueuedMessageSteerContext } from "./agent-chat-steering";

/** The composer state that the queue reads, and the catalogs that an entry editor reuses. */
export type AgentChatMessageQueueComposerModel = Pick<
  AgentChatComposerModel,
  "displayedSessionKey"
> &
  QueuedMessageSteerContext &
  QueuedMessageEditorCatalog;

type PendingAction = {
  submissionId: string;
  kind: AgentMessageQueueAction["kind"];
} | null;

/**
 * Messages that wait for the running turn to end. They stack on the top edge of the composer,
 * and a message that the user edits opens below the stack.
 */
export function AgentChatMessageQueue({
  model,
  composer,
}: {
  model: AgentChatMessageQueueModel;
  composer: AgentChatMessageQueueComposerModel;
}): ReactElement {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const { queue, onAction, onSaveEdit } = model;

  const run = (
    submissionId: string,
    kind: AgentMessageQueueAction["kind"],
    operation: () => Promise<void>,
    onSuccess?: () => void,
  ): void => {
    setPendingAction({ submissionId, kind });
    void operation()
      .then(onSuccess)
      .catch((error: Error) => {
        toast.error("Queued message action failed", { description: errorMessage(error) });
      })
      .finally(() => setPendingAction(null));
  };

  const entries = queue?.entries ?? [];
  const stacked = entries.filter((entry) => entry.state !== "editing");
  const edited = entries.filter((entry) => entry.state === "editing");

  return (
    // A tooltip closes as soon as the pointer leaves its button. Older cards sit above the newer
    // ones, so a tooltip that waits for the pointer to reach it would stay over the next card.
    <TooltipProvider disableHoverableContent>
      {/* Another chat shows its queue at once. Only later changes animate. */}
      <section
        key={composer.displayedSessionKey ?? "none"}
        aria-label={entries.length > 0 ? "Message queue" : undefined}
      >
        <QueuedMessageStack
          entries={stacked}
          isPaused={Boolean(queue?.pause)}
          steerContext={composer}
          pendingSubmissionId={pendingAction?.submissionId ?? null}
          onAction={(action) => run(action.submissionId, action.kind, () => onAction(action))}
        />
        <CssPresenceList>
          {queue
            ? edited.map((entry) => {
                const { submissionId, editId } = entry;
                // An ended edit no longer needs its unsaved draft.
                const endEdit = (): void => clearQueuedMessageEditDraft(queue.target, editId);
                return (
                  <QueuedMessageEditCard
                    key={submissionId}
                    target={queue.target}
                    entry={entry}
                    composer={composer}
                    pendingAction={pendingAction}
                    onSave={(draft) =>
                      run(
                        submissionId,
                        "save_edit",
                        () => onSaveEdit({ submissionId, editId }, draft),
                        endEdit,
                      )
                    }
                    onCancel={() =>
                      run(
                        submissionId,
                        "cancel_edit",
                        () => onAction({ kind: "cancel_edit", submissionId, editId }),
                        endEdit,
                      )
                    }
                    onRemove={() =>
                      run(
                        submissionId,
                        "remove",
                        () => onAction({ kind: "remove", submissionId }),
                        endEdit,
                      )
                    }
                  />
                );
              })
            : []}
        </CssPresenceList>
      </section>
    </TooltipProvider>
  );
}

/**
 * The edit of a queued message, lifted out of the stack until the user saves or cancels it. The
 * card grows in and shrinks out like an accordion. It clips its content only while it moves, so
 * the menus of the editor can show above the card once it is open.
 */
function QueuedMessageEditCard({
  target,
  entry,
  composer,
  pendingAction,
  onSave,
  onCancel,
  onRemove,
}: {
  target: AgentMessageTarget;
  entry: EditingQueuedMessage;
  composer: AgentChatMessageQueueComposerModel;
  pendingAction: PendingAction;
  onSave: (draft: AgentChatComposerDraft) => void;
  onCancel: () => void;
  onRemove: () => void;
}): ReactElement {
  const { presenceProps, isPresent, animateEntry } = useCssPresence();
  const [isOpen, setOpen] = useState(!animateEntry);
  // The card shows once the host has started the edit, so the Edit action no longer blocks it.
  const isPending =
    pendingAction?.submissionId === entry.submissionId && pendingAction.kind !== "begin_edit";
  return (
    <div
      {...presenceProps}
      className="css-presence queued-message-edit"
      data-open={isPresent && isOpen}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setOpen(true);
      }}
    >
      <div className="pb-2" aria-busy={isPending}>
        {/* A new edit of the same message starts from its own draft. */}
        <QueuedMessageEditor
          key={entry.editId}
          target={target}
          entry={entry}
          composer={composer}
          isPending={isPending}
          isSaving={isPending && pendingAction?.kind === "save_edit"}
          onSave={onSave}
          onCancel={onCancel}
          onRemove={onRemove}
        />
        {entry.error ? (
          <p className="px-3 pt-1.5 text-xs text-destructive" role="alert">
            {entry.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The composer shows a paused queue at its top: why it waits, and the button that releases it.
 */
export function AgentChatMessageQueuePauseNotice({
  model,
}: {
  model: AgentChatMessageQueueModel;
}): ReactElement | null {
  const [isResuming, setResuming] = useState(false);
  const pause = model.queue?.pause;
  if (!pause) return null;
  const resume = (): void => {
    setResuming(true);
    void model
      .onAction({ kind: "resume" })
      .catch((error: Error) => {
        toast.error("Could not resume the queue", { description: errorMessage(error) });
      })
      .finally(() => setResuming(false));
  };
  return (
    <div
      className="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-muted py-1 pr-1 pl-2.5 text-xs text-muted-foreground"
      role="status"
    >
      <Pause className="size-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium text-foreground">Queue paused.</span>{" "}
        <span>{pause.message}</span>
      </p>
      <Button type="button" size="xs" variant="outline" disabled={isResuming} onClick={resume}>
        {isResuming ? (
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="size-3" aria-hidden="true" />
        )}
        Resume queue
      </Button>
    </div>
  );
}
