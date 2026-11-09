import type { BrowserWindow, IpcMain, Input, IpcMainInvokeEvent, WebContents } from "electron";
import {
  electronShortcutRulesSchema,
  type ElectronShortcutRules,
  type ShortcutInput,
  type ShortcutCombination,
  type EmbeddedShortcutEvent,
} from "@openducktor/contracts";
import { matchesShortcut } from "@openducktor/frontend-core/shortcuts/key-matching";
import {
  ELECTRON_SHORTCUT_APPLY_CHANNEL,
  ELECTRON_SHORTCUT_EVENT_CHANNEL,
  ELECTRON_SHORTCUT_RELEASE_CHANNEL,
} from "../shared/electron-bridge-contract";

type WindowRouting = { window: BrowserWindow; rules: ElectronShortcutRules; release(): void };
const windows = new Map<number, WindowRouting>();
const guests = new Map<number, () => { windowId: number | null; tabId: string }>();
const platform =
  process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
const toInput = (
  input: Pick<Input, "type" | "key" | "control" | "meta" | "alt" | "shift"> &
    Partial<Pick<Input, "code" | "isComposing" | "isAutoRepeat">>,
): ShortcutInput => ({
  phase: input.type === "keyUp" ? "up" : "down",
  key: input.key,
  code: input.code ?? "",
  ctrl: input.control,
  meta: input.meta,
  alt: input.alt,
  shift: input.shift,
  composing: input.isComposing === true,
  repeat: input.isAutoRepeat === true,
});
const matchesNativeClaim = (combination: ShortcutCombination, input: ShortcutInput): boolean =>
  matchesShortcut(combination, { ...input, repeat: false }, platform);
const isReservedClose = (rules: ElectronShortcutRules, input: ShortcutInput): boolean =>
  rules.reservePanelCloseModW &&
  matchesNativeClaim(
    {
      key: { kind: "logical", key: "w" },
      ctrl: platform !== "darwin",
      meta: platform === "darwin",
      alt: false,
      shift: false,
    },
    { ...input, composing: false },
  );
const publish = (
  renderer: WebContents,
  sourceTabId: string | null,
  event: EmbeddedShortcutEvent,
): void => {
  if (!renderer.isDestroyed())
    renderer.send(ELECTRON_SHORTCUT_EVENT_CHANNEL, { sourceTabId, event });
};
const guestHintStates = new Map<number, boolean>();
export const bindShortcutGuest = (
  id: number,
  identity: () => { windowId: number | null; tabId: string },
): (() => void) => {
  guests.set(id, identity);
  return () => {
    guests.delete(id);
    guestHintStates.delete(id);
  };
};
export const focusShortcutGuest = (guestId: number): void => {
  guestHintStates.delete(guestId);
  const identity = guests.get(guestId)?.();
  const routing =
    identity && identity.windowId !== null ? windows.get(identity.windowId) : undefined;
  if (routing && identity) publish(routing.window.webContents, identity.tabId, { type: "focus" });
};
export const routeGuestShortcut = (
  guestId: number,
  event: { preventDefault(): void },
  rawInput: Parameters<typeof toInput>[0],
): boolean => {
  const identity = guests.get(guestId)?.();
  const routing =
    identity && identity.windowId !== null ? windows.get(identity.windowId) : undefined;
  if (!routing || !identity) return false;
  const input = toInput(rawInput);
  const showHints = (platform === "darwin" ? input.meta : input.ctrl) && !input.composing;
  if (showHints !== (guestHintStates.get(guestId) ?? false)) {
    guestHintStates.set(guestId, showHints);
    publish(routing.window.webContents, identity.tabId, { type: "key-state", input });
  }
  if (routing.rules.recording) return false;
  const route = routing.rules.guestRoutes.find((route) =>
    matchesNativeClaim(route.combination, input),
  );
  if (!route && !isReservedClose(routing.rules, input)) return false;
  event.preventDefault();
  if (route && matchesShortcut(route.combination, input, platform))
    publish(routing.window.webContents, identity.tabId, {
      type: "invoke",
      revision: routing.rules.revision,
      commandId: route.commandId,
      input,
    });
  return true;
};
export function registerElectronShortcutIpc(
  ipcMain: Pick<IpcMain, "handle">,
  fromContents: (contents: WebContents) => BrowserWindow | null,
): void {
  const trustedWindow = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = fromContents(event.sender);
    if (
      !window ||
      window.webContents !== event.sender ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Shortcut routing requires the app's main renderer frame.");
    return window;
  };
  ipcMain.handle(ELECTRON_SHORTCUT_APPLY_CHANNEL, (event, raw: ElectronShortcutRules) => {
    const window = trustedWindow(event);
    windows.get(event.sender.id)?.release();
    windows.delete(event.sender.id);
    const rules = electronShortcutRulesSchema.parse(raw);
    const onInput = (_event: Electron.Event, rawInput: Input) => {
      const input = toInput(rawInput);
      window.webContents.setIgnoreMenuShortcuts(
        rules.recording ||
          isReservedClose(rules, input) ||
          rules.suppressMenuFor.some((combination) => matchesNativeClaim(combination, input)),
      );
    };
    const onBlur = () => {
      guestHintStates.clear();
      rules.recording = false;
      window.webContents.setIgnoreMenuShortcuts(false);
      publish(window.webContents, null, { type: "blur" });
    };
    const onDestroyed = () => {
      windows.get(event.sender.id)?.release();
      windows.delete(event.sender.id);
    };
    const release = () => {
      window.webContents.removeListener("destroyed", onDestroyed);
      window.webContents.removeListener("before-input-event", onInput);
      window.removeListener("blur", onBlur);
      if (!window.webContents.isDestroyed()) window.webContents.setIgnoreMenuShortcuts(false);
    };
    windows.set(event.sender.id, { window, rules, release });
    window.webContents.on("before-input-event", onInput);
    window.on("blur", onBlur);
    window.webContents.once("destroyed", onDestroyed);
  });
  ipcMain.handle(ELECTRON_SHORTCUT_RELEASE_CHANNEL, (event) => {
    trustedWindow(event);
    windows.get(event.sender.id)?.release();
    windows.delete(event.sender.id);
  });
}
