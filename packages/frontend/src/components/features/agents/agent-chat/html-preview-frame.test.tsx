import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { Profiler, createElement } from "react";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { readHtmlPreviewPlaceholderHeight } from "./html-preview-cache";
import { HtmlPreviewFrame } from "./html-preview-frame";

enableReactActEnvironment();

type FakeMessage = {
  type: string;
  generation?: string;
  html?: string;
  height?: number;
  css?: string;
  surface?: { appearance: string; background: string };
};

type FakePort = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: (message: FakeMessage) => void;
  close: () => void;
  posted: FakeMessage[];
};

type FakeChannel = {
  port1: FakePort;
  port2: FakePort;
};

declare global {
  interface Window {
    happyDOM?: {
      settings: {
        enableIframePageLoading: boolean;
        disableIframePageLoading: boolean;
      };
    };
  }
}

const createPort = (): FakePort => {
  const posted: FakeMessage[] = [];
  return {
    onmessage: null,
    onmessageerror: null,
    postMessage: (message) => {
      posted.push(message);
    },
    close: () => undefined,
    posted,
  };
};

const originalMessageChannel = globalThis.MessageChannel;

afterEach(() => {
  Object.defineProperty(globalThis, "MessageChannel", {
    configurable: true,
    writable: true,
    value: originalMessageChannel,
  });
});

const installTestMessageChannel = () => {
  const channels: FakeChannel[] = [];
  class TestMessageChannel {
    readonly port1 = createPort();
    readonly port2 = createPort();
    constructor() {
      channels.push(this);
    }
  }
  Object.defineProperty(globalThis, "MessageChannel", {
    configurable: true,
    writable: true,
    value: TestMessageChannel,
  });
  return channels;
};

const enableIframeLoading = () => {
  const settings = window.happyDOM?.settings;
  const previous = settings
    ? { enable: settings.enableIframePageLoading, disable: settings.disableIframePageLoading }
    : null;
  if (settings) {
    settings.enableIframePageLoading = true;
    settings.disableIframePageLoading = false;
  }
  return () => {
    if (settings && previous) {
      settings.enableIframePageLoading = previous.enable;
      settings.disableIframePageLoading = previous.disable;
    }
  };
};

