/**
 * The part of the xterm.js 6.0.0 API that the terminal page uses. The package typings reference
 * the DOM library, which conflicts with the React Native globals of the app type check, so the
 * page imports the xterm.js module file through this declaration instead.
 */
declare module "@xterm/xterm/lib/xterm.mjs" {
  export type XtermDisposable = { dispose(): void };
  export type XtermEvent<Value> = (listener: (value: Value) => void) => XtermDisposable;

  export type XtermRect = {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  export type XtermTouch = { readonly clientX: number; readonly clientY: number };
  export type XtermTouchEvent = {
    readonly touches: ArrayLike<XtermTouch>;
    preventDefault(): void;
    stopPropagation(): void;
  };
  /** The page DOM element members that the page reads. */
  export type XtermPageElement = {
    readonly style: { setProperty(name: string, value: string): void };
    getBoundingClientRect(): XtermRect;
    querySelector(selector: string): XtermPageElement | null;
    addEventListener(
      type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
      listener: (event: XtermTouchEvent) => void,
      options: { capture: boolean; passive: boolean },
    ): void;
    addEventListener(
      type: "compositionstart" | "compositionupdate" | "compositionend" | "contextmenu",
      listener: (event: { preventDefault(): void; stopPropagation(): void }) => void,
      options: { capture: boolean },
    ): void;
  };
  /** The hidden text field that takes keyboard and input method text. */
  export type XtermTextArea = {
    value: string;
    addEventListener(
      type: "input",
      listener: (event: { readonly inputType: string }) => void,
    ): void;
    addEventListener(type: "focus" | "select", listener: () => void): void;
  };
  export type XtermKeyboardEvent = {
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly isComposing: boolean;
    readonly key: string;
    readonly keyCode: number;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
    readonly type: string;
  };

  export type XtermCellPosition = { x: number; y: number };
  export type XtermCellRange = { start: XtermCellPosition; end: XtermCellPosition };
  export type XtermBufferCell = { getChars(): string; getCode(): number; getWidth(): number };
  export type XtermBufferLine = {
    readonly isWrapped: boolean;
    readonly length: number;
    getCell(column: number): XtermBufferCell | undefined;
    translateToString(trimRight?: boolean): string;
  };
  export type XtermBuffer = {
    readonly baseY: number;
    readonly viewportY: number;
    readonly length: number;
    getLine(row: number): XtermBufferLine | undefined;
  };
  export type XtermLink = {
    text: string;
    range: XtermCellRange;
    decorations?: { pointerCursor: boolean; underline: boolean };
    activate(event: XtermTouchEvent, text: string): void;
  };
  export type XtermTheme = {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    selectionInactiveBackground: string;
  };
  export type XtermOptions = {
    allowTransparency?: boolean;
    convertEol?: boolean;
    cursorBlink?: boolean;
    disableStdin?: boolean;
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    scrollback?: number;
    screenReaderMode?: boolean;
    theme?: XtermTheme;
    linkHandler?: {
      allowNonHttpProtocols: boolean;
      activate(event: XtermTouchEvent, text: string, range: XtermCellRange): void;
    };
  };

  export class Terminal {
    scrollToBottom(): void;
    scrollToLine(line: number): void;
    constructor(options: XtermOptions);
    readonly cols: number;
    readonly rows: number;
    readonly element: XtermPageElement | undefined;
    readonly textarea: XtermTextArea | undefined;
    readonly modes: { readonly applicationCursorKeysMode: boolean };
    readonly buffer: {
      readonly active: XtermBuffer;
      readonly onBufferChange: XtermEvent<XtermBuffer>;
    };
    readonly parser: {
      registerOscHandler(identifier: number, callback: (data: string) => boolean): XtermDisposable;
    };
    options: XtermOptions;
    readonly onData: XtermEvent<string>;
    readonly onResize: XtermEvent<{ cols: number; rows: number }>;
    readonly onScroll: XtermEvent<number>;
    readonly onSelectionChange: XtermEvent<void>;
    readonly onWriteParsed: XtermEvent<void>;
    open(parent: XtermPageElement): void;
    write(data: Uint8Array, callback: () => void): void;
    resize(columns: number, rows: number): void;
    reset(): void;
    focus(): void;
    blur(): void;
    paste(data: string): void;
    input(data: string, wasUserInput?: boolean): void;
    hasSelection(): boolean;
    getSelection(): string;
    getSelectionPosition(): XtermCellRange | undefined;
    select(column: number, row: number, length: number): void;
    selectAll(): void;
    scrollLines(amount: number): void;
    clearSelection(): void;
    attachCustomKeyEventHandler(handler: (event: XtermKeyboardEvent) => boolean): void;
    registerLinkProvider(provider: {
      provideLinks(row: number, callback: (links: XtermLink[] | undefined) => void): void;
    }): XtermDisposable;
  }
}
