import { describe, expect, mock, test } from "bun:test";
import type { LocalImageReadResult } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { BrowserToolMessage } from "./agent-chat-browser-tool";
import type { ToolMeta } from "./agent-chat-message-card-model.types";

enableReactActEnvironment();

const screenshotCall: ToolMeta = {
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "odt_browser_screenshot",
  toolType: "workflow",
  status: "completed",
  input: { tabId: "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b" },
  output: "Screenshot of the visible page. Saved to file:///tmp/shot.png.",
};

const renderCall = (localImageRead: () => Promise<LocalImageReadResult>) =>
  render(
    <QueryProvider connection={createTestClientConnection({ client: { localImageRead } })}>
      <BrowserToolMessage
        meta={screenshotCall}
        action="screenshot"
        messageTimestamp="2026-10-21T20:00:00.000Z"
        timeLabel="20:00"
      />
    </QueryProvider>,
  );

describe("BrowserToolMessage", () => {
  test("loads the saved screenshot from the host only when the user opens it", async () => {
    const localImageRead = mock(async () => ({
      mediaType: "image/png" as const,
      bytesBase64: "iVBORw0KGgo=",
    }));
    const view = renderCall(localImageRead);
    try {
      expect(localImageRead).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Screenshot" }));

      await waitFor(() => expect(localImageRead).toHaveBeenCalledWith({ path: "/tmp/shot.png" }));
      const image = await screen.findByAltText("Browser screenshot 1");
      expect(image.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    } finally {
      view.unmount();
    }
  });

  test("says why a saved screenshot could not load", async () => {
    const view = renderCall(async () => {
      throw new Error("/tmp/shot.png does not exist.");
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Screenshot" }));

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Screenshot could not be loaded: /tmp/shot.png does not exist.",
      );
    } finally {
      view.unmount();
    }
  });
});
