import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { MediaPreviewDialog } from "./media-preview-dialog";

enableReactActEnvironment();

const baseProps = {
  onOpenChange: () => {},
  title: "Screenshots",
  description: "Preview of the screenshots.",
};

describe("MediaPreviewDialog", () => {
  test("renders images and videos in order", () => {
    const view = render(
      <MediaPreviewDialog
        {...baseProps}
        open
        media={[
          {
            id: "screenshot-1",
            kind: "image",
            src: "data:image/png;base64,AAAA",
            alt: "First screenshot",
          },
          { id: "video-1", kind: "video", src: "blob:video", ariaLabel: "Preview video clip" },
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
      const video = media[1];
      if (!(video instanceof HTMLVideoElement)) {
        throw new Error("Expected the video element.");
      }
      expect(video.muted).toBe(true);
    } finally {
      view.unmount();
    }
  });

  test("replaces a failed video with the unavailable label", () => {
    const view = render(
      <MediaPreviewDialog
        {...baseProps}
        open
        media={[
          { id: "video-1", kind: "video", src: "blob:video", ariaLabel: "Preview video clip" },
        ]}
      />,
    );
    try {
      const dialog = view.getByRole("dialog", { name: "Screenshots" });
      const video = dialog.querySelector("video");
      if (!video) throw new Error("Expected the video.");
      fireEvent.error(video);
      expect(view.getByText("Preview unavailable.")).toBeDefined();
      expect(dialog.querySelector("video")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("replaces a failed image with the unavailable label and restores it on reopen", () => {
    const media = [
      {
        id: "screenshot-1",
        kind: "image" as const,
        src: "data:image/png;base64,AAAA",
        alt: "First screenshot",
        unavailableLabel: "Screenshot 1 is unavailable.",
      },
    ];
    const view = render(<MediaPreviewDialog {...baseProps} open media={media} />);
    try {
      fireEvent.error(view.getByRole("img"));
      expect(view.getByText("Screenshot 1 is unavailable.")).toBeDefined();
      expect(view.queryByRole("img")).toBeNull();
      view.rerender(<MediaPreviewDialog {...baseProps} open={false} media={media} />);
      view.rerender(<MediaPreviewDialog {...baseProps} open media={media} />);
      expect(view.getByRole("img")).toBeDefined();
    } finally {
      view.unmount();
    }
  });

  test("reports a media error to the caller without replacing the media", () => {
    const failures: string[] = [];
    const view = render(
      <MediaPreviewDialog
        {...baseProps}
        open
        media={[
          {
            id: "screenshot-1",
            kind: "image",
            src: "data:image/png;base64,AAAA",
            alt: "First screenshot",
          },
        ]}
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

  test("renders repeated identical sources once per item", () => {
    const view = render(
      <MediaPreviewDialog
        {...baseProps}
        open
        media={[
          {
            id: "screenshot-1",
            kind: "image",
            src: "data:image/png;base64,AAAA",
            alt: "First screenshot",
          },
          {
            id: "screenshot-2",
            kind: "image",
            src: "data:image/png;base64,AAAA",
            alt: "Second screenshot",
          },
        ]}
      />,
    );
    try {
      const dialog = view.getByRole("dialog", { name: "Screenshots" });
      expect(dialog.querySelectorAll("img")).toHaveLength(2);
    } finally {
      view.unmount();
    }
  });
});
