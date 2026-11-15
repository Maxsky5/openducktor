import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { spokenShortcut } from "@openducktor/frontend-core/shortcuts/key-labels";
import type {
  AppPlatform,
  ShortcutActionId,
  ShortcutCombination,
  ShortcutPreferences,
  ShortcutWhen,
} from "@openducktor/contracts";
import {
  compileShortcuts,
  otherDeviceProblems,
  problemOfCommand,
  type ShortcutCommandDefinition,
  type ShortcutProblem,
  type ShortcutShell,
} from "@/features/shortcuts/catalogue";
import { typesText, useShortcutRecorder } from "@/features/shortcuts/recording";
import { useShortcutPreferences } from "@/features/shortcuts/use-shortcut-preferences";
import { withAssignment, withWhenChoice } from "./settings-shortcut-model";

type Proposal = { id: ShortcutActionId; combination: ShortcutCombination };
export type ShortcutProposal = Proposal & {
  problem: ShortcutProblem | null;
  /** Other devices of this host where the proposal would not run. */
  otherDevices: readonly string[];
};

/**
 * The editing state of Keyboard shortcuts: recording, the proposed keys and their problem on this
 * device, saving, and focus return. A change that runs on this device saves at once, except a
 * recorded proposal, which waits for Save.
 */
