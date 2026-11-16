import {
  type AppPlatform,
  type EmbeddedShortcutEvent,
  holdsShortcutMod,
  inputSignature,
  type ShortcutRoute,
} from "@openducktor/contracts";
import {
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { hasOpenDialog, openDialogCount, subscribeOpenDialogs } from "@/components/ui/open-dialogs";
import { currentShortcutShell } from "./catalogue";
import {
  CommandPaletteRegistryContext,
  useCommandPaletteCommands,
} from "../command-palette/command-palette-registry-context";
import type { CommandPalettePageCommand } from "../command-palette/command-palette-types";
import {
  type CompiledShortcuts,
  compileShortcuts,
  type ShortcutBinding,
} from "./compile-shortcuts";
import { isTyping, resolveShortcutOwner } from "./command-resolution";
import { shortcutInputFromEvent } from "./dom-input";
import { shortcutRecording } from "./recording-store";
import { dismissShortcutPortal } from "./shortcut-focus";
import { shortcutControlLabel } from "./shortcut-label-store";
import { useFrameShortcutRouting } from "./use-frame-shortcut-routing";
import { type NativeShortcutRoutes, useNativeShortcutRouting } from "./use-native-shortcut-routing";
import { usePositionHints } from "./use-position-hints";
import { useShortcutCatalogue } from "./use-shortcut-catalogue";
import { useShortcutPreferences } from "./use-shortcut-preferences";

type Invocation = { owner: string | null; run(): void };

/** The app state that decides which owner a shortcut runs. */
type DispatchState = {
  compiled: CompiledShortcuts | null;
  /** The live registry, so a key press right after a registration still finds its owner. */
  readCommands(): readonly CommandPalettePageCommand[];
  /**
   * The command and dialog snapshots of this render. Nothing reads them: they give the state a
   * new identity when they change, so labels and routes rebuild.
   */
  version: { commands: readonly CommandPalettePageCommand[]; overlays: number };
  paletteOpen: boolean;
  togglePalette(): void;
  runAfterClose(run: () => void): void;
};

/** `typing` comes from `isTyping`, computed once for every binding of one pass. */
const invocationOf = (
  state: DispatchState,
  binding: ShortcutBinding,
  focus: Element | null,
  typing: boolean,
): Invocation | null => {
  // The palette is a dialog too, so other dialogs count only while it is closed.
  const overlayOpen = !state.paletteOpen && hasOpenDialog();
  if (binding.command.id === "palette")
    return overlayOpen ? null : { owner: null, run: state.togglePalette };
  const owner = resolveShortcutOwner(binding.command, {
    commands: state.readCommands(),
    focus,
    typing,
    paletteOpen: state.paletteOpen,
    overlayOpen,
  });
  const run = owner && (owner.resolveRun ? owner.resolveRun() : owner.run);
  if (!owner || !run) return null;
  return {
    owner: owner.focusRoot ? (owner.target?.key ?? null) : null,
    run: () => {
      dismissShortcutPortal(focus);
      if (state.paletteOpen && !owner.paletteOnly) state.runAfterClose(run);
      else run();
    },
  };
};

/** The first eligible owner of a signature. One signature has several bindings only in exclusive scopes. */
const invocationFor = (
  state: DispatchState,
  signature: string,
  focus: Element | null,
  embedded: boolean,
): Invocation | null => {
  const typing = isTyping(focus, embedded, state.paletteOpen);
  for (const binding of state.compiled?.bySignature.get(signature) ?? []) {
    const found = invocationOf(state, binding, focus, typing);
    if (found) return found;
  }
  return null;
};

/**
 * A preview page can forge its key messages, so it reaches only commands that run while typing by
 * default. A command that the user sets to run while typing, such as Send message, stays out.
 */
const pageMayRun = (binding: ShortcutBinding): boolean => binding.command.defaultWhen === "always";

const embeddedRoutes = (state: DispatchState, focus: Element, page: boolean): ShortcutRoute[] =>
  Array.from(state.compiled?.byId.values() ?? []).flatMap((binding) =>
    (!page || pageMayRun(binding)) && invocationOf(state, binding, focus, true)
      ? [{ signature: binding.signature, commandId: binding.command.id }]
      : [],
  );

/** Main claims every active signature; each browser guest gets the routes eligible inside it. */
const nativeRoutesOf = (state: DispatchState): NativeShortcutRoutes => {
  if (!state.compiled) return { claims: [], guestRoutes: {} };
  const guestRoutes: Record<string, ShortcutRoute[]> = {};
  for (const element of document.querySelectorAll<HTMLElement>("[data-browser-tab-id]")) {
    const tabId = element.getAttribute("data-browser-tab-id");
    if (tabId) guestRoutes[tabId] = embeddedRoutes(state, element, false);
  }
  return { claims: Array.from(state.compiled.bySignature.keys()), guestRoutes };
};

const embeddedTabId = (element: Element | null): string | null => {
  const frame = element?.closest("[data-browser-frame-tab-id], [data-browser-tab-id]");
  return (
    frame?.getAttribute("data-browser-frame-tab-id") ??
    frame?.getAttribute("data-browser-tab-id") ??
    null
  );
};
const sourceFocus = (tabId: string): HTMLElement | null =>
  Array.from(
    document.querySelectorAll<HTMLElement>(`[data-browser-tab-id="${CSS.escape(tabId)}"]`),
  ).find((element) => element.getClientRects().length > 0) ?? null;

/**
 * Runs shortcuts from app keys, Electron guests, and preview frames through the command registry.
 * Bindings compile once per preference change; focus changes update labels without a render.
 */
export function useShortcutDispatch({
  platform,
  isOpen,
  open,
  close,
  runAfterClose,
}: {
  platform: AppPlatform;
  isOpen: boolean;
  open(): void;
  close(): void;
  runAfterClose(run: () => void): void;
}) {
  const registry = use(CommandPaletteRegistryContext);
  if (!registry) throw new Error("Shortcut dispatch requires CommandPaletteRegistryProvider.");
  const commands = useCommandPaletteCommands();
  const overlays = useSyncExternalStore(subscribeOpenDialogs, openDialogCount, openDialogCount);
  const recording = useSyncExternalStore(
    shortcutRecording.subscribe,
    shortcutRecording.isActive,
    shortcutRecording.isActive,
  );
  const preferences = useShortcutPreferences();
  const shell = currentShortcutShell();
  const electron = shell === "electron";
  const catalogue = useShortcutCatalogue(preferences.query.data);
  const compiled = useMemo(
    () =>
      preferences.query.data
        ? compileShortcuts(preferences.query.data, catalogue, platform, shell)
        : null,
    [preferences.query.data, catalogue, platform, shell],
  );
  const state = useMemo<DispatchState>(
    () => ({
      compiled,
      readCommands: () => registry.pageCommands,
      version: { commands, overlays },
      paletteOpen: isOpen,
      togglePalette: isOpen ? close : open,
      runAfterClose,
    }),
    [compiled, commands, registry, isOpen, overlays, open, close, runAfterClose],
  );
  // Label strings depend only on the keys, so a focus change computes only each owner.
  const labelTexts = useMemo(
    () =>
      new Map(
        Array.from(compiled?.byId ?? [], ([id, binding]) => [
          id,
          shortcutControlLabel(binding.combination, platform, undefined),
        ]),
      ),
    [compiled, platform],
  );
  const [retryRevision, setRetryRevision] = useState(0);

  const inputFocus = useRef<Element | null>(null);
  const latest = useRef({ state, publishLabels: () => {}, refreshFrames: () => {} });
  const focusInput = useCallback((element: Element | null) => {
    if (inputFocus.current === element) return;
    inputFocus.current = element;
    latest.current.refreshFrames();
    latest.current.publishLabels();
  }, []);
  const reportHints = usePositionHints(platform, Boolean(compiled) && !recording && overlays === 0);
  const onEmbeddedInput = (
    tabId: string | null,
    event: EmbeddedShortcutEvent,
    current: boolean,
    page: boolean,
  ) => {
    if (event.type === "blur") {
      if (tabId === null) shortcutRecording.ended();
      reportHints(false);
      return;
    }
    const focus = tabId === null ? document.activeElement : sourceFocus(tabId);
    if (event.type === "key-state")
      reportHints(Boolean(focus && current && holdsShortcutMod(event.input, platform)));
    if (event.type !== "invoke") {
      focusInput(focus);
      return;
    }
    if (!current || tabId === null || !focus?.isConnected) return;
    const binding = compiled?.byId.get(event.commandId);
    if (
      binding &&
      (!page || pageMayRun(binding)) &&
      binding.signature === inputSignature(event.input, platform)
    )
      invocationOf(state, binding, focus, true)?.run();
  };

  const native = useNativeShortcutRouting({
    enabled: electron,
    routesVersion: state,
    readRoutes: () => nativeRoutesOf(state),
    recording,
    retryRevision,
    onInput: (tabId, event, current) => onEmbeddedInput(tabId, event, current, false),
  });
  const frames = useFrameShortcutRouting({
    retryRevision,
    routesVersion: state,
    onInput: (tabId, event, current) => onEmbeddedInput(tabId, event, current, true),
    readRoutes: (tabId) => {
      const focus = sourceFocus(tabId);
      return focus ? embeddedRoutes(state, focus, true) : [];
    },
  });
  const { prepareRecording } = native;
  useEffect(() => shortcutRecording.setPreparer(prepareRecording), [prepareRecording]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
    if (shortcutRecording.isActive() || !compiled) return;
    const signature = inputSignature(shortcutInputFromEvent(event), platform);
    const found = signature ? invocationFor(state, signature, document.activeElement, false) : null;
    if (!found) return;
    event.preventDefault();
    event.stopPropagation();
    found.run();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => onKeyDown(event);
    window.addEventListener("keydown", listener, { capture: true });
    return () => window.removeEventListener("keydown", listener, { capture: true });
  }, []);

  // Labels follow focus, so focus changes publish them directly instead of rendering this owner.
  const labelStore = registry.shortcutLabels;
  const publishLabels = () => {
    const focus = inputFocus.current ?? document.activeElement;
    const tabId = electron ? null : embeddedTabId(focus);
    const embedded = Boolean(tabId || focus?.matches("[data-browser-tab-id]"));
    const typing = isTyping(focus, embedded, state.paletteOpen);
    labelStore?.replace(
      new Map(
        compiled && frames.isReady(tabId)
          ? Array.from(compiled.byId, ([id, binding]) => [
              id,
              {
                ...labelTexts.get(id)!,
                owner: invocationOf(state, binding, focus, typing)?.owner,
              },
            ])
          : [],
      ),
    );
  };
  useLayoutEffect(() => {
    latest.current = { state, publishLabels, refreshFrames: frames.refresh };
  });
  const frameInstallations = frames.installations;
  useLayoutEffect(() => {
    latest.current.publishLabels();
  }, [state, frameInstallations]);
  useEffect(() => {
    let focusFrame = 0;
    const focus = () => focusInput(document.activeElement);
    // Entering a cross-origin iframe blurs the app window without a DOM focusin event.
    const blur = () => {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(focus);
    };
    document.addEventListener("focusin", focus);
    if (!electron) window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("blur", blur);
    };
  }, [electron, focusInput]);
  useLayoutEffect(() => () => labelStore?.replace(new Map()), [labelStore]);

  // Only unreadable preferences turn every shortcut off; other failures affect one source.
  const sourceError = preferences.updatesError ?? native.error ?? frames.error;
  let inputError: string | null = null;
  if (preferences.query.error)
    inputError = `Keyboard shortcuts are off. ${preferences.query.error.message}`;
  else if (sourceError) inputError = `Some keyboard shortcuts are unavailable. ${sourceError}`;
  return {
    inputError,
    retry: () => {
      if (preferences.query.error) void preferences.query.refetch();
      else setRetryRevision((value) => value + 1);
    },
  };
}
