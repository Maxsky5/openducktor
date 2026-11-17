import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  recordingModifierNames,
  spokenShortcut,
} from "@openducktor/frontend-core/shortcuts/key-labels";
import type {
  AppPlatform,
  ShortcutActionId,
  ShortcutCombination,
  ShortcutPreferences,
  ShortcutWhen,
} from "@openducktor/contracts";
import type { ShortcutCommandDefinition, ShortcutShell } from "@/features/shortcuts/catalogue";
import {
  compileShortcuts,
  otherDeviceProblems,
  problemOfCommand,
  type ShortcutProblem,
} from "@/features/shortcuts/compile-shortcuts";
import { typesText, useShortcutRecorder } from "@/features/shortcuts/recording";
import { whenChoiceChange, withAssignment } from "./settings-shortcut-model";
import type { ShortcutDraft } from "./use-shortcut-draft";

/** Recorded keys that cannot go into the draft as they are, with the reason. */
export type ShortcutProposal = {
  id: ShortcutActionId;
  combination: ShortcutCombination;
  problem: ShortcutProblem;
};

const RESET: ShortcutPreferences = { version: 1, overrides: {} };
const NO_NOTE: readonly string[] = [];

/** What a row can ask the editor to do. */
export type ShortcutRowActions = {
  record(id: ShortcutActionId, element: HTMLElement): void;
  assign(id: ShortcutActionId, combination: ShortcutCombination | null, element: HTMLElement): void;
  chooseWhen(id: ShortcutActionId, when: ShortcutWhen, element: HTMLElement): void;
  cancel(): void;
  /** Gives the proposed keys to their command and removes them from the command that had them. */
  replace(): void;
};

/**
 * The editing state of Keyboard shortcuts: recording, keys that need a choice, and focus return.
 * Every change goes into the Settings draft, which "Save settings" writes.
 */
