import { describe, expect, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { RegularToolMessage } from "./agent-chat-regular-tool-message";
import { WorkflowToolMessage } from "./agent-chat-workflow-tool-message";

enableReactActEnvironment();

const meta: ToolMeta = {
  kind: "tool",
  partId: "part",
  callId: "call",
  tool: "inspect",
  toolType: "generic",
  status: "running",
  input: { content: "first input", path: "/repo/src/file.ts" },
};
const props = {
  meta,
  messageTimestamp: "2026-09-11T12:00:00.000Z",
  timeLabel: "",
  sessionWorkingDirectory: "/repo",
  displayName: "inspect",
};

const toggle = (element: HTMLDetailsElement, open: boolean) => {
  act(() => {
    element.open = open;
    fireEvent(element, new Event("toggle"));
  });
};

describe("tool input details", () => {
  test("formats regular input only while both details are open and shows current input", () => {
    const view = render(<RegularToolMessage {...props} messageContent="Inspect data" />);
    try {
      const inputDetails = view.getByText("Input").closest("details");
      const outerDetails = view.container.querySelector("details");
      if (!inputDetails || !outerDetails) throw new Error("Expected tool details.");
      expect(view.container.querySelector("pre")).toBeNull();
      toggle(outerDetails, true);
      expect(view.container.querySelector("pre")).toBeNull();
      toggle(inputDetails, true);
      expect(view.container.querySelector("pre")?.textContent).toContain("first input");
      expect(view.container.querySelector("pre")?.textContent).toContain('"path": "src/file.ts"');
      view.rerender(
        <RegularToolMessage
          {...props}
          meta={{ ...meta, input: { content: "new input" } }}
          messageContent="Inspect data"
        />,
      );
      expect(view.container.querySelector("pre")?.textContent).toContain("new input");
      toggle(outerDetails, false);
      expect(view.container.querySelector("pre")).toBeNull();
      toggle(outerDetails, true);
      expect(view.container.querySelector("pre")?.textContent).toContain("new input");
      toggle(inputDetails, false);
      expect(view.container.querySelector("pre")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("defers workflow input and preserves it on reopen", () => {
    const view = render(<WorkflowToolMessage {...props} />);
    try {
      const inputDetails = view.getByText("Input").closest("details");
      if (!inputDetails) throw new Error("Expected input details.");
      expect(view.container.querySelector("pre")).toBeNull();
      toggle(inputDetails, true);
      expect(view.container.querySelector("pre")?.textContent).toContain("first input");
      toggle(inputDetails, false);
      expect(view.container.querySelector("pre")).toBeNull();
      toggle(inputDetails, true);
      expect(view.container.querySelector("pre")?.textContent).toContain("first input");
    } finally {
      view.unmount();
    }
  });
});
