/**
 * The terminal page. It draws one terminal with xterm.js and reports user input, consumed output,
 * the fitted grid, the selection, and link presses to the app. The app owns the terminal socket,
 * the attachment, the acknowledgements, and the recovery, so this page never talks to the host.
 *
 * Output goes through the frontend-core output sequencer: the page reports `terminal_consumed`
 * only after xterm.js parsed the bytes, and it keeps xterm.js hidden until it parsed the
 * attachment snapshot. A screen restore resets the screen at the host grid and holds input
 * until it ends, as the desktop terminal does.
 */
// Installs the built-ins that older WebViews lack, before any other page module runs.
import "./shared/page-globals";
import type { AppPlatform } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  applyTerminalKeyModifiers,
  createTerminalKeyEventHandler,
  encodeTerminalTouchKey,
  type TerminalKeyModifiers,
} from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";
import { createTerminalLinkReader } from "@openducktor/frontend-core/terminals/terminal-link-targets";
import { createTerminalOutputSequencer } from "@openducktor/frontend-core/terminals/terminal-output-sequencer";
import { restoreTerminalPrecedingJoinState } from "@openducktor/frontend-core/terminals/terminal-rep-state";
import { checkHttpUrl } from "@openducktor/frontend-core/terminals/terminal-url-policy";
import { createLiveTerminalFitScheduler } from "@openducktor/frontend-core/terminals/terminal-viewport-policy";
import { Terminal, type XtermPageElement } from "@xterm/xterm/lib/xterm.mjs";
import { decodeBase64 } from "../terminal-bytes";
import {
  MAX_TERMINAL_PAGE_TEXT_LENGTH,
  TERMINAL_PAGE_CHANNEL,
  type TerminalPageColors,
  type TerminalPageInbound,
} from "../terminal-page-messages";
import { startPageChannel } from "./shared/page-runtime";
import { installTerminalTextInput, type TerminalTextInput } from "./shared/terminal-text-input";
import { installTerminalTouchSelection } from "./shared/terminal-touch-selection";
import { installTerminalScroll } from "./shared/terminal-scroll";

// The app type check has no DOM library, so the page declares the DOM members that it reads.
type PageFontFace = { readonly family: string };
declare const document: {
  getElementById(id: string): XtermPageElement | null;
  getSelection(): { removeAllRanges(): void } | null;
  readonly fonts: { load(font: string): Promise<readonly PageFontFace[]> };
};
declare const ResizeObserver: new (callback: () => void) => {
  observe(target: XtermPageElement): void;
};
declare function requestAnimationFrame(callback: (time: number) => void): number;
declare function cancelAnimationFrame(frameId: number): void;

const FONT_FAMILY = '"IBM Plex Mono", Menlo, "Courier New", monospace';
const LINE_HEIGHT = 1.35;
const SCROLLBACK_ROWS = 2000;
// The page keeps room for the touch scrollbar beside the grid.
const SCROLL_BAR_WIDTH = 48;
const PADDING = { x: 8, y: 4 };
const MAX_GRID = { columns: 500, rows: 300 };
const NO_MODIFIERS: TerminalKeyModifiers = { ctrl: false, alt: false };

const root = document.getElementById("root");
if (root === null) throw new Error("The terminal page template has no #root element.");
const screenRoot = root;

const textDecoder = new TextDecoder();

let terminal: Terminal | null = null;
let textInput: TerminalTextInput | null = null;
let opening = false;
let platform: AppPlatform | null = null;
let heldModifiers: TerminalKeyModifiers = NO_MODIFIERS;
let pasting = false;
let restoringScreen = false;
let restoreGeneration = 0;
let heldInput: string[] = [];
let reportedSelection = false;
// The last configuration, so a change that arrives while the terminal opens still applies.
let latestConfiguration: Extract<TerminalPageInbound, { type: "terminal_configure" }> | null = null;