export function useShortcutEditor({
  catalogue,
  platform,
  shell,
  heading,
  draft,
}: {
  catalogue: readonly ShortcutCommandDefinition[];
  platform: AppPlatform;
  shell: ShortcutShell;
  /** Takes focus when the control that started an edit is gone. */
  heading: RefObject<HTMLElement | null>;
  draft: ShortcutDraft;
}) {
  const [proposal, setProposal] = useState<ShortcutProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** The command changed last: it stays listed under a filter, and shows its device note. */
  const [changedId, setChangedId] = useState<ShortcutActionId | null>(null);
  const labelOf = (id: ShortcutActionId) => catalogue.find((entry) => entry.id === id)?.label ?? id;
  const defaultKeysOf = (id: ShortcutActionId) =>
    catalogue.find((entry) => entry.id === id)?.defaultKeys[shell] ?? null;
  const device = { platform, shell };
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);

  /** The draft with one assignment changed, and the problem that gives the command here. */
  const candidate = (
    base: ShortcutPreferences,
    id: ShortcutActionId,
    combination: ShortcutCombination | null,
  ) => {
    const preferences = withAssignment(base, id, combination, defaultKeysOf(id));
    const compiled = compileShortcuts(preferences, catalogue, platform, shell);
    return { preferences, problem: problemOfCommand(compiled, catalogue, id) };
  };
  const apply = (id: ShortcutActionId, preferences: ShortcutPreferences, message: string) => {
    draft.update(preferences);
    setProposal(null);
    setError(null);
    setChangedId(id);
    setAnnouncement(`${message} Save settings to apply it.`);
    restoreFocus.current = true;
  };
  /** Puts keys into the draft, or shows why they need a choice. */
  const assign = (
    base: ShortcutPreferences,
    id: ShortcutActionId,
    combination: ShortcutCombination | null,
  ) => {
    const next = candidate(base, id, combination);
    if (next.problem && combination) {
      setProposal({ id, combination, problem: next.problem });
      return;
    }
    apply(
      id,
      next.preferences,
      combination
        ? `${labelOf(id)}: ${spokenShortcut(combination, platform)}.`
        : `Removed the shortcut for ${labelOf(id)}.`,
    );
  };
  // The recorder reports keys from its own listener, so it reads the latest draft through a ref.
  const latest = useRef({ draft, assign });
  useLayoutEffect(() => {
    latest.current = { draft, assign };
  });
  const recorder = useShortcutRecorder({
    platform,
    onRecorded: (id, combination) => {
      const base = latest.current.draft.preferences;
      if (base) latest.current.assign(base, id, combination);
    },
    onError: setError,
  });
  const focusOpener = () => {
    const target = opener.current;
    if (target?.isConnected) target.focus();
    else heading.current?.focus();
  };
  // Focus returns once the recorder has ended and no proposal is open.
  const settled = !recorder.preparing && recorder.recording === null && proposal === null;
  useLayoutEffect(() => {
    if (!restoreFocus.current || !settled) return;
    restoreFocus.current = false;
    focusOpener();
  });
  const closeProposal = () => {
    setProposal(null);
    setError(null);
    setAnnouncement("Change canceled.");
    focusOpener();
  };
  useEscapeToCancel(proposal !== null, closeProposal);
  const handlers: ShortcutRowActions = {
    record(id: ShortcutActionId, element: HTMLElement) {
      opener.current = element;
      setProposal(null);
      setError(null);
      setAnnouncement("");
      // Another row's recording ends first, so one row records at a time.
      const ended =
        recorder.recording || recorder.preparing ? recorder.cancel(false) : Promise.resolve();
      void ended.then(() => recorder.begin(id, element));
    },
    cancel() {
      if (recorder.recording || recorder.preparing) void recorder.cancel();
      else closeProposal();
    },
    assign(id: ShortcutActionId, combination: ShortcutCombination | null, element: HTMLElement) {
      opener.current = element;
      if (draft.preferences) assign(draft.preferences, id, combination);
    },
    replace() {
      const conflict = proposal?.problem.conflict;
      const base = draft.preferences;
      if (!proposal || !conflict || !base) return;
      const cleared = withAssignment(base, conflict.id, null, defaultKeysOf(conflict.id));
      const next = candidate(cleared, proposal.id, proposal.combination);
      if (next.problem) {
        setError(next.problem.message);
        return;
      }
      apply(
        proposal.id,
        next.preferences,
        `${labelOf(proposal.id)}: ${spokenShortcut(proposal.combination, platform)}. ${conflict.label} has no shortcut now.`,
      );
    },
    chooseWhen(id: ShortcutActionId, when: ShortcutWhen, element: HTMLElement) {
      opener.current = element;
      const entry = catalogue.find((command) => command.id === id);
      if (!entry || !draft.preferences) return;
      const change = whenChoiceChange(draft.preferences, catalogue, entry, when, device);
      if (change.problem) {
        setError(
          `${entry.label} cannot run while typing with these keys. ${change.problem.message}`,
        );
        return;
      }
      const scope = when === "always" ? "also while typing" : "only while not typing";
      apply(id, change.preferences, `${entry.label} runs ${scope}.`);
    },
  };
  // Rows receive one object whose methods call the latest handlers, so a render of the section
  // does not give every row new callbacks.
  const latestHandlers = useRef(handlers);
  useLayoutEffect(() => {
    latestHandlers.current = handlers;
  });
  const [actions] = useState<ShortcutRowActions>(() => ({
    record: (id, element) => latestHandlers.current.record(id, element),
    assign: (id, combination, element) => latestHandlers.current.assign(id, combination, element),
    chooseWhen: (id, when, element) => latestHandlers.current.chooseWhen(id, when, element),
    cancel: () => latestHandlers.current.cancel(),
    replace: () => latestHandlers.current.replace(),
  }));
  const changeNote = useMemo(
    () =>
      changedId && draft.preferences
        ? otherDeviceProblems(draft.preferences, catalogue, changedId, { platform, shell })
        : NO_NOTE,
    [changedId, draft.preferences, catalogue, platform, shell],
  );

  return {
    recording: recorder.recording,
    preparing: recorder.preparing,
    proposal,
    error,
    /** The command that stays listed when the filter or search changes. */
    keptId: recorder.recording ?? proposal?.id ?? changedId,
    /** Other devices where the last changed keys will not work, such as "on Windows". */
    changeNote: (id: ShortcutActionId) => (id === changedId ? changeNote : NO_NOTE),
    /** Row callbacks with a stable identity, so unchanged rows skip rendering. */
    actions,
    resetAll() {
      if (recorder.recording || recorder.preparing) void recorder.cancel(false);
      setProposal(null);
      setError(null);
      setChangedId(null);
      draft.update(RESET);
      setAnnouncement("All shortcuts use their defaults. Save settings to apply them.");
    },
    /** The live status text for screen readers. */
    announcement: liveStatus({
      recording: recorder.recording && !recorder.preparing ? labelOf(recorder.recording) : null,
      ignored: recorder.recording ? recorder.ignored : null,
      proposal: proposal && `${labelOf(proposal.id)}: ${proposal.problem.message}`,
      platform,
      last: announcement,
    }),
    held: recorder.held,
    ignored: recorder.ignored,
  };
}

/** The text of the screen reader status: the live edit first, then the last change. */
const liveStatus = ({
  recording,
  ignored,
  proposal,
  platform,
  last,
}: {
  recording: string | null;
  ignored: string | null;
  proposal: string | null;
  platform: AppPlatform;
  last: string;
}): string => {
  const modifiers = recordingModifierNames(platform).words;
  if (ignored)
    return `${ignored} ${typesText(ignored) ? "alone types text" : "needs a modifier"}. Hold ${modifiers} and press a key.`;
  if (recording) return `Recording keys for ${recording}. Press Escape to cancel.`;
  return proposal ?? last;
};

/** Escape closes a proposal before the Settings dialog sees it, so the dialog stays open. */
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
