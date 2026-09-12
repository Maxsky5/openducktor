import type {
  IBufferCellPosition,
  ILinkHandler,
  IDisposable,
  ITerminalAddon,
  Terminal,
} from "@xterm/xterm";
import {
  createTerminalHttpLinkProvider,
  sameTerminalLinkTarget,
  terminalRangeContains,
  type TerminalHttpLinkProvider,
  type TerminalLinkTarget,
} from "./terminal-link-provider";
import { validateTerminalHttpUrl } from "./terminal-url-policy";

const LINK_POINTER_CLASS = "odt-terminal-link-pointer";
const LINKS_ENABLED_CLASS = "odt-terminal-links";
const DRAG_THRESHOLD_PX = 4;

type TerminalLinkGesture = {
  cancelled: boolean;
  originX: number;
  originY: number;
  target: TerminalLinkTarget;
};

type TerminalLinkControllerInput = {
  container: HTMLElement;
  openUrl(url: string): Promise<void>;
  reportOpenError(url: string, cause: unknown): void;
};

export type TerminalLinkController = ITerminalAddon & {
  readonly linkHandler: ILinkHandler;
  reset(): void;
};

const isMacPlatform = (platform: string): boolean => /mac/i.test(platform);

export const hasTerminalOpenModifier = (
  event: Pick<MouseEvent, "ctrlKey" | "metaKey">,
  platform: string,
): boolean => (isMacPlatform(platform) ? event.metaKey : event.ctrlKey);

const stopTerminalLinkEvent = (event: Event): void => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
};

export const readTerminalPointerPosition = (
  terminal: Pick<Terminal, "buffer" | "cols" | "element" | "rows">,
  event: Pick<MouseEvent, "clientX" | "clientY">,
): IBufferCellPosition | null => {
  const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen || terminal.cols < 1 || terminal.rows < 1) return null;
  const rect = screen.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    event.clientX < rect.left ||
    event.clientX >= rect.right ||
    event.clientY < rect.top ||
    event.clientY >= rect.bottom
  ) {
    return null;
  }

  return {
    x: Math.floor(((event.clientX - rect.left) / rect.width) * terminal.cols) + 1,
    y:
      terminal.buffer.active.viewportY +
      Math.floor(((event.clientY - rect.top) / rect.height) * terminal.rows) +
      1,
  };
};

