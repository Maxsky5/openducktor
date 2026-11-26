import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { useSessionPromptInput } from "@openducktor/frontend-core/sessions/composer/prompt-input/use-session-prompt-input";
import { useCallback, useMemo, useState } from "react";
import { resolveAttachmentPickers } from "./composer-attachments";
import {
  type ComposerSuggestion,
  insertSuggestionEdit,
  readComposerTrigger,
} from "./composer-segments";
import { resolveHardwareEnter } from "./hardware-enter";
import { useAttachmentPickers } from "./use-attachment-pickers";
import type { useComposerDraftEditor } from "./use-composer-draft-editor";
import { useComposerSuggestions } from "./use-composer-suggestions";

type ComposerPromptInput = ReturnType<typeof useSessionPromptInput>;
type ComposerEditor = ReturnType<typeof useComposerDraftEditor>;
type AttachmentSupport = Parameters<typeof resolveAttachmentPickers>[0]["support"];

/**
 * Shared mobile composer interactions: input focus, `@`/`/`/`$` trigger detection and suggestions,
 * attachment pickers, and hardware keyboard Enter handling.
 */
export function useComposerInteractions({
  draft,
  editor,
  promptInput,
  runtimeSupportsAttachments,
  attachmentSupport,
  isInputDisabled,
  attachmentsEnabled,
  sendDisabled,
  onSend,
}: {
  draft: AgentChatComposerDraft;
  editor: ComposerEditor;
  promptInput: ComposerPromptInput;
  runtimeSupportsAttachments?: boolean;
  attachmentSupport: AttachmentSupport;
  isInputDisabled: boolean;
  attachmentsEnabled: boolean;
  sendDisabled: boolean;
  onSend: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const { noteFocus, applyStructuralEdit, addAttachments, caret } = editor;

  const onFocusChange = useCallback(
    (next: boolean) => {
      setFocused(next);
      noteFocus(next);
    },
    [noteFocus],
  );

  // The prompt input builds `support` on each render, so the trigger reads its flags.
  const { supportsFileSearch, supportsSubagentReferences, supportsSkillReferences } =
    promptInput.support;
  const supportsSlashCommands = promptInput.slashCommands.supportsSlashCommands;
  const triggerSupport = useMemo(
    () => ({
      // Reusable prompts of the host settings are slash commands too, as on desktop.
      supportsSlashCommands,
      supportsFileSearch,
      supportsSubagentReferences,
      supportsSkillReferences,
    }),
    [
      supportsFileSearch,
      supportsSkillReferences,
      supportsSlashCommands,
      supportsSubagentReferences,
    ],
  );
  const trigger = useMemo(
    () =>
      focused && caret && !isInputDisabled
        ? readComposerTrigger(draft, caret.segmentId, caret.offset, triggerSupport)
        : null,
    [caret, draft, focused, isInputDisabled, triggerSupport],
  );
  const suggestions = useComposerSuggestions(trigger, promptInput);
  const pickSuggestion = useCallback(
    (suggestion: ComposerSuggestion) => {
      if (trigger) applyStructuralEdit(insertSuggestionEdit(trigger, suggestion));
    },
    [applyStructuralEdit, trigger],
  );

  const effectiveSupportsAttachments =
    runtimeSupportsAttachments ?? promptInput.support.supportsAttachments;
  const pickers = useMemo(
    () =>
      resolveAttachmentPickers({
        runtimeSupportsAttachments: effectiveSupportsAttachments,
        support: attachmentSupport,
      }),
    [attachmentSupport, effectiveSupportsAttachments],
  );
  const attachmentPickers = useAttachmentPickers({
    pickers,
    enabled: attachmentsEnabled,
    onAdd: addAttachments,
  });

  const onHardwareEnter = useCallback(
    ({ nativeEvent }: { nativeEvent: { shift: boolean } }) => {
      const action = resolveHardwareEnter({
        shift: nativeEvent.shift,
        suggestionRows: trigger ? suggestions.items.length : null,
        sendAllowed: !sendDisabled,
      });
      const first = suggestions.items[0];
      if (action === "pick_suggestion" && first) pickSuggestion(first);
      if (action === "send") onSend();
    },
    [onSend, pickSuggestion, sendDisabled, suggestions.items, trigger],
  );

  return {
    focused,
    onFocusChange,
    trigger,
    suggestions,
    pickSuggestion,
    pickers,
    attachmentPickers,
    onHardwareEnter,
  };
}
