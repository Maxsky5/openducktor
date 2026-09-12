import type {
  IBufferCellPosition,
  ILinkHandler,
  IDisposable,
  ITerminalAddon,
  Terminal,
} from "@xterm/xterm";
import {
  createHttpLinkProvider,
  type HttpLinkProvider,
  type LinkTarget,
  rangeHasCell,
  sameLink,
} from "./terminal-link-provider";
import { LINK_DRAG_PX, LINK_POINTER_CLASS, LINKS_ENABLED_CLASS } from "./constants";
import { checkHttpUrl } from "./terminal-url-policy";

type LinkPress = {
  startX: number;
  startY: number;
  stopped: boolean;
  target: LinkTarget;
};

type LinkControllerOptions = {
  container: HTMLElement;
  openUrl(url: string): Promise<void>;
  reportOpenError(url: string, cause: unknown): void;
};

export type LinkController = ITerminalAddon & {
  readonly linkHandler: ILinkHandler;
  reset(): void;
};

export const createLinkController = ({
  container,
  openUrl,
  reportOpenError,
}: LinkControllerOptions): LinkController => {
  const view = container.ownerDocument.defaultView;
  if (!view) throw new Error("Cannot create terminal links without a browser window.");
  const platform = view.navigator.platform;
  let terminal: Terminal | null = null;
  let provider: HttpLinkProvider | null = null;
  let hovered: LinkTarget | null = null;
  let press: LinkPress | null = null;
  let blockClick = false;
  let clickBlockTimer: number | null = null;
  let disposed = false;
  const subscriptions: IDisposable[] = [];

  const startKeyWatch = (): void => {
    view.addEventListener("keydown", handleKeyChange, true);
    view.addEventListener("keyup", handleKeyChange, true);
    view.addEventListener("blur", handleBlur);
  };

  const stopKeyWatchIfIdle = (): void => {
    if (hovered || press) return;
    view.removeEventListener("keydown", handleKeyChange, true);
    view.removeEventListener("keyup", handleKeyChange, true);
    view.removeEventListener("blur", handleBlur);
  };

  const startDragWatch = (): void => {
    startKeyWatch();
    view.addEventListener("mousemove", handleMouseMove, true);
    view.addEventListener("mouseup", handleMouseUp, true);
  };

  const stopDragWatch = (): void => {
    view.removeEventListener("mousemove", handleMouseMove, true);
    view.removeEventListener("mouseup", handleMouseUp, true);
    stopKeyWatchIfIdle();
  };

  const endPress = (): void => {
    press = null;
    stopDragWatch();
  };

  const startClickBlock = (): void => {
    view.addEventListener("click", handleClick, true);
  };

  const stopClickBlock = (): void => {
    view.removeEventListener("click", handleClick, true);
  };

  const setPointer = (event?: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): void => {
    const show = hovered !== null && event !== undefined && hasOpenKey(event, platform);
    container.classList.toggle(LINK_POINTER_CLASS, show);
  };

  const clearHover = (): void => {
    hovered = null;
    container.classList.remove(LINK_POINTER_CLASS);
    stopKeyWatchIfIdle();
  };

  const stopPress = (): void => {
    if (press) press.stopped = true;
  };

  const reset = (): void => {
    clearHover();
    stopPress();
  };

  const checkHover = (): void => {
    if (hovered?.source !== "plain" || provider?.isCurrent(hovered)) return;
    reset();
  };

  const readLink = (event: MouseEvent): LinkTarget | null => {
    if (!terminal || !provider) return null;
    const position = readPointerCell(terminal, event);
    if (!position) return null;
    if (
      hovered?.source === "osc" &&
      rangeHasCell(hovered.range, position, terminal.cols) &&
      checkHttpUrl(hovered.url)
    ) {
      return hovered;
    }
    if (terminal.element?.querySelector(".xterm-screen.xterm-cursor-pointer")) return null;
    return provider.findLinkAt(position);
  };

  const findOscLink = (event: MouseEvent): void => {
    if (hovered || !terminal) return;
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) return;
    // xterm finds OSC 8 links on mousemove. A non-bubbling event keeps it out of mouse tracking.
    screen.dispatchEvent(
      new view.MouseEvent("mousemove", {
        altKey: event.altKey,
        bubbles: false,
        cancelable: false,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      }),
    );
  };

  const openLink = (target: LinkTarget): void => {
    void openUrl(target.url).catch((cause) => {
      if (!disposed) reportOpenError(target.url, cause);
    });
  };

  const handleHover = (event: MouseEvent, target: LinkTarget): void => {
    if (disposed) return;
    hovered = target;
    startKeyWatch();
    setPointer(event);
  };

  const handleLeave = (_event: MouseEvent, target: LinkTarget): void => {
    if (!hovered || !sameLink(hovered, target)) return;
    clearHover();
    stopPress();
  };

  const handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !hasOpenKey(event, platform)) return;
    findOscLink(event);
    const target = readLink(event);
    if (!target) return;
    press = {
      startX: event.clientX,
      startY: event.clientY,
      stopped: false,
      target,
    };
    startDragWatch();
    stopEvent(event);
  };

  const handleMouseMove = (event: MouseEvent): void => {
    if (!press) return;
    stopEvent(event);
    const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
    const target = readLink(event);
    if (
      distance > LINK_DRAG_PX ||
      !hasOpenKey(event, platform) ||
      !target ||
      !sameLink(target, press.target)
    ) {
      stopPress();
    }
  };

  const handleMouseUp = (event: MouseEvent): void => {
    if (!press || event.button !== 0) return;
    const completedPress = press;
    press = null;
    stopDragWatch();
    stopEvent(event);
    blockClick = true;
    startClickBlock();
    if (clickBlockTimer !== null) view.clearTimeout(clickBlockTimer);
    clickBlockTimer = view.setTimeout(() => {
      blockClick = false;
      clickBlockTimer = null;
      stopClickBlock();
    }, 0);

    const target = readLink(event);
    if (
      !completedPress.stopped &&
      hasOpenKey(event, platform) &&
      target &&
      sameLink(target, completedPress.target)
    ) {
      openLink(completedPress.target);
    }
  };

  const handleClick = (event: MouseEvent): void => {
    if (!blockClick) return;
    blockClick = false;
    if (clickBlockTimer !== null) view.clearTimeout(clickBlockTimer);
    clickBlockTimer = null;
    stopClickBlock();
    stopEvent(event);
  };

  const handleKeyChange = (event: KeyboardEvent): void => {
    setPointer(event);
    if (press && !hasOpenKey(event, platform)) stopPress();
  };

  const handleBlur = (): void => {
    clearHover();
    endPress();
  };

  const handleContainerLeave = (): void => {
    clearHover();
    stopPress();
  };

  const linkHandler: ILinkHandler = {
    allowNonHttpProtocols: false,
    activate: () => {
      // The capture handler opens links.
    },
    hover: (event, url, range) => {
      const href = checkHttpUrl(url);
      if (!href) return;
      handleHover(event, { range, source: "osc", url: href });
    },
    leave: (event, url, range) => {
      const href = checkHttpUrl(url);
      if (!href) return;
      handleLeave(event, { range, source: "osc", url: href });
    },
  };

  return {
    linkHandler,
    activate: (activeTerminal) => {
      if (disposed) throw new Error("Cannot activate a disposed terminal link controller.");
      terminal = activeTerminal;
      container.classList.add(LINKS_ENABLED_CLASS);
      provider = createHttpLinkProvider(activeTerminal, {
        hover: handleHover,
        leave: handleLeave,
      });
      subscriptions.push(
        activeTerminal.registerLinkProvider(provider),
        activeTerminal.onWriteParsed(reset),
        activeTerminal.onRender(checkHover),
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
      if (clickBlockTimer !== null) view.clearTimeout(clickBlockTimer);
      clickBlockTimer = null;
      reset();
      container.classList.remove(LINKS_ENABLED_CLASS);
      press = null;
      hovered = null;
      stopDragWatch();
      stopKeyWatchIfIdle();
      stopClickBlock();
      for (const subscription of subscriptions.splice(0)) subscription.dispose();
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("mouseleave", handleContainerLeave);
      terminal = null;
      provider = null;
    },
  };
};

export function hasOpenKey(
  event: Pick<MouseEvent, "ctrlKey" | "metaKey">,
  platform: string,
): boolean {
  return isMac(platform) ? event.metaKey : event.ctrlKey;
}

function readPointerCell(
  terminal: Pick<Terminal, "buffer" | "cols" | "element" | "rows">,
  event: Pick<MouseEvent, "clientX" | "clientY">,
): IBufferCellPosition | null {
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
}

function isMac(platform: string): boolean {
  return /mac/i.test(platform);
}

function stopEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}
