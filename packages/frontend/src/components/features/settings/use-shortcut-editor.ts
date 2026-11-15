import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  AppPlatform,
  ShortcutActionId,
  ShortcutCombination,
  ShortcutPreferences,
} from "@openducktor/contracts";
import {
  compileShortcuts,
  otherDeviceProblems,
  problemOfCommand,
  type ShortcutCommandDefinition,
  type ShortcutProblem,
  type ShortcutShell,
} from "@/features/shortcuts/catalogue";
import { useShortcutRecorder } from "@/features/shortcuts/recording";
import { useShortcutPreferences } from "@/features/shortcuts/use-shortcut-preferences";
import { withAssignment } from "./settings-shortcut-model";

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
}: {
  catalogue: readonly ShortcutCommandDefinition[];
  platform: AppPlatform;
  shell: ShortcutShell;
}) {
  const { query, save } = useShortcutPreferences();
  const [pending, setPending] = useState<Proposal | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const recorder = useShortcutRecorder({
    platform,
    onRecorded: (id, combination) => {
      setPending({ id, combination });
      setSaveError(null);
    },
    onError: setSaveError,
  });
  const busy = save.isPending || recorder.preparing || recorder.recording !== null;

  useLayoutEffect(() => {
    if (!restoreFocus.current || busy || pending) return;
    restoreFocus.current = false;
    opener.current?.focus();
  });

  const cancel = () => {
    setPending(null);
    setSaveError(null);
    opener.current?.focus();
  };
  // Escape ends the proposal before the Settings dialog sees it, so the dialog stays open.
  const cancelOnEscape = useRef(cancel);
  useLayoutEffect(() => {
    cancelOnEscape.current = cancel;
  });
  const proposing = pending !== null && !save.isPending;
  useEffect(() => {
    if (!proposing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelOnEscape.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [proposing]);

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

  const persist = async (preferences: ShortcutPreferences): Promise<boolean> => {
    try {
      await save.mutateAsync(preferences);
      restoreFocus.current = true;
      setPending(null);
      setSaveError(null);
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };
  /** Saves at once when the change works on this device; otherwise shows it as a proposal. */
  const assign = (id: ShortcutActionId, combination: ShortcutCombination | null) => {
    const next = candidate(id, combination);
    if (!next) return;
    if (next.problem && combination) setPending({ id, combination });
    else void persist(next.preferences);
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
      void recorder.begin(id, element);
    },
    cancel() {
      if (recorder.recording || recorder.preparing) void recorder.cancel();
      else cancel();
    },
    assign(id: ShortcutActionId, combination: ShortcutCombination | null, element?: HTMLElement) {
      if (element) opener.current = element;
      assign(id, combination);
    },
    saveProposal() {
      if (proposal && !proposal.problem && next) void persist(next.preferences);
    },
    /** Removes the other command's keys and saves the proposal, after the user chose it. */
    reassign() {
      const conflict = proposal?.problem?.conflict;
      if (!proposal || !query.data || !conflict) return;
      const cleared = withAssignment(query.data, conflict.id, null, defaultKeysOf(conflict.id));
      const result = candidate(proposal.id, proposal.combination, cleared);
      if (result && !result.problem) void persist(result.preferences);
      else if (result?.problem) setSaveError(result.problem.message);
    },
    resetAll: () => persist({ version: 1, overrides: {} }),
    rememberOpener(element: HTMLElement) {
      opener.current = element;
    },
    focusOpener() {
      opener.current?.focus();
    },
  };
}
