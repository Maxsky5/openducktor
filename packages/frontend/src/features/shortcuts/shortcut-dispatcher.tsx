import { memo, useMemo } from "react";
import type { AppPlatform } from "@openducktor/contracts";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";
import type { CommandPaletteCommandRegistration } from "../command-palette/command-palette-types";
import {
  type ActionArgs,
  useCommandPaletteActions,
} from "../command-palette/use-command-palette-actions";
import { useShortcutDispatch } from "./use-shortcut-dispatch";

const noPageCommands: ActionArgs["pageCommands"] = [];

/**
 * Registers the app commands of the active workspace, such as New task and the Settings sections,
 * so shortcuts reach them through the same registry as page commands. The open palette builds the
 * same commands for its own chosen workspace.
 */
export const AppShortcutCommands = memo(function AppShortcutCommands(
  props: Pick<ActionArgs, "shell" | "runIntent" | "openScopeChoice" | "previousFocus">,
) {
  const { actions } = useCommandPaletteActions({
    ...props,
    scopeWorkspace: null,
    query: "",
    pageCommands: noPageCommands,
    cachedReadiness: true,
  });
  const registrations = useMemo(
    () =>
      actions.flatMap((action): CommandPaletteCommandRegistration[] =>
        action.shortcutId
          ? [
              {
                id: action.shortcutId,
                label: action.label,
                run: action.run,
                disabledReason: () => action.disabledReason,
                localOnly: true,
                appWide: true,
              },
            ]
          : [],
      ),
    [actions],
  );
  useCommandPalettePageCommands(registrations);
  return null;
});

/** Input state and command changes do not rerender the palette or its overlay siblings. */
export const ShortcutDispatcher = memo(function ShortcutDispatcher(props: {
  platform: AppPlatform;
  isOpen: boolean;
  open(): void;
  close(): void;
  runAfterClose(run: () => void): void;
}) {
  const { openSettings } = useSettingsModal();
  const { inputError, retry } = useShortcutDispatch(props);
  if (!inputError) return null;
  return (
    <div
      role="alert"
      className="fixed right-3 bottom-3 z-50 flex max-w-md flex-col gap-2 rounded-lg border border-destructive-border bg-card p-3 text-sm shadow-lg"
    >
      <p>Keyboard shortcuts are off. {inputError}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="text-xs underline" onClick={retry}>
          Retry
        </button>
        <button
          type="button"
          className="text-xs underline"
          onClick={() =>
            openSettings({ deepLink: { kind: "global", section: "keyboard-shortcuts" } })
          }
        >
          Keyboard shortcuts
        </button>
      </div>
    </div>
  );
});
