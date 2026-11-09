import type { ShortcutActionId } from "@openducktor/contracts";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useQueryClient } from "@tanstack/react-query";
import { keyboardShortcutsQueryOptions } from "@openducktor/frontend-core/queries/keyboard-shortcuts";
import { useShortcutCatalogue } from "./use-shortcut-catalogue";
import type { AppPlatform, ShortcutRoute, EmbeddedShortcutEvent } from "@openducktor/contracts";
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
import { CommandPaletteRegistryContext } from "../command-palette/command-palette-registry";
import { matchesShortcut, shortcutLabel } from "@openducktor/frontend-core/shortcuts/key-matching";
import { getShellBridge } from "@/lib/shell-bridge";
import { hasOpenDialog, openDialogCount, subscribeOpenDialogs } from "@/components/ui/open-dialogs";
import type {
  CommandPalettePageCommand,
  PaletteAction,
} from "../command-palette/command-palette-types";
import { commandIdFromPalette, effectiveShortcut, validateShortcuts } from "./catalogue";
import { isProtectedFocus, resolvePageCommand } from "./command-resolution";
import { shortcutInputFromEvent } from "./dom-input";
import { registerShortcutRecorder } from "./recording";
import { usePositionHints } from "./use-position-hints";
import { useShortcutPreferences } from "./use-shortcut-preferences";
import { useNativeShortcutRouting } from "./use-native-shortcut-routing";
import { useFrameShortcutRouting } from "./use-frame-shortcut-routing";
import { dismissShortcutPortal } from "./shortcut-focus";

