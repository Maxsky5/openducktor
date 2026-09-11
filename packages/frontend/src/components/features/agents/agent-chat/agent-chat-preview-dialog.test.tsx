import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { AgentChatPreviewDialog } from "./agent-chat-preview-dialog";

enableReactActEnvironment();

const baseProps = {
  onOpenChange: () => {},
  title: "Screenshots",
  description: "Preview of the screenshots.",
};

describe("AgentChatPreviewDialog", () => {
  test("renders images and videos in order", () => {
    const view = render(
      <AgentChatPreviewDialog
        {...baseProps}
        open
        media={[
          { kind: "image", src: "data:image/png;base64,AAAA", alt: "First screenshot" },
          { kind: "video", src: "blob:video", ariaLabel: "Preview video clip" },
        ]}
      />,
    );
    try {
      const dialog = view.getByRole("dialog", { name: "Screenshots" });
      const media = dialog.querySelectorAll("img, video");
      expect(media).toHaveLength(2);
      expect(media[0]?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
      expect(media[0]?.getAttribute("alt")).toBe("First screenshot");
      expect(media[1]?.getAttribute("aria-label")).toBe("Preview video clip");
    } finally {
      view.unmount();
    }
  });

  test("replaces a failed image with the unavailable label and restores it on reopen", () => {
    const media = [
      {
        kind: "image" as const,
        src: "data:image/png;base64,AAAA",
        alt: "First screenshot",
        unavailableLabel: "Screenshot 1 is unavailable.",
      },
    ];
    const view = render(<AgentChatPreviewDialog {...baseProps} open media={media} />);
    try {
      fireEvent.error(view.getByRole("img"));
      expect(view.getByText("Screenshot 1 is unavailable.")).toBeDefined();
      expect(view.queryByRole("img")).toBeNull();
      view.rerender(<AgentChatPreviewDialog {...baseProps} open={false} media={media} />);
      view.rerender(<AgentChatPreviewDialog {...baseProps} open media={media} />);
      expect(view.getByRole("img")).toBeDefined();
    } finally {
      view.unmount();
    }
  });

  test("reports a media error to the caller without replacing the media", () => {
    const failures: string[] = [];
    const view = render(
      <AgentChatPreviewDialog
        {...baseProps}
        open
        media={[{ kind: "image", src: "data:image/png;base64,AAAA", alt: "First screenshot" }]}
        onMediaError={(media) => failures.push(media.src)}
      />,
    );
    try {
      fireEvent.error(view.getByRole("img"));
      expect(failures).toEqual(["data:image/png;base64,AAAA"]);
      expect(view.getByRole("img")).toBeDefined();
    } finally {
      view.unmount();
    }
  });
});
