import { useQuery } from "@tanstack/react-query";
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
import { errorMessage } from "@/lib/errors";
import { isPlatformChord } from "@/lib/keyboard-shortcuts";
import { platformQueryOptions } from "@/state/queries/system";
import { CommandPaletteContext, type CommandPaletteContextValue } from "./command-palette-context";
import { CommandPaletteDialog } from "./command-palette-dialog";
import type { CommandPalettePageCommand, CommandPaletteShell } from "./command-palette-types";
import { useRecentItemsStore } from "./recent-items";
import { useWorkspaceIntentRunner } from "./use-workspace-intent-runner";

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
  const [pageCommands, setPageCommands] = useState<CommandPalettePageCommand[]>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  /** True when this open ended with an action, which then owns focus. */
  const closedWithActionRef = useRef(false);
  const { runIntent, cancelIntent } = useWorkspaceIntentRunner();
  const platformQuery = useQuery(platformQueryOptions());
  const platform = platformQuery.data ?? null;
  const platformError = platformQuery.error;
  const recentLoadError = useRecentItemsStore((state) => state.loadError);

  useEffect(() => {
    if (!platformError) return;
    toast.error("The command palette shortcut is off.", {
      description: `OpenDucktor could not read the platform. Use the search button in the sidebar. ${errorMessage(platformError)}`,
    });
  }, [platformError]);
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
    </CommandPaletteContext>
  );
}

const focusIfConnected = (element: HTMLElement | null): void => {
  if (element?.isConnected) element.focus({ preventScroll: true });
};