const post = startPageChannel(TERMINAL_PAGE_CHANNEL, {
  onMessage: (message) => receive(message),
  onFailure: (message) => reportError(message),
});

const reportError = (message: string): void => {
  post({ type: "terminal_error", message: message.slice(0, 4_000) || "The terminal failed." });
};
const failure =
  (title: string) =>
  (cause: unknown): void =>
    reportError(`${title}: ${errorMessage(cause)}`);

const sequencer = createTerminalOutputSequencer({
  write: (payload, parsed) => {
    if (terminal === null) throw new Error("The terminal is not open.");
    terminal.write(payload, parsed);
  },
  onConsumed: (sequenceEnd) => post({ type: "terminal_consumed", sequenceEnd }),
  onHydrated: () => {
    screenRoot.style.setProperty("visibility", "visible");
    post({ type: "terminal_hydrated" });
  },
});

const fit = (): void => {
  const current = terminal;
  if (current === null || restoringScreen) return;
  const screen = screenRoot.querySelector(".xterm-screen");
  if (screen === null) return;
  // The xterm.js screen is exactly the grid, so it gives the size of one cell.
  const screenRect = screen.getBoundingClientRect();
  const cellWidth = screenRect.width / current.cols;
  const cellHeight = screenRect.height / current.rows;
  if (!(cellWidth > 0 && cellHeight > 0)) return;
  const rect = screenRoot.getBoundingClientRect();
  const width = rect.width - PADDING.x * 2 - SCROLL_BAR_WIDTH;
  const height = rect.height - PADDING.y * 2;
  // A collapsed page would give the 2 by 1 minimum grid, which can erase screen output.
  if (width <= 0 || height <= 0) return;
  const columns = Math.min(MAX_GRID.columns, Math.floor(width / cellWidth));
  const rows = Math.min(MAX_GRID.rows, Math.floor(height / cellHeight));
  if (columns <= 2 || rows <= 1) return;
  if (columns !== current.cols || rows !== current.rows) current.resize(columns, rows);
};
const fitScheduler = createLiveTerminalFitScheduler({
  fit,
  isActive: () => terminal !== null,
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (frameId) => cancelAnimationFrame(frameId),
});

/** Sends input in order. Input that arrives during a screen restore waits until it ends. */
const sendInput = (data: string): void => {
  if (data.length === 0) return;
  if (restoringScreen) {
    heldInput.push(data);
    return;
  }
  fitScheduler.flush();
  for (let start = 0; start < data.length; start += MAX_TERMINAL_PAGE_TEXT_LENGTH) {
    post({
      type: "terminal_input",
      data: data.slice(start, start + MAX_TERMINAL_PAGE_TEXT_LENGTH),
    });
  }
};
const releaseHeldInput = (): void => {
  const input = heldInput;
  heldInput = [];
  for (const data of input) sendInput(data);
};

/** Reports only the start and the end of a selection, so a drag does not render the app. */
const reportSelection = (): void => {
  const hasSelection = terminal?.hasSelection() ?? false;
  if (hasSelection === reportedSelection) return;
  reportedSelection = hasSelection;
  post({ type: "terminal_selection", hasSelection });
};
const copySelection = (text: string): void => {
  if (text.length > 0)
    post({ type: "terminal_copy", text: text.slice(0, MAX_TERMINAL_PAGE_TEXT_LENGTH) });
};

const themeOf = (colors: TerminalPageColors) => ({
  background: colors.background,
  foreground: colors.foreground,
  cursor: colors.cursor,
  cursorAccent: colors.cursorAccent,
  selectionBackground: colors.selection,
  selectionInactiveBackground: colors.selection,
});

const setInputEnabled = (current: Terminal, enabled: boolean): void => {
  current.options.disableStdin = !enabled;
  current.options.cursorBlink = enabled;
};

