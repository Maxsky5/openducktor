import { memo } from "react";
import type { AppPlatform } from "@openducktor/contracts";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import {
  useCommandPaletteActions,
  type ActionArgs,
} from "../command-palette/use-command-palette-actions";
import { useShortcutDispatch } from "./use-shortcut-dispatch";

const noPageCommands: ActionArgs["pageCommands"] = [];

/** Input state and command changes do not rerender the palette or its overlay siblings. */
export const ShortcutDispatcher = memo(function ShortcutDispatcher({
  platform,
  shell,
  isOpen,
  open,
  close,
  runAfterClose,
  runIntent,
  openScopeChoice,
  previousFocus,
}: Omit<ActionArgs, "scopeWorkspace" | "query" | "pageCommands" | "shortcutsOnly"> & {
  platform: AppPlatform;
  isOpen: boolean;
  open(): void;
  close(): void;
  runAfterClose(run: () => void): void;
}) {
  const { openSettings } = useSettingsModal();
  const { actions } = useCommandPaletteActions({
    scopeWorkspace: null,
    query: "",
    shortcutsOnly: true,
    shell,
    pageCommands: noPageCommands,
    runIntent,
    openScopeChoice,
    previousFocus,
  });
  const { inputError, retry } = useShortcutDispatch({
    platform,
    actions,
    isOpen,
    open,
    close,
    runAfterClose,
  });
  if (!inputError) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-3 right-3 z-50 rounded border border-border bg-card p-3 text-sm"
    >
      Keyboard shortcuts unavailable: {inputError}
      <button type="button" onClick={retry}>
        Retry
      </button>
      <button
        type="button"
        onClick={() =>
          openSettings({ deepLink: { kind: "global", section: "keyboard-shortcuts" } })
        }
      >
        Keyboard shortcuts
      </button>
    </div>
  );
});