describe("HtmlPreviewFrame", () => {
  test("updates height without extra renders, resets on uncached key, and pushes live theme surface", async () => {
    const channels = installTestMessageChannel();
    const restoreIframe = enableIframeLoading();

    const posted: Array<{ message: FakeMessage }> = [];
    const contentWindow = {
      postMessage: (message: FakeMessage) => {
        posted.push({ message });
      },
    };
    let commits = 0;
    const baseProps = {
      html: "<p>Hello</p>",
      name: "Test preview",
      bootstrapUrl: "about:blank",
      failureMessage: "Preview failed",
      fitContent: true,
      contentKey: "preview-remount-key",
      themeCss: ":root{color-scheme:dark}",
      bootstrapSurface: { appearance: "dark" as const, background: "rgb(11, 11, 15)" },
    };
    const view = render(
      createElement(
        Profiler,
        {
          id: "html-frame",
          onRender: () => {
            commits += 1;
          },
        },
        createElement(HtmlPreviewFrame, baseProps),
      ),
    );

    try {
      const frame = view.container.querySelector("iframe");
      if (!frame) throw new Error("Missing the preview frame");
      expect(frame.style.visibility).toBe("hidden");
      expect(frame.style.colorScheme).toBe("dark");
      expect(frame.src).toContain("odt-surface=");
      Object.defineProperty(frame, "contentWindow", { configurable: true, value: contentWindow });

      act(() => {
        frame.dispatchEvent(new Event("load"));
      });
      const init = posted.find(({ message }) => message.type === "odt-html-preview-init");
      const generation = init?.message.generation;
      if (!generation) throw new Error("Missing the preview generation");
      expect(init.message.html).toBe("<p>Hello</p>");
      const channel = channels[0];
      if (!channel) throw new Error("Missing the preview channel");

      await act(async () => {
        channel.port1.onmessage?.(
          new MessageEvent("message", { data: { type: "displayed", generation } }),
        );
      });

      expect(frame.style.visibility).toBe("visible");
      expect(channel.port1.posted).toEqual([]);
      const container = frame.parentElement;
      expect(container?.style.height).toBe("320px");
      commits = 0;

      await act(async () => {
        channel.port1.onmessage?.(
          new MessageEvent("message", { data: { type: "resize", generation, height: 480 } }),
        );
      });

      expect(container?.style.height).toBe("480px");
      expect(commits).toBe(0);
      expect(readHtmlPreviewPlaceholderHeight("preview-remount-key")).toBe(480);

      // Live theme switch updates the outer iframe surface and sends css + surface to the wrapper.
      view.rerender(
        createElement(
          Profiler,
          { id: "html-frame", onRender: () => {} },
          createElement(HtmlPreviewFrame, {
            ...baseProps,
            themeCss: ":root{color-scheme:light}",
            bootstrapSurface: { appearance: "light", background: "rgb(255, 255, 255)" },
          }),
        ),
      );
      expect(frame.style.colorScheme).toBe("light");
      expect(frame.style.background).toBe("rgb(255, 255, 255)");
      expect(channel.port1.posted.at(-1)).toEqual({
        type: "theme",
        generation,
        css: ":root{color-scheme:light}",
        surface: { appearance: "light", background: "rgb(255, 255, 255)" },
      });

      // Switching to an uncached contentKey resets container height back to the initial placeholder
      // and keeps the frame title set on the newly created iframe.
      view.rerender(
        createElement(
          Profiler,
          { id: "html-frame", onRender: () => {} },
          createElement(HtmlPreviewFrame, {
            ...baseProps,
            contentKey: "uncached-preview-key",
          }),
        ),
      );
      expect(container?.style.height).toBe("320px");
      expect(view.container.querySelector("iframe")?.title).toBe("Test preview HTML preview");
    } finally {
      view.unmount();
      restoreIframe();
    }
  });

  test("gates external link opens and Escape by focused iframe and enforces link cooldown", async () => {
    const channels = installTestMessageChannel();
    const restoreIframe = enableIframeLoading();
    const onOpenLink = mock((_url: string) => {});
    const onEscape = mock(() => {});
    const posted: Array<{ message: FakeMessage }> = [];

    const view = render(
      createElement(HtmlPreviewFrame, {
        html: '<a href="https://example.com">Docs</a>',
        name: "Links",
        bootstrapUrl: "about:blank",
        failureMessage: "Failed",
        themeCss: ":root{}",
        bootstrapSurface: { appearance: "light", background: "rgb(255, 255, 255)" },
        onOpenLink,
        onEscape,
      }),
    );

    try {
      const frame = view.container.querySelector("iframe");
      if (!frame) throw new Error("Missing iframe");
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { postMessage: (message: FakeMessage) => posted.push({ message }) },
      });
      act(() => {
        frame.dispatchEvent(new Event("load"));
      });
      const generation = posted[0]?.message.generation;
      const channel = channels[0];
      if (!generation || !channel) throw new Error("Missing channel");

      // Unfocused iframe cannot trigger link opens or Escape.
      await act(async () => {
        channel.port1.onmessage?.(
          new MessageEvent("message", {
            data: { type: "open-link", generation, url: "https://example.com/unfocused" },
          }),
        );
        channel.port1.onmessage?.(
          new MessageEvent("message", { data: { type: "escape", generation } }),
        );
      });
      expect(onOpenLink).not.toHaveBeenCalled();
      expect(onEscape).not.toHaveBeenCalled();

      // Focusing the iframe permits one external http(s) link open and Escape.
      frame.focus();
      await act(async () => {
        channel.port1.onmessage?.(
          new MessageEvent("message", {
            data: { type: "open-link", generation, url: "javascript:alert(1)" },
          }),
        );
        channel.port1.onmessage?.(
          new MessageEvent("message", {
            data: { type: "open-link", generation, url: "https://example.com/docs" },
          }),
        );
        // Immediate duplicate within cooldown is dropped.
        channel.port1.onmessage?.(
          new MessageEvent("message", {
            data: { type: "open-link", generation, url: "https://example.com/spam" },
          }),
        );
        channel.port1.onmessage?.(
          new MessageEvent("message", { data: { type: "escape", generation } }),
        );
      });
      expect(onOpenLink).toHaveBeenCalledTimes(1);
      expect(onOpenLink).toHaveBeenCalledWith("https://example.com/docs");
      expect(onEscape).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      restoreIframe();
    }
  });

  test("renders a View source action and hides Open full screen when the preview fails", async () => {
    const restoreIframe = enableIframeLoading();
    const onOpenFullScreen = mock(() => {});
    const onViewSource = mock(() => {});

    const view = render(
      createElement(HtmlPreviewFrame, {
        html: "<p>Broken</p>",
        name: "Broken preview",
        bootstrapUrl: "about:blank",
        failureMessage: "Preview failed to start.",
        fitContent: true,
        themeCss: ":root{}",
        bootstrapSurface: { appearance: "light", background: "rgb(255, 255, 255)" },
        onOpenFullScreen,
        onViewSource,
      }),
    );

    try {
      expect(view.getByRole("button", { name: "Open full screen" })).toBeDefined();
      const frame = view.container.querySelector("iframe");
      if (!frame) throw new Error("Missing iframe");
      act(() => {
        frame.dispatchEvent(new Event("error"));
      });

      expect(view.queryByRole("button", { name: "Open full screen" })).toBeNull();
      const button = view.getByRole("button", { name: "View source" });
      button.click();
      expect(onViewSource).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      restoreIframe();
    }
  });

  test("pre-warms the bootstrap iframe while HTML is null and renders on the same iframe once HTML arrives", async () => {
    const channels = installTestMessageChannel();
    const restoreIframe = enableIframeLoading();
    const posted: Array<{ message: FakeMessage }> = [];

    const baseProps = {
      name: "Pre-warmed preview",
      bootstrapUrl: "about:blank",
      failureMessage: "Failed",
      fitContent: true,
      contentKey: "prewarm-key",
      themeCss: ":root{color-scheme:dark}",
      bootstrapSurface: { appearance: "dark" as const, background: "rgb(11, 11, 15)" },
    };

    const view = render(createElement(HtmlPreviewFrame, { ...baseProps, html: null }));

    try {
      const frame = view.container.querySelector("iframe");
      if (!frame) throw new Error("Missing pre-warmed iframe");
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { postMessage: (message: FakeMessage) => posted.push({ message }) },
      });

      act(() => {
        frame.dispatchEvent(new Event("load"));
      });
      const init = posted.find(({ message }) => message.type === "odt-html-preview-init");
      const generation = init?.message.generation;
      if (!generation) throw new Error("Missing generation");
      expect(init.message.html).toBeUndefined();
      const channel = channels[0];
      if (!channel) throw new Error("Missing channel");

      await act(async () => {
        channel.port1.onmessage?.(
          new MessageEvent("message", { data: { type: "ready", generation } }),
        );
      });
      expect(channel.port1.posted).toEqual([]);

      view.rerender(createElement(HtmlPreviewFrame, { ...baseProps, html: "<p>Arrived</p>" }));
      expect(view.container.querySelector("iframe")).toBe(frame);
      expect(channel.port1.posted).toEqual([
        { type: "render", generation, html: "<p>Arrived</p>" },
      ]);

      await act(async () => {
        channel.port1.onmessage?.(
          new MessageEvent("message", { data: { type: "displayed", generation } }),
        );
      });
      expect(frame.style.visibility).toBe("visible");
    } finally {
      view.unmount();
      restoreIframe();
    }
  });
});
