import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { MOTION_EASE_OUT, prefersReducedMotion } from "@/components/ui/motion";

/** The rows of the transcript of a session that the hook saw at its last commit. */
type KnownRows = {
  sessionKey: string | null;
  count: number;
  keys: Set<string>;
};

const NO_ROWS: readonly string[] = [];

const ENTRY_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "none" },
];
const ENTRY_TIMING: KeyframeAnimationOptions = { duration: 200, easing: MOTION_EASE_OUT };

/**
 * The rows that a live update added at the end of the transcript. A row that a session load gives,
 * a row of history that the transcript loads above the others, and a row whose message changed its
 * id, such as a sent message that the runtime confirms, are not new.
 */
const readEnteringRowKeys = (
  known: KnownRows | null,
  sessionKey: string | null,
  rows: readonly AgentChatTranscriptRow[],
): readonly string[] => {
  if (!known || known.sessionKey !== sessionKey || known.count === 0) return NO_ROWS;
  const entering: string[] = [];
  for (let index = known.count; index < rows.length; index += 1) {
    const key = rows[index]?.key;
    if (key !== undefined && !known.keys.has(key)) entering.push(key);
  }
  return entering.length > 0 ? entering : NO_ROWS;
};

const rememberRows = (
  known: KnownRows | null,
  sessionKey: string | null,
  rows: readonly AgentChatTranscriptRow[],
): KnownRows => {
  // Rows that the transcript appends follow the known rows. Any other change reads all rows again.
  if (!known || known.sessionKey !== sessionKey || rows.length < known.count) {
    return { sessionKey, count: rows.length, keys: new Set(rows.map((row) => row.key)) };
  }
  for (let index = known.count; index < rows.length; index += 1) {
    const key = rows[index]?.key;
    if (key !== undefined) known.keys.add(key);
  }
  known.count = rows.length;
  return known;
};

/**
 * Brings the rows that a live update adds in with a short fade and rise, so the transcript does
 * not jump to its new content. A new tool run comes in with its header. The calls that a run gets
 * later are not rows of the transcript window, so the run brings them in itself. The row window
 * can mount a new row one commit later, so each commit looks for the new rows that it mounted.
 */
export function useAgentChatRowEntryMotion({
  sessionKey,
  rows,
  contentRef,
  mountedRows,
}: {
  sessionKey: string | null;
  rows: readonly AgentChatTranscriptRow[];
  contentRef: RefObject<HTMLDivElement | null>;
  /** The rows in the row window. A new value means that the window mounted other rows. */
  mountedRows: readonly AgentChatTranscriptRow[];
}): void {
  const knownRef = useRef<KnownRows | null>(null);
  // The known rows change only after a commit, so a render reads the rows of the last commit.
  const entering = useMemo(
    () => readEnteringRowKeys(knownRef.current, sessionKey, rows),
    [rows, sessionKey],
  );
  const shownRef = useRef<{ entering: readonly string[]; keys: Set<string> }>({
    entering: NO_ROWS,
    keys: new Set(),
  });

  useLayoutEffect(() => {
    knownRef.current = rememberRows(knownRef.current, sessionKey, rows);
  }, [rows, sessionKey]);

  useLayoutEffect(() => {
    void mountedRows;
    const content = contentRef.current;
    if (entering.length === 0 || !content) return;
    if (prefersReducedMotion()) return;
    if (shownRef.current.entering !== entering) shownRef.current = { entering, keys: new Set() };
    const shown = shownRef.current.keys;
    for (const key of entering) {
      if (shown.has(key)) continue;
      const row = content.querySelector(`[data-row-key="${CSS.escape(key)}"]`);
      if (!row) continue;
      shown.add(key);
      row.animate(ENTRY_KEYFRAMES, ENTRY_TIMING);
    }
  }, [contentRef, entering, mountedRows]);
}