export const createTerminalLinkController = ({
  container,
  openUrl,
  reportOpenError,
}: TerminalLinkControllerInput): TerminalLinkController => {
  const view = container.ownerDocument.defaultView;
  if (!view) throw new Error("Cannot create terminal links without a browser window.");
  const platform = view.navigator.platform;
  let terminal: Terminal | null = null;
  let provider: TerminalHttpLinkProvider | null = null;
  let hovered: TerminalLinkTarget | null = null;
  let gesture: TerminalLinkGesture | null = null;
  let suppressClick = false;
  let clickResetHandle: number | null = null;
  let disposed = false;
  let hoverWindowListenersAttached = false;
  let gestureWindowListenersAttached = false;
  let clickWindowListenerAttached = false;
  const subscriptions: IDisposable[] = [];

  const attachHoverWindowListeners = (): void => {
    if (hoverWindowListenersAttached) return;
    hoverWindowListenersAttached = true;
    view.addEventListener("keydown", handleKeyChange, true);
    view.addEventListener("keyup", handleKeyChange, true);
    view.addEventListener("blur", handleBlur);
  };

  const detachHoverWindowListenersIfIdle = (): void => {
    if (!hoverWindowListenersAttached || hovered || gesture) return;
    hoverWindowListenersAttached = false;
    view.removeEventListener("keydown", handleKeyChange, true);
    view.removeEventListener("keyup", handleKeyChange, true);
    view.removeEventListener("blur", handleBlur);
  };

  const attachGestureWindowListeners = (): void => {
    attachHoverWindowListeners();
    if (gestureWindowListenersAttached) return;
    gestureWindowListenersAttached = true;
    view.addEventListener("mousemove", handleMouseMove, true);
    view.addEventListener("mouseup", handleMouseUp, true);
  };

  const detachGestureWindowListeners = (): void => {
    if (!gestureWindowListenersAttached) return;
    gestureWindowListenersAttached = false;
    view.removeEventListener("mousemove", handleMouseMove, true);
    view.removeEventListener("mouseup", handleMouseUp, true);
    detachHoverWindowListenersIfIdle();
  };

  const attachClickWindowListener = (): void => {
    if (clickWindowListenerAttached) return;
    clickWindowListenerAttached = true;
    view.addEventListener("click", handleClick, true);
  };

  const detachClickWindowListener = (): void => {
    if (!clickWindowListenerAttached) return;
    clickWindowListenerAttached = false;
    view.removeEventListener("click", handleClick, true);
  };

  const updatePointer = (event?: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): void => {
    const openable =
      hovered !== null && event !== undefined && hasTerminalOpenModifier(event, platform);
    container.classList.toggle(LINK_POINTER_CLASS, openable);
  };

  const clearHover = (): void => {
    hovered = null;
    container.classList.remove(LINK_POINTER_CLASS);
    detachHoverWindowListenersIfIdle();
  };

  const cancelGesture = (): void => {
    if (gesture) gesture.cancelled = true;
  };

  const reset = (): void => {
    clearHover();
    cancelGesture();
  };

  const validateHover = (): void => {
    if (hovered?.source !== "plain" || provider?.isCurrent(hovered)) return;
    reset();
  };

  const readTargetAt = (event: MouseEvent): TerminalLinkTarget | null => {
    if (!terminal || !provider) return null;
    const position = readTerminalPointerPosition(terminal, event);
    if (!position) return null;
    if (
      hovered?.source === "osc" &&
      terminalRangeContains(hovered.range, position, terminal.cols) &&
      validateTerminalHttpUrl(hovered.url)
    ) {
      return hovered;
    }
    return provider.findLinkAt(position);
  };

  const openTarget = (target: TerminalLinkTarget): void => {
    void openUrl(target.url).catch((cause) => {
      if (!disposed) reportOpenError(target.url, cause);
    });
  };

  const handleHover = (event: MouseEvent, target: TerminalLinkTarget): void => {
    if (disposed) return;
    hovered = target;
    attachHoverWindowListeners();
    updatePointer(event);
  };

  const handleLeave = (_event: MouseEvent, target: TerminalLinkTarget): void => {
    if (!hovered || !sameTerminalLinkTarget(hovered, target)) return;
    clearHover();
    cancelGesture();
  };

  const handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !hasTerminalOpenModifier(event, platform)) return;
    const target = readTargetAt(event);
    if (!target) return;
    gesture = {
      cancelled: false,
      originX: event.clientX,
      originY: event.clientY,
      target,
    };
    attachGestureWindowListeners();
    stopTerminalLinkEvent(event);
  };

  const handleMouseMove = (event: MouseEvent): void => {
    if (!gesture) return;
    stopTerminalLinkEvent(event);
    const distance = Math.hypot(event.clientX - gesture.originX, event.clientY - gesture.originY);
    const target = readTargetAt(event);
    if (
      distance > DRAG_THRESHOLD_PX ||
      !hasTerminalOpenModifier(event, platform) ||
      !target ||
      !sameTerminalLinkTarget(target, gesture.target)
    ) {
      cancelGesture();
    }
  };

  const handleMouseUp = (event: MouseEvent): void => {
    if (!gesture || event.button !== 0) return;
    const completedGesture = gesture;
    gesture = null;
    detachGestureWindowListeners();
    stopTerminalLinkEvent(event);
    suppressClick = true;
    attachClickWindowListener();
    if (clickResetHandle !== null) view.clearTimeout(clickResetHandle);
    clickResetHandle = view.setTimeout(() => {
      suppressClick = false;
      clickResetHandle = null;
      detachClickWindowListener();
    }, 0);

    const target = readTargetAt(event);
    if (
      !completedGesture.cancelled &&
      hasTerminalOpenModifier(event, platform) &&
      target &&
      sameTerminalLinkTarget(target, completedGesture.target)
    ) {
      openTarget(completedGesture.target);
    }
  };

  const handleClick = (event: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    if (clickResetHandle !== null) view.clearTimeout(clickResetHandle);
    clickResetHandle = null;
    detachClickWindowListener();
    stopTerminalLinkEvent(event);
  };

  const handleKeyChange = (event: KeyboardEvent): void => {
    updatePointer(event);
    if (gesture && !hasTerminalOpenModifier(event, platform)) cancelGesture();
  };

  const handleBlur = (): void => {
    reset();
  };

  const handleContainerLeave = (): void => {
    clearHover();
    cancelGesture();
  };

  const linkHandler: ILinkHandler = {
    allowNonHttpProtocols: false,
    activate: () => {
      // Capture-phase gesture handling owns activation.
    },
    hover: (event, url, range) => {
      const validated = validateTerminalHttpUrl(url);
      if (!validated) return;
      handleHover(event, { range, source: "osc", url: validated });
    },
    leave: (event, url, range) => {
      const validated = validateTerminalHttpUrl(url);
      if (!validated) return;
      handleLeave(event, { range, source: "osc", url: validated });
    },
  };

  return {
    linkHandler,
    activate: (activeTerminal) => {
      if (disposed) throw new Error("Cannot activate a disposed terminal link controller.");
      terminal = activeTerminal;
      container.classList.add(LINKS_ENABLED_CLASS);
      provider = createTerminalHttpLinkProvider(activeTerminal, {
        activate: () => {
          // Capture-phase gesture handling owns activation.
        },
        hover: handleHover,
        leave: handleLeave,
      });
      subscriptions.push(
        activeTerminal.registerLinkProvider(provider),
        activeTerminal.onWriteParsed(reset),
        activeTerminal.onRender(validateHover),
        activeTerminal.onResize(reset),
        activeTerminal.onScroll(reset),
        activeTerminal.buffer.onBufferChange(reset),
      );
      container.addEventListener("mousedown", handleMouseDown, true);
      container.addEventListener("mouseleave", handleContainerLeave);
    },
    reset,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (clickResetHandle !== null) view.clearTimeout(clickResetHandle);
      clickResetHandle = null;
      reset();
      container.classList.remove(LINKS_ENABLED_CLASS);
      gesture = null;
      hovered = null;
      detachGestureWindowListeners();
      detachHoverWindowListenersIfIdle();
      detachClickWindowListener();
      for (const subscription of subscriptions.splice(0)) subscription.dispose();
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("mouseleave", handleContainerLeave);
      terminal = null;
      provider = null;
    },
  };
};