export function useShortcutEditor({
  catalogue,
  platform,
  shell,
  heading,
}: {
  catalogue: readonly ShortcutCommandDefinition[];
  platform: AppPlatform;
  shell: ShortcutShell;
  /** Takes focus when the control that started an edit is gone, such as a removed row. */
  heading: RefObject<HTMLElement | null>;
}) {
  const { query, save } = useShortcutPreferences();
  const [pending, setPending] = useState<Proposal | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useSavedFlash();
  const [announcement, setAnnouncement] = useState("");
  /** The last removal, kept until the next change so the user can undo it. */
  const [removed, setRemoved] = useState<{
    id: ShortcutActionId;
    before: ShortcutPreferences;
  } | null>(null);
  const labelOf = (id: ShortcutActionId) => catalogue.find((entry) => entry.id === id)?.label ?? id;
  const recorder = useShortcutRecorder({
    platform,
    onRecorded: (id, combination) => {
      setPending({ id, combination });
      setSaveError(null);
    },
    onError: setSaveError,
  });
  const busy = save.isPending || recorder.preparing || recorder.recording !== null;
  const { opener, restoreFocus, focusId, focusOpener } = useEditFocus(heading, !busy && !pending);
  const cancel = () => {
    setPending(null);
    setSaveError(null);
    setAnnouncement("Change canceled.");
    focusOpener();
  };
  useEscapeToCancel(pending !== null && !save.isPending, cancel);

  const defaultKeysOf = (id: ShortcutActionId) =>
    catalogue.find((entry) => entry.id === id)?.defaultKeys[shell] ?? null;
  /** The proposed set, and the problem it gives the edited command on this device. */
  const candidate = (
    id: ShortcutActionId,
    combination: ShortcutCombination | null,
    base: ShortcutPreferences | undefined = query.data,
  ) => {
    if (!base) return null;
    const preferences = withAssignment(base, id, combination, defaultKeysOf(id));
    const compiled = compileShortcuts(preferences, catalogue, platform, shell);
    return { preferences, problem: problemOfCommand(compiled, catalogue, id) };
  };

  const persist = async (preferences: ShortcutPreferences, message: string): Promise<boolean> => {
    try {
      await save.mutateAsync(preferences);
      restoreFocus.current = true;
      setPending(null);
      setSaveError(null);
      setAnnouncement(message);
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };
  const describe = (id: ShortcutActionId, combination: ShortcutCombination | null) =>
    combination
      ? `Saved. ${labelOf(id)}: ${spokenShortcut(combination, platform)}.`
      : `Removed the shortcut for ${labelOf(id)}.`;
  /** Saves at once when the change works on this device; otherwise shows it as a proposal. */
  const assign = async (id: ShortcutActionId, combination: ShortcutCombination | null) => {
    const before = query.data;
    const next = candidate(id, combination);
    if (!next || !before) return;
    if (next.problem && combination) {
      setPending({ id, combination });
      return;
    }
    setRemoved(null);
    if (!(await persist(next.preferences, describe(id, combination)))) return;
    if (combination) {
      setSavedId(id);
      return;
    }
    // The row stays in place with its own Undo, which takes focus, so nothing moves.
    restoreFocus.current = false;
    setRemoved({ id, before });
  };

  /** Saves a `when` choice, unless it makes the command unable to run on this device. */
  const chooseWhen = async (id: ShortcutActionId, when: ShortcutWhen) => {
    const entry = catalogue.find((command) => command.id === id);
    const before = query.data;
    if (!entry || !before) return;
    const preferences = withWhenChoice(before, entry, when);
    // Only the command's own problem counts; a conflict elsewhere does not depend on this choice.
    const problemIn = (candidate: ShortcutPreferences) =>
      compileShortcuts(candidate, catalogue, platform, shell).problems.get(id);
    const problem = problemIn(preferences);
    if (problem && !problemIn(before)) {
      setSaveError(`${entry.label} cannot run while typing with these keys. ${problem.message}`);
      return;
    }
    setRemoved(null);
    const scope = when === "always" ? "also while typing" : "only while not typing";
    if (await persist(preferences, `Saved. ${entry.label} runs ${scope}.`)) setSavedId(id);
  };

  // Computed only while a proposal is open, which is rare and short.
  const next = pending && candidate(pending.id, pending.combination);
  const proposal: ShortcutProposal | null =
    pending && next
      ? {
          ...pending,
          problem: next.problem,
          otherDevices: next.problem
            ? []
            : otherDeviceProblems(next.preferences, catalogue, pending.id, { platform, shell }),
        }
      : null;

  return {
    recording: recorder.recording,
    preparing: recorder.preparing,
    busy,
    proposal,
    saveError,
    saving: save.isPending,
    record(id: ShortcutActionId, element: HTMLElement) {
      opener.current = element;
      setPending(null);
      setSaveError(null);
      setRemoved(null);
      setAnnouncement("");
      void recorder.begin(id, element);
    },
    cancel() {
      if (recorder.recording || recorder.preparing) void recorder.cancel();
      else cancel();
    },
    removedId: removed?.id ?? null,
    /** Ends the chance to undo, such as when the search or filter changes. */
    forgetRemoval: () => setRemoved(null),
    undoRemoval() {
      if (!removed) return;
      const { id, before } = removed;
      setRemoved(null);
      focusId.current = id;
      void persist(before, `Restored the shortcut for ${labelOf(id)}.`).then(
        (saved) => saved && setSavedId(id),
      );
    },
    assign(id: ShortcutActionId, combination: ShortcutCombination | null, element?: HTMLElement) {
      if (element) opener.current = element;
      void assign(id, combination);
    },
    chooseWhen(id: ShortcutActionId, when: ShortcutWhen, element: HTMLElement) {
      opener.current = element;
      void chooseWhen(id, when);
    },
    saveProposal() {
      if (!proposal || proposal.problem || !next) return;
      const { id, combination } = proposal;
      void persist(next.preferences, describe(id, combination)).then(
        (saved) => saved && setSavedId(id),
      );
    },
    /** Removes the other command's keys and saves the proposal, after the user chose it. */
    reassign() {
      const conflict = proposal?.problem?.conflict;
      if (!proposal || !query.data || !conflict) return;
      const cleared = withAssignment(query.data, conflict.id, null, defaultKeysOf(conflict.id));
      const result = candidate(proposal.id, proposal.combination, cleared);
      if (result?.problem) {
        setSaveError(result.problem.message);
        return;
      }
      if (!result) return;
      const { id, combination } = proposal;
      void persist(
        result.preferences,
        `${describe(id, combination)} ${conflict.label} has no shortcut now.`,
      ).then((saved) => saved && setSavedId(id));
    },
    resetAll: () => {
      setRemoved(null);
      return persist({ version: 1, overrides: {} }, "All shortcuts reset to their defaults.");
    },
    savedId,
    /** The live status text for screen readers. */
    announcement: liveStatus({
      recording: recorder.recording && !recorder.preparing ? labelOf(recorder.recording) : null,
      ignored: recorder.recording ? recorder.ignored : null,
      pending:
        pending && `${labelOf(pending.id)}: ${spokenShortcut(pending.combination, platform)}.`,
      platform,
      last: announcement,
    }),
    held: recorder.held,
    ignored: recorder.ignored,
    rememberOpener(element: HTMLElement) {
      opener.current = element;
    },
    focusOpener,
  };
}

/** The text of the screen reader status: the live edit first, then the last change. */
const liveStatus = ({
  recording,
  ignored,
  pending,
  platform,
  last,
}: {
  recording: string | null;
  ignored: string | null;
  pending: string | null;
  platform: AppPlatform;
  last: string;
}): string => {
  const modifiers = platform === "darwin" ? "Command, Control or Option" : "Ctrl or Alt";
  if (ignored)
    return `${ignored} ${typesText(ignored) ? "alone types text" : "needs a modifier"}. Hold ${modifiers} and press a key.`;
  if (recording) return `Recording keys for ${recording}. Press Escape to cancel.`;
  return pending ?? last;
};

/** The row that shows "Saved" for a moment after its change saved. */
function useSavedFlash() {
  const [savedId, setSavedId] = useState<ShortcutActionId | null>(null);
  useEffect(() => {
    if (!savedId) return;
    const timer = setTimeout(() => setSavedId(null), 2000);
    return () => clearTimeout(timer);
  }, [savedId]);
  return [savedId, setSavedId] as const;
}

/**
 * Focus after an edit: a row named by `focusId` once it renders, else the control that started
 * the edit, else the heading when that control is gone.
 */
function useEditFocus(heading: RefObject<HTMLElement | null>, settled: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  /** A row whose keys take focus once it renders, such as after Undo. */
  const focusId = useRef<ShortcutActionId | null>(null);
  const focusOpener = () => {
    const target = opener.current;
    if (target?.isConnected && !target.matches(":disabled")) target.focus();
    else heading.current?.focus();
  };
  useLayoutEffect(() => {
    const row =
      focusId.current &&
      document.querySelector<HTMLElement>(`[data-shortcut-id="${CSS.escape(focusId.current)}"]`);
    if (row && settled) {
      focusId.current = null;
      restoreFocus.current = false;
      row.focus();
      return;
    }
    if (restoreFocus.current && settled) {
      restoreFocus.current = false;
      focusOpener();
      return;
    }
    // A removed row can leave the list a render after its save; keep focus inside Settings.
    if (opener.current && !opener.current.isConnected && document.activeElement === document.body)
      heading.current?.focus();
  });
  return { opener, restoreFocus, focusId, focusOpener };
}

/** Escape ends a proposal before the Settings dialog sees it, so the dialog stays open. */
function useEscapeToCancel(active: boolean, cancel: () => void) {
  const latest = useRef(cancel);
  useLayoutEffect(() => {
    latest.current = cancel;
  });
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active]);
}
