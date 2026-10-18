import type { AgentMessageTarget, AgentQueuedMessage } from "@openducktor/contracts";
import { Check, LoaderCircle, Paperclip, Pencil, Trash2 } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";
import { buildComposerAttachmentsFromFiles } from "./agent-chat-attachment-intake";
import { CHAT_ATTACHMENT_ACCEPT } from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import {
  AgentChatComposerEditor,
  type AgentChatComposerEditorCatalog,
} from "./agent-chat-composer-editor";
import {
  type AgentChatComposerDraft,
  appendAttachmentsToDraft,
  draftHasMeaningfulContent,
  removeAttachmentFromDraft,
  userMessagePartsToComposerDraft,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { focusEditorEnd } from "./agent-chat-composer-selection";
import {
  ACTIVE_COMPOSER_CARD_CLASS_NAME,
  COMPOSER_QUIET_CONTROL_CLASS_NAME,
} from "./agent-chat-composer-surface";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";

/** The composer catalogs and attachment rule that an edit of a queued message reuses. */
export type QueuedMessageEditorCatalog = AgentChatComposerEditorCatalog &
  Pick<AgentChatComposerModel, "supportsAttachments">;

export type EditingQueuedMessage = Extract<AgentQueuedMessage, { state: "editing" }>;

/**
 * Edits a queued message in a card that looks like the composer. The unsaved edit outlives the
 * editor.
 */
export function QueuedMessageEditor({
  target,
  entry,
  composer,
  isPending,
  isSaving,
  onSave,
  onCancel,
  onRemove,
}: {
  target: AgentMessageTarget;
  entry: EditingQueuedMessage;
  composer: QueuedMessageEditorCatalog;
  /** An action on this message runs, so the editor waits. */
  isPending: boolean;
  /** The running action is Save. */
  isSaving: boolean;
  onSave: (draft: AgentChatComposerDraft) => void;
  onCancel: () => void;
  onRemove: () => void;
}): ReactElement {
  const { editId } = entry;
  const editDrafts = useClientConnection().drafts.queuedMessageEdits;
  const [draft, setDraft] = useState(
    () => editDrafts.read(target, editId) ?? userMessagePartsToComposerDraft(entry.parts),
  );
  // The unsaved edit outlives this editor, so it comes back after navigation.
  const changeDraft = (next: AgentChatComposerDraft): void => {
    setDraft(next);
    editDrafts.write(target, editId, next);
  };
  const editorRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const attachments = draft.attachments ?? [];
  // Edit moves keyboard focus into the editor, so a keyboard user can change the text at once.
  useEffect(() => {
    if (editorRef.current) focusEditorEnd(editorRef.current);
  }, []);
  const handleAddFiles = (files: File[]): void => {
    if (!composer.supportsAttachments) return;
    const added = buildComposerAttachmentsFromFiles(files);
    if (added.length > 0) changeDraft(appendAttachmentsToDraft(draft, added));
  };
  const canSave = !isPending && draftHasMeaningfulContent(draft);
  const save = (): void => {
    if (canSave) onSave(draft);
  };

  return (
    // Escape cancels the edit, unless the editor used it to close one of its menus.
    <div
      className={ACTIVE_COMPOSER_CARD_CLASS_NAME}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !isPending) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      {composer.supportsAttachments ? (
        <input
          ref={attachmentInputRef}
          type="file"
          aria-label="Add attachments to queued message"
          multiple
          accept={CHAT_ATTACHMENT_ACCEPT}
          disabled={isPending}
          className="hidden"
          onChange={(event) => {
            handleAddFiles(Array.from(event.target.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      ) : null}
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((attachment) => (
            <AgentChatAttachmentChip
              key={attachment.id}
              variant="draft"
              attachment={attachment}
              error={null}
              onRemove={() => changeDraft(removeAttachmentFromDraft(draft, attachment.id))}
            />
          ))}
        </div>
      ) : null}
      <AgentChatComposerEditor
        draft={draft}
        onDraftChange={changeDraft}
        onAddFiles={handleAddFiles}
        placeholder="Edit the queued message"
        disabled={isPending}
        editorRef={editorRef}
        onEditorInput={() => {}}
        onSend={(mode) => {
          if (mode === "default") save();
        }}
        catalog={composer}
      />
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2 pt-1">
        <div className="flex min-w-0 flex-auto items-center gap-1">
          {composer.supportsAttachments ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("size-7 rounded-lg hover:bg-muted", COMPOSER_QUIET_CONTROL_CLASS_NAME)}
              aria-label="Add attachment to queued message"
              disabled={isPending}
              onClick={() => attachmentInputRef.current?.click()}
            >
              <Paperclip className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          <span className="inline-flex min-w-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground">
            <Pencil className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Editing queued message</span>
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn("size-8 rounded-lg hover:bg-muted", COMPOSER_QUIET_CONTROL_CLASS_NAME)}
            aria-label="Remove queued message"
            disabled={isPending}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg"
            disabled={isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg"
            disabled={!canSave}
            onClick={save}
          >
            {isSaving ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-3.5" aria-hidden="true" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
