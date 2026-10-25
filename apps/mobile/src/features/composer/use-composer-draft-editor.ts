import {
  type AgentChatComposerAttachment,
  type AgentChatComposerDraft,
  type AgentChatComposerDraftEdit,
  appendAttachmentsToDraft,
  applyComposerDraftEdit,
  removeAttachmentFromDraft,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyComposerTextChange,
  type ComposerCaret,
  caretInLayout,
  chipAtPosition,
  layoutComposerDraft,
  positionInLayout,
} from "./composer-text";

export type { ComposerCaret } from "./composer-text";

/**
 * A caret that the input must take, after an edit that changed its text. Each request is a new
 * object, so a request for the same position moves the caret again.
 */
export type ComposerSelectionRequest = { position: number };

/**
 * Edits a composer draft through one native input. The input shows the draft text with each chip
 * as styled text. A chip insert or removal only changes the text of the input, so the input keeps
 * the focus and the keyboard stays open.
 */
export function useComposerDraftEditor({
  draft,
  commitDraft,
}: {
  draft: AgentChatComposerDraft;
  commitDraft: (draft: AgentChatComposerDraft) => void;
}) {
  const draftRef = useRef(draft);
  // The last draft that this editor wrote. Any other draft came from outside the field.
  const committedRef = useRef(draft);
  const layout = useMemo(() => layoutComposerDraft(draft), [draft]);
  // The caret position in the input text, while the input has focus.
  const [selection, setSelection] = useState<number | null>(null);
  const [selectionRequest, setSelectionRequest] = useState<ComposerSelectionRequest | null>(null);
  const focusedRef = useRef(false);
  // The latest caret, so a deferred check reads the caret after both events of one edit.
  const selectionRef = useRef<number | null>(null);
  const snapFrameRef = useRef<number | null>(null);
  const place = useCallback((position: number) => {
    selectionRef.current = position;
    setSelection(position);
  }, []);
  const request = useCallback(
    (position: number) => {
      place(position);
      setSelectionRequest({ position });
    },
    [place],
  );
  useEffect(
    () => () => {
      if (snapFrameRef.current !== null) cancelAnimationFrame(snapFrameRef.current);
    },
    [],
  );
  useLayoutEffect(() => {
    draftRef.current = draft;
    if (draft === committedRef.current) return;
    // A send cleared the draft, a failed send restored it, or the draft loaded from storage. A
    // focused input keeps the focus with the caret at the end.
    committedRef.current = draft;
    if (focusedRef.current) request(layoutComposerDraft(draft).text.length);
    else {
      selectionRef.current = null;
      setSelection(null);
    }
  }, [draft, request]);

  /** Records the focus of the field, so a draft from outside keeps it. */
  const noteFocus = useCallback((focused: boolean): void => {
    focusedRef.current = focused;
  }, []);

  const commit = useCallback(
    (next: AgentChatComposerDraft): void => {
      draftRef.current = next;
      committedRef.current = next;
      commitDraft(next);
    },
    [commitDraft],
  );

  /** Applies a change of the input text. A change that touches a chip removes the whole chip. */
  const changeText = useCallback(
    (text: string): void => {
      const result = applyComposerTextChange(draftRef.current, text);
      commit(result.draft);
      if (result.text === text) place(result.caret);
      else request(result.caret);
    },
    [commit, place, request],
  );

  /**
   * Records a selection of the input. A caret that a tap puts inside a chip moves to the end of
   * the chip, as a desktop chip takes no caret. A text change and its selection change can come in
   * either order, so the check waits one frame for both.
   */
  const select = useCallback(
    (start: number, end: number): void => {
      place(end);
      if (start !== end) return;
      if (snapFrameRef.current !== null) cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = requestAnimationFrame(() => {
        snapFrameRef.current = null;
        if (selectionRef.current !== end) return;
        const chip = chipAtPosition(layoutComposerDraft(draftRef.current), end);
        if (chip) request(chip.end);
      });
    },
    [place, request],
  );

  /** Applies an edit that adds or removes a chip, then puts the caret where the edit names. */
  const applyStructuralEdit = useCallback(
    (edit: AgentChatComposerDraftEdit): boolean => {
      const result = applyComposerDraftEdit(draftRef.current, edit);
      if (!result) return false;
      commit(result.draft);
      const target = result.focusTarget;
      if (target) request(positionInLayout(layoutComposerDraft(result.draft), target));
      return true;
    },
    [commit, request],
  );

  const addAttachments = useCallback(
    (attachments: AgentChatComposerAttachment[]): void => {
      if (attachments.length > 0) commit(appendAttachmentsToDraft(draftRef.current, attachments));
    },
    [commit],
  );

  const removeAttachment = useCallback(
    (attachmentId: string): void => {
      commit(removeAttachmentFromDraft(draftRef.current, attachmentId));
    },
    [commit],
  );

  /** The caret in a text run of the draft, for the `/`, `@`, and `$` triggers. */
  const caret = useMemo<ComposerCaret | null>(
    () => (selection === null ? null : caretInLayout(layout, selection)),
    [layout, selection],
  );

  return {
    draftRef,
    layout,
    caret,
    select,
    selectionRequest,
    noteFocus,
    changeText,
    applyStructuralEdit,
    addAttachments,
    removeAttachment,
  };
}
