import { describe, expect, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { ComputerUseToolMessage } from "./agent-chat-computer-use";
import { codexTruncatedResultPreview } from "./computer-use-tool.test-fixtures";

enableReactActEnvironment();

const toolMeta = (overrides: Partial<ToolMeta>): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "cua_repl.js",
  toolType: "computer_use",
  status: "completed",
  ...overrides,
});

const baseProps = {
  messageTimestamp: "2026-09-11T12:00:00.000Z",
  timeLabel: "12:00",
};

const toggle = (element: HTMLDetailsElement, open: boolean) => {
  act(() => {
    element.open = open;
    fireEvent(element, new Event("toggle"));
  });
};

describe("ComputerUseToolMessage", () => {
  test("shows the label, action title, duration, and time in the collapsed summary", () => {
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({
          input: { code: "await tab.click()", title: "Inspect   the task plan editor" },
          output: "done",
          startedAtMs: 1_000,
          endedAtMs: 2_500,
        })}
      />,
    );
    try {
      expect(view.getByText("Computer Use")).toBeDefined();
      expect(view.getByText("Inspect the task plan editor")).toBeDefined();
      expect(view.getByText("1.5s")).toBeDefined();
      expect(view.getByText("12:00")).toBeDefined();
      expect(view.container.querySelector("pre")).toBeNull();
      expect(view.container.querySelector("img")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows a short failure message and keeps the full error in the details", () => {
    const manual = "Script error: boom\n\nComputer Use API manual line 1\nline 2";
    const view = render(
      <ComputerUseToolMessage {...baseProps} meta={toolMeta({ status: "error", error: manual })} />,
    );
    try {
      expect(view.getByText("boom")).toBeDefined();
      expect(view.queryByText(manual)).toBeNull();
      const details = view.container.querySelector("details");
      if (!details) throw new Error("Expected computer use details.");
      toggle(details, true);
      expect(view.getByText("Error")).toBeDefined();
      const errorBlock = view.getByText("Error").closest("div");
      expect(errorBlock?.querySelector("pre")?.textContent).toBe(manual);
    } finally {
      view.unmount();
    }
  });

  test("keeps an oversized Codex-truncated failure out of the collapsed summary", () => {
    const preview = codexTruncatedResultPreview(
      `Script error: TypeError: element not found\n\nComputer Use API manual\n${"step: inspect the app state\n".repeat(30_000)}`,
    );
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({ status: "error", error: preview })}
      />,
    );
    try {
      const details = view.container.querySelector("details");
      if (!details) throw new Error("Expected computer use details.");
      expect(details.open).toBe(false);
      const collapsedText = view.container.textContent ?? "";
      expect(collapsedText).toContain("TypeError: element not found");
      expect(collapsedText).not.toContain("Computer Use API manual");
      expect(collapsedText.length).toBeLessThan(1_000);
      toggle(details, true);
      const errorBlock = view.getByText("Error").closest("div");
      expect(errorBlock?.querySelector("pre")?.textContent).toBe(preview);
    } finally {
      view.unmount();
    }
  });

  test("renders JavaScript code and output without the raw input object", () => {
    const code = "await tab.click('#submit')";
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({
          input: { code, title: "Submit the form" },
          output: "clicked",
        })}
      />,
    );
    try {
      const details = view.container.querySelector("details");
      if (!details) throw new Error("Expected computer use details.");
      toggle(details, true);
      expect(view.getByText("JavaScript")).toBeDefined();
      expect(view.getByText(code)).toBeDefined();
      expect(view.getByText("Output")).toBeDefined();
      expect(view.getByText("clicked")).toBeDefined();
      expect(view.container.textContent).not.toContain('"title"');
    } finally {
      view.unmount();
    }
  });

  test("hides the JavaScript section for js_reset calls", () => {
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({
          tool: "cua_repl.js_reset",
          input: { code: "await tab.click()" },
          output: "setup complete",
        })}
      />,
    );
    try {
      expect(view.getByText("Reset computer session")).toBeDefined();
      const details = view.container.querySelector("details");
      if (!details) throw new Error("Expected computer use details.");
      toggle(details, true);
      expect(view.queryByText("JavaScript")).toBeNull();
      expect(view.getByText("setup complete")).toBeDefined();
    } finally {
      view.unmount();
    }
  });

  test("renders screenshots in order and replaces a failed image", () => {
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({
          images: [
            { mimeType: "image/png", dataBase64: "AAAA" },
            { mimeType: "image/jpeg", dataBase64: "BBBB" },
          ],
        })}
      />,
    );
    try {
      expect(view.container.querySelector("img")).toBeNull();
      const details = view.container.querySelector("details");
      if (!details) throw new Error("Expected computer use details.");
      toggle(details, true);
      const images = view.container.querySelectorAll("img");
      expect(images).toHaveLength(2);
      expect(images[0]?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
      expect(images[1]?.getAttribute("src")).toBe("data:image/jpeg;base64,BBBB");
      const firstImage = images[0];
      if (!firstImage) throw new Error("Expected the first screenshot.");
      fireEvent.error(firstImage);
      expect(view.getByText("Screenshot 1 is unavailable.")).toBeDefined();
      expect(view.container.querySelectorAll("img")).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  test("renders no details disclosure without expandable content", () => {
    const view = render(
      <ComputerUseToolMessage {...baseProps} meta={toolMeta({ input: { title: "Click" } })} />,
    );
    try {
      expect(view.container.querySelector("details")).toBeNull();
    } finally {
      view.unmount();
    }
  });
});