const openTerminal = async (message: ConfigureMessage): Promise<void> => {
  opening = true;
  // xterm.js measures its cells when it opens, so the embedded font must load first.
  await document.fonts.load(`${message.fontSize}px "IBM Plex Mono"`);
  const created = new Terminal({
    allowTransparency: false,
    convertEol: false,
    cursorBlink: message.inputEnabled,
    disableStdin: !message.inputEnabled,
    fontFamily: FONT_FAMILY,
    fontSize: message.fontSize,
    lineHeight: LINE_HEIGHT,
    scrollback: SCROLLBACK_ROWS,
    screenReaderMode: message.screenReaderMode ?? true,
    theme: themeOf(message.colors),
    linkHandler: {
      allowNonHttpProtocols: false,
      activate: (_event, url) => {
        if (checkHttpUrl(url) !== null) post({ type: "link", url });
      },
    },
  });
  created.open(screenRoot);
  terminal = created;
  opening = false;
  if (latestConfiguration !== null) applyConfiguration(created, latestConfiguration);
  installLinks(created);
  installTerminalScroll(created, screenRoot);
  installTerminalTouchSelection(created);
  created.onData((data) => {
    if (pasting || (!heldModifiers.ctrl && !heldModifiers.alt)) {
      sendInput(data);
      return;
    }
    const modified = applyTerminalKeyModifiers(data, heldModifiers);
    heldModifiers = NO_MODIFIERS;
    post({ type: "terminal_modifiers_consumed" });
    sendInput(modified);
  });
  created.onResize(({ cols, rows }) => {
    if (!restoringScreen) post({ type: "terminal_resize", columns: cols, rows });
  });
  created.onSelectionChange(reportSelection);
  let lastViewport: { row: number; follow: boolean } | null = null;
  created.onScroll((row) => {
    if (!latestConfiguration?.trackViewport) return;
    const follow = row === created.buffer.active.baseY;
    if (
      (lastViewport?.follow && follow) ||
      (lastViewport?.row === row && lastViewport.follow === follow)
    )
      return;
    lastViewport = { row, follow };
    post({ type: "terminal_viewport", row, follow, restored: false });
  });
  // The page has no clipboard access. OSC 52 clipboard writes from programs stay ignored.
  created.parser.registerOscHandler(52, () => true);
  textInput = installTerminalTextInput(
    created,
    createTerminalKeyEventHandler({
      getPlatform: () => platform ?? undefined,
      hasSelection: () => created.hasSelection(),
      getSelection: () => created.getSelection(),
      writeClipboard: async (text) => copySelection(text),
      enqueueInput: async (operation) => sendInput(textDecoder.decode(await operation())),
      reportFailure: failure("Clipboard action failed"),
    }),
  );
  fit();
  new ResizeObserver(() => fitScheduler.schedule()).observe(screenRoot);
  post({ type: "terminal_ready", columns: created.cols, rows: created.rows });
};

/** Plain HTTP links in the output, also links that wrap to the next row. */
const installLinks = (current: Terminal): void => {
  const reader = createTerminalLinkReader(current);
  current.registerLinkProvider({
    provideLinks: (row, callback) => {
      const links = reader.linksAtRow(row).map((target) => ({
        text: target.url,
        range: target.range,
        decorations: { pointerCursor: false, underline: true },
        activate: () => post({ type: "link", url: target.url }),
      }));
      callback(links.length > 0 ? links : undefined);
    },
  });
  current.onWriteParsed(reader.clear);
  current.onResize(reader.clear);
  current.onScroll(reader.clear);
  current.buffer.onBufferChange(reader.clear);
};

const restore = (
  current: Terminal,
  message: Extract<TerminalPageInbound, { type: "terminal_restore" }>,
): void => {
  const generation = ++restoreGeneration;
  restoringScreen = true;
  void sequencer
    .restore(
      message.sequenceEnd,
      decodeBase64(message.bytes),
      () => {
        current.reset();
        current.resize(message.columns, message.rows);
      },
      (completed) => {
        if (generation !== restoreGeneration) return;
        restoringScreen = false;
        try {
          if (completed) restoreTerminalPrecedingJoinState(current, message.precedingJoinState);
          fit();
        } finally {
          releaseHeldInput();
        }
      },
    )
    .catch(failure("Terminal output failed"));
};

