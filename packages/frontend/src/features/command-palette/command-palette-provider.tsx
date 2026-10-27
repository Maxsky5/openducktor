import type { AppPlatform } from "@openducktor/contracts";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { hasOpenDialog } from "@/components/ui/open-dialogs";
import { isPlatformChord } from "@/lib/keyboard-shortcuts";
import type { WorkspaceScopeAction, WorkspaceScopeTarget } from "@/types/workspace-scope";
import { CommandPaletteContext, type CommandPaletteContextValue } from "./command-palette-context";
import { CommandPaletteDialog } from "./command-palette-dialog";
import type { CommandPalettePageCommand, CommandPaletteShell } from "./command-palette-types";
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
  const [pageCommands, setPageCommands] = useState<CommandPalettePageCommand[]>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  /** True when this open ended with an action, which then owns focus. */
  const closedWithActionRef = useRef(false);
  const { runIntent, cancelIntent } = useWorkspaceIntentRunner();
  // Key caps and the shortcut follow this device, also while the client views another host.
  const [platform] = useState(() => readDevicePlatform());
  const recentLoadError = useRecentItems((state) => state.loadError);
  useEffect(() => {
    if (recentLoadError === null) return;
    toast.error("Could not restore recent tasks and chats.", {
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

  const onShortcut = useEffectEvent((event: KeyboardEvent, keyPlatform: AppPlatform): void => {
    if (!isPlatformChord(event, "k", keyPlatform)) return;
    if (!isOpen && hasOpenDialog()) return;
    // Capture phase: the terminal, the composer, and the browser never get the keys.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (isOpen) close();
    else open();
  });
  useEffect(() => {
    if (!platform) return;
    const onKeyDown = (event: KeyboardEvent): void => onShortcut(event, platform);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [platform]);

  const registerPageCommand = useCallback((command: CommandPalettePageCommand) => {
    setPageCommands((current) => [...current.filter((entry) => entry.id !== command.id), command]);
    return () => setPageCommands((current) => current.filter((entry) => entry !== command));
  }, []);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ open, registerPageCommand, platform }),
    [open, platform, registerPageCommand],
  );
  const previousFocus = useCallback(() => previousFocusRef.current, []);

  return (
    <CommandPaletteContext value={value}>
      {children}
      <CommandPaletteDialog
        open={isOpen}
        openScopeChoice={openScopeChoice}
        platform={platform}
        shell={shell}
        pageCommands={pageCommands}
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