export function useShortcutDispatch({
  platform,
  pageCommands,
  actions,
  isOpen,
  open,
  close,
  runAfterClose,
}: {
  platform: AppPlatform;
  pageCommands: readonly CommandPalettePageCommand[];
  actions: readonly PaletteAction[];
  isOpen: boolean;
  open(): void;
  close(): void;
  runAfterClose(run: () => void): void;
}) {
  const registry = use(CommandPaletteRegistryContext);
  const hostConnection = useHostConnection();
  const queryClient = useQueryClient();
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    void hostConnection
      .subscribeRunEvents((event) => {
        if (
          ("type" in event && event.type === "keyboard_shortcuts_saved") ||
          ("__openducktorConnectionControl" in event &&
            event.kind === "reconnected" &&
            event.missedEvents)
        ) {
          return queryClient.invalidateQueries({
            queryKey: keyboardShortcutsQueryOptions().queryKey,
            exact: true,
          });
        }
      })
      .then(
        (stop) => {
          if (disposed) stop();
          else release = stop;
        },
        (cause) => {
          if (!disposed)
            setSubscriptionError(
              `Shortcut updates are unavailable. Reload the app to reconnect. ${String(cause)}`,
            );
        },
      );
    return () => {
      disposed = true;
      release?.();
    };
  }, [hostConnection, queryClient]);
  const [retryRevision, setRetryRevision] = useState(0);
  const overlays = useSyncExternalStore(subscribeOpenDialogs, openDialogCount, openDialogCount);
  const preferences = useShortcutPreferences();
  const electron = getShellBridge().browser.surface === "electron";
  const definitions = useShortcutCatalogue();

  const bindings = useMemo(
    () =>
      definitions.flatMap((definition) => {
        const combination = preferences.query.data
          ? effectiveShortcut(definition.id, preferences.query.data, platform, electron)
          : null;
        return combination ? [{ definition, combination }] : [];
      }),
    [definitions, preferences.query.data, platform, electron],
  );

  const appActions = useMemo(
    () =>
      new Map(
        actions.flatMap((action) => {
          const id = commandIdFromPalette(action.key);
          return id && !action.disabledReason ? [[id, action] as const] : [];
        }),
      ),
    [actions],
  );

  const inputFocus = useRef<Element | null>(null);
  const [focusedFrameTabId, setFocusedFrameTabId] = useState<string | null>(null);
  const recording = useRef(false);
  const validationError = useMemo(
    () =>
      preferences.query.error?.message ??
      (preferences.query.data
        ? validateShortcuts(preferences.query.data, platform, electron, definitions)
        : null),
    [preferences.query.error, preferences.query.data, platform, electron, definitions],
  );
  const resolveInvocation = (
    id: ShortcutActionId,
    focus: Element | null,
    embedded: boolean,
  ): { run(): void; owner: string | null } | null => {
    if (!preferences.query.data || validationError || recording.current) return null;
    const definition = definitions.find((entry) => entry.id === id);
    if (
      !definition ||
      (isOpen && id !== "palette" && definition.context !== "task" && definition.context !== "chat")
    )
      return null;
    const localCommand = resolvePageCommand(
      registry ? registry.pageCommands : pageCommands,
      id,
      focus,
      isOpen,
    );
    const overlay = !isOpen && hasOpenDialog();
    if (overlay && !localCommand?.focusRoot?.()?.closest('[role="dialog"], [role="alertdialog"]'))
      return null;
    if (
      (embedded || (!isOpen && isProtectedFocus(focus))) &&
      !definition.allowInput &&
      !localCommand?.ownsInput
    )
      return null;
    if (id === "palette") return { owner: null, run: () => (isOpen ? close() : open()) };
    const command = localCommand;
    if (command) {
      const run = command.resolveRun ? command.resolveRun() : command.run;
      return run
        ? {
            owner: command.focusRoot ? (command.target?.key ?? null) : null,
            run: () => {
              dismissShortcutPortal(focus);
              if (isOpen && !command.paletteOnly) runAfterClose(run);
              else run();
            },
          }
        : null;
    }
    if (isOpen) return null;
    const action = appActions.get(id);
    return action ? { owner: null, run: action.run } : null;
  };
  const embeddedRoutes = (focus: Element | null): ShortcutRoute[] =>
    preferences.query.data && !validationError
      ? bindings.flatMap(({ definition, combination }) =>
          resolveInvocation(definition.id, focus, true)
            ? [{ commandId: definition.id, combination }]
            : [],
        )
      : [];
  const sourceFocus = (tabId: string) =>
    Array.from(
      document.querySelectorAll<HTMLElement>(`[data-browser-tab-id="${CSS.escape(tabId)}"]`),
    ).find((element) => element.getClientRects().length > 0) ?? null;
  const onEmbeddedInput = (tabId: string | null, event: EmbeddedShortcutEvent, ready: boolean) => {
    if (event.type === "blur") {
      if (tabId === null) {
        recording.current = false;
        document.documentElement.removeAttribute("data-shortcut-recording");
      }
      document.documentElement.removeAttribute("data-shortcut-hints");
      return;
    }
    const focus = tabId === null ? document.activeElement : sourceFocus(tabId);
    if (event.type === "key-state" || event.type === "focus") {
      if (event.type === "key-state") {
        const mod = platform === "darwin" ? event.input.meta : event.input.ctrl;
        if (
          focus &&
          mod &&
          !event.input.composing &&
          !recording.current &&
          !hasOpenDialog() &&
          preferences.query.data &&
          !validationError &&
          (electron ? !native.error : ready)
        )
          document.documentElement.setAttribute("data-shortcut-hints", "true");
        else document.documentElement.removeAttribute("data-shortcut-hints");
      }
      focusInput(focus);
      return;
    }
    if (event.type !== "invoke" || !ready || tabId === null || !focus?.isConnected) return;
    const combination = preferences.query.data
      ? effectiveShortcut(event.commandId, preferences.query.data, platform, electron)
      : null;
    if (combination && matchesShortcut(combination, event.input, platform))
      resolveInvocation(event.commandId, focus, true)?.run();
  };
  const routesVersion = useMemo(
    () => ({
      bindings,
      pageCommands,
      actions,
      focusedFrameTabId,
      isOpen,
      validationError,
      overlays,
    }),
    [bindings, pageCommands, actions, focusedFrameTabId, isOpen, validationError, overlays],
  );
  const native = useNativeShortcutRouting({
    enabled: electron,
    retryRevision,
    routesVersion,
    recording,
    onInput: onEmbeddedInput,
    readRoutes: () => {
      const closeBinding = preferences.query.data
        ? effectiveShortcut("close-panel-tab", preferences.query.data, platform, true)
        : null;
      return {
        reservePanelCloseModW: Boolean(
          !validationError &&
          closeBinding &&
          closeBinding.key.kind === "logical" &&
          closeBinding.key.key.toLowerCase() === "w" &&
          closeBinding.meta === (platform === "darwin") &&
          closeBinding.ctrl === (platform !== "darwin") &&
          !closeBinding.alt &&
          !closeBinding.shift,
        ),
        suppressMenuFor:
          preferences.query.data && !validationError
            ? bindings.flatMap(({ definition: { id }, combination }) =>
                resolveInvocation(id, document.activeElement, false) ? [combination] : [],
              )
            : [],
        guestRoutes: embeddedRoutes(inputFocus.current),
      };
    },
  });
  const frames = useFrameShortcutRouting({
    retryRevision,
    routesVersion,
    onInput: onEmbeddedInput,
    readRoutes: (tabId) => {
      const focus = sourceFocus(tabId);
      return focus ? embeddedRoutes(focus) : [];
    },
  });
  const { prepareRecording } = native;
  useEffect(
    () =>
      registerShortcutRecorder(async (active) => {
        recording.current = active;
        await prepareRecording(active);
      }),
    [prepareRecording],
  );
  const onShortcut = useEffectEvent((event: KeyboardEvent, keyPlatform: AppPlatform): void => {
    const input = shortcutInputFromEvent(event);
    if (
      input.phase !== "down" ||
      input.repeat ||
      input.composing ||
      (!input.ctrl && !input.meta && !input.alt)
    )
      return;
    if (document.querySelector("[data-shortcut-recording]")) return;
    if (!preferences.query.data || validationError || !native.ready) return;
    let candidate: { invoke: ReturnType<typeof resolveInvocation> } | null = null;
    for (const { definition, combination } of bindings) {
      if (!matchesShortcut(combination, input, keyPlatform)) continue;
      const invoke = resolveInvocation(definition.id, document.activeElement, false);
      const reserve =
        electron && definition.id === "close-panel-tab" && native.reservePanelCloseModW;
      if (invoke || reserve) {
        candidate = { invoke };
        break;
      }
    }
    if (!candidate) return;
    event.preventDefault();
    event.stopPropagation();
    candidate.invoke?.run();
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => onShortcut(event, platform);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [platform]);

  const focusedSourceReady = frames.isReady(focusedFrameTabId);
  const hintsAvailable =
    Boolean(preferences.query.data) && !validationError && !native.error && focusedSourceReady;
  usePositionHints(platform, hintsAvailable && !hasOpenDialog());
  const assignmentLabel = (id: ShortcutActionId): string | null => {
    if (!hintsAvailable || !preferences.query.data) return null;
    const combination = effectiveShortcut(id, preferences.query.data, platform, electron);
    return combination ? shortcutLabel(combination, platform) : null;
  };
  const labelForCommand = (id: ShortcutActionId): string | null =>
    native.ready ? assignmentLabel(id) : null;
  const labelStore = registry?.shortcutLabels;
  const publishLabels = (frameId = focusedFrameTabId) => {
    const available =
      Boolean(preferences.query.data) &&
      !validationError &&
      !native.error &&
      frames.isReady(frameId);
    const focus = inputFocus.current ?? document.activeElement;
    const embedded = Boolean(frameId || inputFocus.current?.matches("[data-browser-tab-id]"));
    labelStore?.replace(
      new Map(
        bindings.flatMap(({ definition: { id }, combination }) => {
          if (!available) return [];
          const label = shortcutLabel(combination, platform);
          const invocation = native.ready ? resolveInvocation(id, focus, embedded) : null;
          return [[id, { label, owner: invocation?.owner }] as const];
        }),
      ),
    );
  };
  const focusRoutes = useRef({ electron, native, frames, publishLabels });
  useLayoutEffect(() => {
    focusRoutes.current = { electron, native, frames, publishLabels };
    publishLabels();
  });
  const focusInput = useCallback((element: Element | null) => {
    if (inputFocus.current === element) return;
    inputFocus.current = element;
    const frame = element?.closest("[data-browser-frame-tab-id], [data-browser-tab-id]");
    const current = focusRoutes.current;
    const frameId = current.electron
      ? null
      : (frame?.getAttribute("data-browser-frame-tab-id") ??
        frame?.getAttribute("data-browser-tab-id") ??
        null);
    setFocusedFrameTabId(frameId);
    current.native.refresh();
    current.frames.refresh();
    current.publishLabels(frameId);
  }, []);
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
  return {
    labelForCommand,
    inputError: validationError ?? subscriptionError ?? native.error ?? frames.error ?? null,
    retry: () => {
      if (validationError) {
        void preferences.query.refetch();
        return;
      }
      setRetryRevision((value) => value + 1);
    },
  };
}