type ConfigureMessage = Extract<TerminalPageInbound, { type: "terminal_configure" }>;

const applyConfiguration = (current: Terminal, message: ConfigureMessage): void => {
  current.options.theme = themeOf(message.colors);
  current.options.screenReaderMode = message.screenReaderMode ?? true;
  screenRoot.style.setProperty("--terminal-selection-handle", message.colors.foreground);
  setInputEnabled(current, message.inputEnabled);
  if (current.options.fontSize !== message.fontSize) {
    current.options.fontSize = message.fontSize;
    fitScheduler.schedule();
  }
};

function receive(message: TerminalPageInbound): void {
  if (message.type === "terminal_configure") {
    platform = message.platform;
    latestConfiguration = message;
    const current = terminal;
    if (current !== null) applyConfiguration(current, message);
    else if (!opening) void openTerminal(message).catch(failure("The terminal did not open"));
    return;
  }
  if (message.type === "terminal_modifiers") {
    // The app sends the held keys with its first configuration, before the terminal opens.
    heldModifiers = { ctrl: message.ctrl, alt: message.alt };
    return;
  }
  const current = terminal;
  if (current === null) return;
  switch (message.type) {
    case "terminal_output":
      for (const chunk of message.chunks) {
        void sequencer
          .enqueue(chunk, decodeBase64(chunk.bytes))
          .catch(failure("Terminal output failed"));
      }
      return;
    case "terminal_snapshot":
      sequencer.setSnapshotBoundary(message.sequenceEnd);
      return;
    case "terminal_restore":
      restore(current, message);
      return;
    case "terminal_key":
      if (current.options.disableStdin) return;
      sendInput(
        textDecoder.decode(
          encodeTerminalTouchKey(
            message.key,
            { ctrl: message.ctrl, alt: message.alt },
            platform,
            current.modes.applicationCursorKeysMode,
          ),
        ),
      );
      return;
    case "terminal_paste":
      // xterm.js adds bracketed paste marks when the program asks for them.
      pasting = true;
      try {
        current.paste(message.text);
      } finally {
        pasting = false;
      }
      textInput?.fieldReplaced();
      return;
    case "terminal_select_all":
      current.selectAll();
      return;
    case "terminal_clear_selection":
      current.clearSelection();
      document.getSelection()?.removeAllRanges();
      return;
    case "terminal_copy_selection":
      copySelection(current.getSelection());
      // The copy ends the selection, as Copy in a selection menu does. A screen reader selection of
      // the page text ends too, so no highlight stays on a screen row that new output reuses.
      current.clearSelection();
      document.getSelection()?.removeAllRanges();
      return;
    case "terminal_read_output": {
      const buffer = current.buffer.active;
      const lines: string[] = [];
      for (let row = 0; row < buffer.length; row++)
        lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
      post({
        type: "terminal_output_text",
        text: lines.join("\n").slice(-MAX_TERMINAL_PAGE_TEXT_LENGTH),
      });
      return;
    }
    case "terminal_set_viewport": {
      if (message.follow) current.scrollToBottom();
      else current.scrollToLine(message.row);
      const { viewportY, baseY } = current.buffer.active;
      post({
        type: "terminal_viewport",
        row: viewportY,
        follow: viewportY === baseY,
        restored: true,
      });
      return;
    }
    case "terminal_focus":
      if (current.textarea) current.textarea.inputMode = "text";
      current.focus();
      return;
    case "terminal_blur":
      if (current.textarea) current.textarea.inputMode = "none";
      current.blur();
      return;
  }
}
