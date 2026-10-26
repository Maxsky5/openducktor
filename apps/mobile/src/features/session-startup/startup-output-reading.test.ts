import { expect, test } from "bun:test";
import type { TerminalPageInbound } from "@/rich-content/isolated-page/terminal-page-messages";
import { createStartupOutputReading, type StartupOutputReading } from "./startup-output-reading";

test("a transferred output view preserves its reader position through replay and restore", () => {
  const reading: StartupOutputReading = {
    viewport: { row: 42, follow: false },
    text: "Earlier output",
    textOffset: 16,
  };
  const posted: TerminalPageInbound[] = [];
  const view = createStartupOutputReading({
    reading,
    post: (message) => posted.push(message),
    onText: () => {},
  });
  view.receive({ type: "terminal_viewport", row: 100, follow: true, restored: false });
  view.receive({ type: "terminal_hydrated" });
  expect(posted).toEqual([{ type: "terminal_set_viewport", row: 42, follow: false }]);
  view.receive({ type: "terminal_viewport", row: 101, follow: true, restored: false });
  expect(reading.viewport).toEqual({ row: 42, follow: false });
  view.receive({ type: "terminal_viewport", row: 40, follow: false, restored: true });
  view.receive({ type: "terminal_viewport", row: 20, follow: false, restored: false });
  expect(reading.viewport).toEqual({ row: 20, follow: false });
  const transferred = createStartupOutputReading({
    reading,
    post: (message) => posted.push(message),
    onText: () => {},
  });
  transferred.receive({ type: "terminal_hydrated" });
  expect(posted.at(-1)).toEqual({ type: "terminal_set_viewport", row: 20, follow: false });
  expect(reading.text).toBe("Earlier output");
  expect(reading.textOffset).toBe(16);
});

test("output without a prior viewport starts following after hydration and keeps requested text", () => {
  const reading: StartupOutputReading = { text: null, textOffset: 0 };
  const text: string[] = [];
  const posted: TerminalPageInbound[] = [];
  const view = createStartupOutputReading({
    reading,
    post: (message) => posted.push(message),
    onText: (message) => text.push(message),
  });
  view.receive({ type: "terminal_hydrated" });
  view.receive({ type: "terminal_viewport", row: 100, follow: true, restored: false });
  view.receive({ type: "terminal_output_text", text: "Requested snapshot" });
  expect(posted).toEqual([]);
  expect(reading.viewport).toEqual({ row: 100, follow: true });
  expect(text).toEqual(["Requested snapshot"]);
  view.reset();
  view.receive({ type: "terminal_viewport", row: 0, follow: false, restored: false });
  view.receive({ type: "terminal_hydrated" });
  expect(posted).toEqual([{ type: "terminal_set_viewport", row: 100, follow: true }]);
  expect(reading.text).toBe("Requested snapshot");
});
