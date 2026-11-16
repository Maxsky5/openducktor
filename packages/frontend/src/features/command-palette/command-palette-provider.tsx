import type { ShortcutActionId } from "@openducktor/contracts";
import {
  CommandPaletteRegistryContext,
  useCommandPaletteCommands,
} from "./command-palette-registry";
import { paletteCommandsFor, runRegisteredCommand } from "../shortcuts/command-resolution";

import "../shortcuts/position-hints.css";
import {
  use,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { AppShortcutCommands, ShortcutDispatcher } from "../shortcuts/shortcut-dispatcher";
import type { WorkspaceScopeAction, WorkspaceScopeTarget } from "@/types/workspace-scope";
import { CommandPaletteContext, type CommandPaletteContextValue } from "./command-palette-context";
import { CommandPaletteDialog } from "./command-palette-dialog";
import type { CommandPaletteShell } from "./command-palette-types";
import { MergeCheckDialog } from "./merge-check-dialog";
import { PullRequestSyncDialog } from "./pull-request-sync-dialog";
import { useRecentItems } from "./recent-items";
import { useWorkspaceIntentRunner } from "./use-workspace-intent-runner";
import { readDevicePlatform } from "@/lib/device-platform";

/**
 * Owns the palette open state, its global shortcut, and the commands that pages add.
 *
 * Mod+K opens the palette from any focus, also the terminal, unless another dialog is open.
 * The same keys close it. An action closes the palette first and runs after the close commits,
 * so its own dialog or page gets focus.
 */
export function CommandPaletteProvider({
  shell,
  children,
}: PropsWithChildren<{ shell: CommandPaletteShell }>): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const [scopeChoice, setScopeChoice] = useState<{
    action: WorkspaceScopeAction;
    open: boolean;
    workspace: WorkspaceScopeTarget | null;
  }>({ action: "pull_request_sync", open: false, workspace: null });
  const openScopeChoice = useCallback(
    (action: WorkspaceScopeAction, workspace: WorkspaceScopeTarget | null) => {
      setScopeChoice({ action, open: true, workspace: workspace ? { ...workspace } : null });
    },
    [],
  );
  const closeScopeChoice = useCallback(
    () => setScopeChoice((current) => ({ ...current, open: false })),
    [],
  );
  const onScopeChoiceCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    focusIfConnected(previousFocusRef.current);
  }, []);
  const registry = use(CommandPaletteRegistryContext);
  if (!registry) throw new Error("CommandPaletteProvider requires CommandPaletteRegistryProvider.");
  const { registerPageCommand } = registry;
  // The listed commands keep their identity while the highlighted record's commands change, so
  // moving the highlight does not render the palette a second time.
  const pageCommands = useCommandPaletteCommands(isOpen, "listed");
  const previousFocusRef = useRef<HTMLElement | null>(null);
  /** True when this open ended with an action, which then owns focus. */
  const closedWithActionRef = useRef(false);
  const { runIntent, cancelIntent } = useWorkspaceIntentRunner();
  // Key caps and the shortcut follow this device, also while the client views another host.
  const [platform] = useState(() => readDevicePlatform());
  const recentLoadError = useRecentItems((state) => state.loadError);
  useEffect(() => {
    if (recentLoadError === null) return;
    toast.error("Could not restore recent tasks and sessions.", {
      description: `The Recent list starts empty. ${recentLoadError}`,
    });
  }, [recentLoadError]);

  const open = useCallback((): void => {
    // A new open is a new choice, so a task action that still waits for its tasks must not run.
    cancelIntent();
    const focused = document.activeElement;
    previousFocusRef.current = focused instanceof HTMLElement ? focused : null;
    closedWithActionRef.current = false;
    setOpen(true);
  }, [cancelIntent]);
  const close = useCallback((): void => setOpen(false), []);
  /** Each caller is a key or click handler, so the close can commit at once. */
  const runAfterClose = useCallback((run: () => void): void => {
    closedWithActionRef.current = true;
    // The palette unmounts first, so the action's own dialog is not blocked by an open dialog.
    flushSync(() => setOpen(false));
    // Give focus back before the action, so its dialog returns focus to the same element.
    focusIfConnected(previousFocusRef.current);
    run();
  }, []);

  const runPageCommand = useCallback(
    (id: ShortcutActionId) =>
      runRegisteredCommand(registry.pageCommands, id, document.activeElement),
    [registry],
  );

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ open, registerPageCommand, platform, runPageCommand }),
    [open, platform, registerPageCommand, runPageCommand],
  );
  const previousFocus = useCallback(() => previousFocusRef.current, []);
  const paletteCommands = useMemo(
    () => (isOpen ? paletteCommandsFor(pageCommands, previousFocusRef.current) : []),
    [isOpen, pageCommands],
  );

  return (
    <CommandPaletteContext value={value}>
      <AppShortcutCommands
        shell={shell}
        runIntent={runIntent}
        openScopeChoice={openScopeChoice}
        previousFocus={previousFocus}
      />
      <ShortcutDispatcher
        platform={platform}
        isOpen={isOpen}
        open={open}
        close={close}
        runAfterClose={runAfterClose}
      />
      {children}
      <CommandPaletteDialog
        open={isOpen}
        openScopeChoice={openScopeChoice}
        platform={platform}
        shell={shell}
        pageCommands={paletteCommands}
        close={close}
        runAfterClose={runAfterClose}
        runIntent={runIntent}
        previousFocus={previousFocus}
        onCloseAutoFocus={(event) => {
          // Radix returns focus only to a dialog trigger, and the palette has none.
          event.preventDefault();
          // An action already moved focus to its own dialog or page.
          if (!closedWithActionRef.current) focusIfConnected(previousFocusRef.current);
        }}
      />
      <PullRequestSyncDialog
        open={scopeChoice.open && scopeChoice.action === "pull_request_sync"}
        workspace={scopeChoice.workspace}
        onClose={closeScopeChoice}
        onCloseAutoFocus={onScopeChoiceCloseAutoFocus}
      />
      <MergeCheckDialog
        open={scopeChoice.open && scopeChoice.action === "merge_check"}
        workspace={scopeChoice.workspace}
        onClose={closeScopeChoice}
        onCloseAutoFocus={onScopeChoiceCloseAutoFocus}
      />
    </CommandPaletteContext>
  );
}

const focusIfConnected = (element: HTMLElement | null): void => {
  if (element?.isConnected) element.focus({ preventScroll: true });
};
