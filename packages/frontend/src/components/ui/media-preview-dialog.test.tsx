import { describe, expect, spyOn, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Activity, type ReactElement } from "react";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { MediaPreviewDialog } from "./media-preview-dialog";

enableReactActEnvironment();

const baseProps = {
  onOpenChange: () => {},
  title: "Screenshots",
  description: "Preview of the screenshots.",
};

function renderDuringExitAnimation(element: ReactElement) {
  const nativeGetComputedStyle = globalThis.getComputedStyle;
  const animation = spyOn(globalThis, "getComputedStyle").mockImplementation((element) => {
    const style = nativeGetComputedStyle(element);
    const slot = element.getAttribute("data-slot");
    if (slot !== "dialog-content" && slot !== "dialog-positioner") return style;
    // Happy DOM styles do not stay live when Radix changes data-state.
    return Object.create(style, {
      animationName: {
        get: () => (element.getAttribute("data-state") === "open" ? "modal-open" : "modal-close"),
      },
      getPropertyValue: { value: style.getPropertyValue.bind(style) },
    });
  });
  try {
    return render(element);
  } finally {
    // Radix retains the style object. Other tests must see the real global before any await.
    animation.mockRestore();
  }
}

describe("MediaPreviewDialog", () => {
  test.each(["blob:ready", "data:image/png;base64,AAAA"])(
    "shows prepared media immediately for %s",
    (src) => {
      const view = render(
        <MediaPreviewDialog
          {...baseProps}
          open
          media={[{ id: "ready", kind: "image", src, alt: "Ready image" }]}
          actions={<button type="button">Copy image</button>}
        />,
      );
      try {
        expect(view.getByRole("dialog").hasAttribute("aria-busy")).toBe(false);
        expect(view.getByRole("img", { name: "Ready image" })).toBeDefined();
        const action = view.getByRole("button", { name: "Copy image" });
        expect(action.closest('[data-slot="dialog-footer"]')).not.toBeNull();
        expect(action.parentElement?.className).toContain("justify-end");
      } finally {
        view.unmount();
      }
    },
  );

  test("waits for every preview to load or fail and keeps a fast loader for 500 ms", async () => {
    const startedAt = performance.now();
    const view = render(
      <MediaPreviewDialog
        {...baseProps}
        open
        media={[
          { id: "first", kind: "image", src: "https://example.invalid/first.png", alt: "First" },
          { id: "second", kind: "image", src: "https://example.invalid/second.png", alt: "Second" },
        ]}
      />,
    );
    try {
      expect(view.queryAllByRole("img").length).toBe(0);
      const [first, second] = view.getByRole("dialog").querySelectorAll("img");
      if (!first || !second) throw new Error("Expected two pending images.");
      fireEvent.load(first);
      expect(view.queryAllByRole("img").length).toBe(0);
      fireEvent.error(second);
      expect(view.queryAllByRole("img").length).toBe(0);
      await view.findByRole("img", { name: "First" });
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(500);
      expect(view.getByRole("img", { name: "First" })).toBeDefined();
      expect(view.getByRole("alert").textContent).toBe("Preview unavailable.");
    } finally {
      view.unmount();
    }
  });
  test("hides the portal, pauses a retained video, and restores its ready preview", async () => {
    const media = [
      { id: "video", kind: "video" as const, src: "blob:video", ariaLabel: "Preview video" },
    ];
    const dialog = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <MediaPreviewDialog {...baseProps} open media={media} />
      </Activity>
    );
    const view = render(dialog("visible"));
    const video = view.getByRole("dialog").querySelector("video");
    if (!video) throw new Error("Expected the video.");
    const pause = spyOn(video, "pause").mockImplementation(() => {});
    try {
      fireEvent.loadedData(video);
      await waitFor(() => expect(view.queryByRole("status") === null).toBe(true));
      view.rerender(dialog("hidden"));
      expect(view.queryByRole("dialog")).toBeNull();
      expect(pause).toHaveBeenCalledTimes(1);
      view.rerender(dialog("visible"));
      expect(view.getByRole("dialog").querySelector("video")).toBe(video);
      expect(view.queryByRole("status") === null).toBe(true);
      expect(view.getByRole("heading", { name: "Screenshots" })).toBeDefined();
    } finally {
      view.unmount();
      pause.mockRestore();
    }
  });

  test.each(["Activity", "close animation"])(
    "keeps a loaded image usable after %s",
    async (retention) => {
      const media = [
        { id: "image", kind: "image" as const, src: "blob:retained", alt: "Retained image" },
      ];
      const dialog = (open: boolean, mode: "visible" | "hidden" = "visible") => (
        <Activity mode={mode}>
          <MediaPreviewDialog
            {...baseProps}
            open={open}
            media={media}
            actions={<button type="button">Copy image</button>}
          />
        </Activity>
      );
      const view =
        retention === "close animation"
          ? renderDuringExitAnimation(dialog(true))
          : render(dialog(true));
      try {
        const image = view.getByRole("dialog").querySelector("img");
        if (!image) throw new Error("Expected a pending image.");
        fireEvent.load(image);
        await view.findByRole("button", { name: "Copy image" });
        view.rerender(retention === "Activity" ? dialog(true, "hidden") : dialog(false));
        view.rerender(dialog(true));
        expect(view.getByRole("dialog").querySelector("img") === image).toBe(true);
        expect(view.queryByRole("status") === null).toBe(true);
        expect(view.getByRole("img", { name: "Retained image" })).toBeDefined();
        expect(view.getByRole("button", { name: "Copy image" })).toBeDefined();
      } finally {
        view.unmount();
      }
    },
  );

  // Each case completes two 500 ms loading intervals.
  test.each(["new node", "new source"])(
    "waits for media again after a %s",
    async (change) => {
      const dialog = (open: boolean, src = "https://example.invalid/first.png") => (
        <MediaPreviewDialog
          {...baseProps}
          open={open}
          media={[{ id: "image", kind: "image", src, alt: "Current image" }]}
        />
      );
      const view = render(dialog(true));
      try {
        const first = view.getByRole("dialog").querySelector("img");
        if (!first) throw new Error("Expected a pending image.");
        fireEvent.load(first);
        await view.findByRole("img", { name: "Current image" });
        if (change === "new node") {
          view.rerender(dialog(false));
          view.rerender(dialog(true));
        } else {
          view.rerender(dialog(true, "https://example.invalid/second.png"));
        }
        const current = view.getByRole("dialog").querySelector("img");
        if (!current) throw new Error("Expected the current image.");
        expect(current === first).toBe(change === "new source");
        expect(view.getByRole("status")).toBeDefined();
        expect(view.queryByRole("img")).toBeNull();
        fireEvent.load(current);
        await view.findByRole("img", { name: "Current image" });
      } finally {
        view.unmount();
      }
    },
    2_000,
  );

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
      fireEvent.error(view.getByRole("img", { hidden: true }));
      expect(view.getByText("Screenshot 1 is unavailable.")).toBeDefined();
      expect(view.queryByRole("img")).toBeNull();
      view.rerender(<MediaPreviewDialog {...baseProps} open={false} media={media} />);
      view.rerender(<MediaPreviewDialog {...baseProps} open media={media} />);
      expect(view.getByRole("img", { hidden: true })).toBeDefined();
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
      fireEvent.error(view.getByRole("img", { hidden: true }));
      expect(failures).toEqual(["data:image/png;base64,AAAA"]);
      expect(view.getByRole("img", { hidden: true })).toBeDefined();
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
