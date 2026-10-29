/**
 * Runtime helpers for isolated pages, which run in a WebView with no network and no navigation.
 *
 * The app type check has no DOM library, because it conflicts with the React Native globals. So
 * this module declares the few DOM members that pages use, and pages read the DOM through it.
 *
 * `startPageChannel` installs the message listener, validates each app message with the page
 * channel schema, and posts `page_ready`. It returns `post`, which validates each page message.
 */
import type { z } from "zod";
import {
  decodePageMessage,
  encodePageMessage,
  type PageChannel,
  pageReadyMessageSchema,
} from "../../page-channel";

type PageRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type PageElement = {
  id: string;
  className: string;
  innerHTML: string;
  textContent: string | null;
  readonly parentElement: PageElement | null;
  readonly children: ArrayLike<PageElement>;
  readonly style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  closest(selector: string): PageElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): PageElement | null;
  querySelectorAll(selector: string): ArrayLike<PageElement>;
  replaceWith(...nodes: PageElement[]): void;
  append(...nodes: Array<PageElement | string>): void;
  cloneNode(deep: true): PageElement;
  getBoundingClientRect(): PageRect;
  addEventListener(type: "click", listener: (event: PageClickEvent) => void): void;
  addEventListener(
    type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
    listener: (event: PageTouchEvent) => void,
    options: { capture: boolean; passive: boolean },
  ): void;
};

type PageTouchEvent = {
  readonly touches: ArrayLike<{ readonly clientX: number; readonly clientY: number }>;
  preventDefault(): void;
  stopPropagation(): void;
};

type PageClickEvent = { readonly target: PageElement | null; preventDefault(): void };
type PageMessageEvent = { readonly data: string };
type PageErrorEvent = { readonly message: string };
type PageRejectionEvent = { readonly reason: Error | string | null };

type PageDocument = {
  readonly documentElement: PageElement;
  readonly fonts: { load(font: string): Promise<readonly object[]> };
  getElementById(id: string): PageElement | null;
  createElement(tagName: string): PageElement;
  addEventListener(type: "message", listener: (event: PageMessageEvent) => void): void;
};

type PageWindow = {
  /** The bridge that react-native-webview installs. */
  readonly ReactNativeWebView?: { postMessage(data: string): void };
  addEventListener(type: "message", listener: (event: PageMessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: PageErrorEvent) => void): void;
  addEventListener(type: "unhandledrejection", listener: (event: PageRejectionEvent) => void): void;
};

type PageResizeObserver = { observe(target: PageElement): void };
type PageImage = { src: string; decode(): Promise<void> };
type PageCanvas = {
  width: number;
  height: number;
  getContext(type: "2d"): {
    drawImage(image: PageImage, x: number, y: number, width: number, height: number): void;
  } | null;
  toDataURL(type: "image/png"): string;
};

declare const document: PageDocument & { createElement(tagName: "canvas"): PageCanvas };
declare const window: PageWindow & { readonly devicePixelRatio: number };
declare const ResizeObserver: new (callback: () => void) => PageResizeObserver;
declare const Image: new () => PageImage;
declare const XMLSerializer: new () => { serializeToString(node: PageElement): string };

export const pageDocument: PageDocument = document;

/**
 * Draws an element, such as a diagram SVG, into a PNG data URL of `size` at the screen pixel
 * density. The element draws as an image, so it uses only its own styles.
 */
export const drawElementPng = async (
  element: PageElement,
  size: { width: number; height: number },
): Promise<string> => {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(element))}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.width * window.devicePixelRatio);
  canvas.height = Math.round(size.height * window.devicePixelRatio);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The page has no 2D canvas.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

/** Calls `onResize` when the size of `target` changes. */
export const observePageSize = (target: PageElement, onResize: () => void): void => {
  new ResizeObserver(onResize).observe(target);
};

/** The page root element from the page template. */
export const pageRoot = (): PageElement => {
  const root = document.getElementById("root");
  if (root === null) throw new Error("The isolated page template has no #root element.");
  return root;
};

export type PageChannelHandlers<Inbound> = {
  onMessage: (message: Inbound) => void;
  /** An app message or a page script failed. The text says what failed. */
  onFailure: (message: string) => void;
};

export const startPageChannel = <Inbound, Outbound>(
  channel: PageChannel<Inbound, Outbound>,
  handlers: PageChannelHandlers<Inbound>,
): ((message: Outbound) => void) => {
  const bridge = window.ReactNativeWebView;
  if (bridge === undefined) throw new Error("This page runs only inside the app.");
  const send = <Message>(schema: z.ZodType<Message>, message: Message): void => {
    bridge.postMessage(encodePageMessage(schema, message));
  };

  // iOS sends app messages to `window` and Android to `document`. One event reaches one target.
  let lastEvent: PageMessageEvent | null = null;
  const receive = (event: PageMessageEvent): void => {
    if (event === lastEvent) return;
    lastEvent = event;
    const decoded = decodePageMessage(channel.inbound, String(event.data));
    if (decoded.ok) handlers.onMessage(decoded.message);
    else handlers.onFailure(`The page cannot read an app message: ${decoded.error}`);
  };
  window.addEventListener("message", receive);
  document.addEventListener("message", receive);
  window.addEventListener("error", (event) => handlers.onFailure(event.message));
  window.addEventListener("unhandledrejection", (event) =>
    handlers.onFailure(event.reason instanceof Error ? event.reason.message : String(event.reason)),
  );

  send(pageReadyMessageSchema, { type: "page_ready" });
  return (message) => send(channel.outbound, message);
};
