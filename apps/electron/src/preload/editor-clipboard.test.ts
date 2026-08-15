import { describe, expect, mock, test } from "bun:test";
import { PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE } from "../shared/electron-bridge-contract";
import { readEditorClipboardText } from "./editor-clipboard";

describe("readEditorClipboardText", () => {
  test("reads plain text and Pierre multi-selection data", () => {
    const read = mock((format: string) => `typed:${format}`);
    const readText = mock(() => "plain");
    const clipboard = { read, readText };

    expect(readEditorClipboardText(clipboard)).toBe("plain");
    expect(readEditorClipboardText(clipboard, PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE)).toBe(
      `typed:${PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE}`,
    );
  });

  test("rejects any other renderer-supplied format", () => {
    const read = mock(() => "not read");
    const clipboard = { read, readText: mock(() => "plain") };

    expect(() => readEditorClipboardText(clipboard, "text/html" as never)).toThrow(
      "Unsupported editor clipboard format.",
    );
    expect(read).not.toHaveBeenCalled();
  });
});
