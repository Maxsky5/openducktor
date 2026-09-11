import { describe, expect, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { ComputerUseToolMessage } from "./agent-chat-computer-use";

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
          computerUse: {
            action: "Inspect the task plan editor",
            code: "await tab.click()",
          },
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
      expect(view.container.querySelector(".lucide-mouse-pointer-click")).not.toBeNull();
      expect(view.container.querySelector("pre")).toBeNull();
      expect(view.container.querySelector("img")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("keeps the failure out of the collapsed summary and shows the full error in the details", () => {
    const manual = "Script error: boom\n\nComputer Use API manual line 1\nline 2";
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({
          status: "error",
          error: manual,
          computerUse: { action: "Click the button" },
        })}
      />,
    );
    try {
      const collapsedText = view.container.textContent ?? "";
      expect(collapsedText).toContain("Click the button");
      expect(collapsedText).not.toContain("boom");
      expect(collapsedText).not.toContain("Computer Use API manual");
      const details = view.container.querySelector("details");
      if (!details) throw new Error("Expected computer use details.");
      expect(details.open).toBe(false);
      toggle(details, true);
      expect(view.getByText("Error")).toBeDefined();
      const errorBlock = view.getByText("Error").closest("div");
      expect(errorBlock?.querySelector("pre")?.textContent).toBe(manual);
    } finally {
      view.unmount();
    }
  });

  test("keeps an oversized failure out of the collapsed summary", () => {
    const manual = `Computer Use API manual ${"step ".repeat(100_000)}`;
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({
          status: "error",
          error: manual,
          computerUse: { action: "Click the button" },
        })}
      />,
    );
    try {
      const details = view.container.querySelector("details");
      if (!details) throw new Error("Expected computer use details.");
      expect(details.open).toBe(false);
      const collapsedText = view.container.textContent ?? "";
      expect(collapsedText).not.toContain("Computer Use API manual");
      expect(collapsedText.length).toBeLessThan(1_000);
      toggle(details, true);
      const errorBlock = view.getByText("Error").closest("div");
      expect(errorBlock?.querySelector("pre")?.textContent).toBe(manual);
    } finally {
      view.unmount();
    }
  });

  test("marks a failed call with the destructive surface and no inline error", () => {
    const view = render(
      <ComputerUseToolMessage {...baseProps} meta={toolMeta({ status: "error", error: "boom" })} />,
    );
    try {
      const card = view.container.firstElementChild;
      expect(card?.className).toContain("border-destructive-border");
      expect(view.container.textContent).not.toContain("boom");
    } finally {
      view.unmount();
    }
  });

  test("shows an expansion cue only while the call has details", () => {
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({ computerUse: { action: "Click", code: "1 + 1" } })}
      />,
    );
    try {
      const summary = view.container.querySelector("summary");
      if (!summary) throw new Error("Expected computer use summary.");
      const chevron = summary.querySelector(".lucide-chevron-down");
      expect(chevron).not.toBeNull();
      expect(chevron?.getAttribute("class")).not.toContain("rotate-180");
      const details = view.container.querySelector("details");
      if (!details) throw new Error("Expected computer use details.");
      toggle(details, true);
      expect(chevron?.getAttribute("class")).toContain("rotate-180");
      view.rerender(
        <ComputerUseToolMessage
          {...baseProps}
          meta={toolMeta({ computerUse: { action: "Click" } })}
        />,
      );
      expect(view.container.querySelector("summary")).toBeNull();
      expect(view.container.querySelector(".lucide-chevron-down")).toBeNull();
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
          computerUse: { action: "Submit the form", code },
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
          output: "setup complete",
          computerUse: { action: "Reset computer session" },
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

  test("shows a screenshot chip and opens the preview in order", async () => {
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({
          computerUse: {
            action: "Capture the page",
            images: [
              { mimeType: "image/png", dataBase64: "AAAA" },
              { mimeType: "image/jpeg", dataBase64: "BBBB" },
            ],
          },
        })}
      />,
    );
    try {
      expect(view.container.querySelector("img")).toBeNull();
      expect(view.queryByRole("dialog")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Screenshots (2)" }));
      const dialog = await view.findByRole("dialog", { name: "Computer Use screenshots" });
      const images = dialog.querySelectorAll("img");
      expect(images).toHaveLength(2);
      expect(images[0]?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
      expect(images[1]?.getAttribute("src")).toBe("data:image/jpeg;base64,BBBB");
    } finally {
      view.unmount();
    }
  });

  test("shows a single screenshot chip and replaces an unavailable image", async () => {
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({
          computerUse: {
            action: "Capture the page",
            images: [{ mimeType: "image/png", dataBase64: "AAAA" }],
          },
        })}
      />,
    );
    try {
      fireEvent.click(view.getByRole("button", { name: "Screenshot" }));
      const dialog = await view.findByRole("dialog", { name: "Computer Use screenshot" });
      const image = dialog.querySelector("img");
      if (!image) throw new Error("Expected the screenshot.");
      fireEvent.error(image);
      expect(view.getByText("Screenshot 1 is unavailable.")).toBeDefined();
      expect(view.queryByRole("img")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("renders no details disclosure without expandable content", () => {
    const view = render(
      <ComputerUseToolMessage
        {...baseProps}
        meta={toolMeta({ computerUse: { action: "Click" } })}
      />,
    );
    try {
      expect(view.container.querySelector("details")).toBeNull();
    } finally {
      view.unmount();
    }
  });
});
