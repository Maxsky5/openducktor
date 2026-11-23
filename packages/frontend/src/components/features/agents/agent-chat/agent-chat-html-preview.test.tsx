import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  ArtifactPreviewEnvironment,
  SessionHtmlPreviewReadResult,
} from "@openducktor/contracts";
import { ClientConnectionProvider } from "@openducktor/frontend-core";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { readHtmlPreviewToolCall } from "@openducktor/frontend-core/sessions/messages/html-preview-tool";
import { ToolPartSessionContext } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { createUnavailableShellBridge } from "@/lib/shell-bridge";
import { ShellPlatformContext } from "@/lib/shell-platform";
import { createIntersectionObserverTestDriver } from "@/test-utils/intersection-observer-test-driver";
import { AgentChatHtmlPreview } from "./agent-chat-html-preview";

enableReactActEnvironment();
const intersections = createIntersectionObserverTestDriver();

const PREVIEW_ID = "11111111-1111-4111-8111-111111111111";

const environment: ArtifactPreviewEnvironment = {
  bootstrapUrl: "https://host.test/artifact-preview-bootstrap",
  htmlPreviewBootstrapUrl: "about:blank",
  scriptedHtml: { supported: true },
};

const session = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
  externalSessionId: "sess-1",
  sessionScope: { kind: "repository" as const, workspaceId: "ws-1" },
};

const meta = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "odt_publish_html",
  toolType: "generic",
  status: "completed",
  input: { title: "Weekly report", path: "/tmp/report.html" },
  output: JSON.stringify({
    htmlPreview: { previewId: PREVIEW_ID, title: "Weekly report", byteSize: 14 },
  }),
  ...overrides,
});

const renderPreview = ({
  toolMeta = meta(),
  readPreview = async (): Promise<SessionHtmlPreviewReadResult> => ({
    previewId: PREVIEW_ID,
    html: "<h1>Ready</h1>",
    byteSize: 14,
  }),
}: {
  toolMeta?: ToolMeta;
  readPreview?: () => Promise<SessionHtmlPreviewReadResult>;
} = {}) => {
  const preview = readHtmlPreviewToolCall(toolMeta);
  if (preview === null) throw new Error("The test tool meta must hold a preview.");
  const connection = createTestClientConnection({
    client: { sessionHtmlPreviewRead: readPreview },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client: connection.queryClient },
      createElement(
        ClientConnectionProvider,
        { connection },
        createElement(
          ToolPartSessionContext.Provider,
          { value: session },
          createElement(
            ShellPlatformContext.Provider,
            {
              value: {
                ...createUnavailableShellBridge(),
                getArtifactPreviewEnvironment: async () => environment,
              },
            },
            createElement(AgentChatHtmlPreview, { preview }),
          ),
        ),
      ),
    ),
  );
};

describe("AgentChatHtmlPreview", () => {
  let restoreIframeLoading: (() => void) | null = null;

  beforeEach(() => {
    intersections.install();
    // SAFETY: The test preload registers happy-dom, which adds `happyDOM` with mutable settings to the window.
    const settings = (
      window as typeof window & {
        happyDOM?: {
          settings: {
            enableIframePageLoading: boolean;
            disableIframePageLoading: boolean;
          };
        };
      }
    ).happyDOM?.settings;
    if (settings) {
      const previousEnable = settings.enableIframePageLoading;
      const previousDisable = settings.disableIframePageLoading;
      settings.enableIframePageLoading = true;
      settings.disableIframePageLoading = false;
      restoreIframeLoading = () => {
        settings.enableIframePageLoading = previousEnable;
        settings.disableIframePageLoading = previousDisable;
      };
    }
  });

  afterEach(() => {
    intersections.restore();
    restoreIframeLoading?.();
    restoreIframeLoading = null;
  });

  test("defers host read and iframe mount while far offscreen and mounts once scrolled near viewport", async () => {
    intersections.setInitiallyVisible(false);
    let readCount = 0;
    renderPreview({
      readPreview: async () => {
        readCount += 1;
        return {
          previewId: PREVIEW_ID,
          html: "<h1>Deferred</h1>",
          byteSize: 17,
        };
      },
    });

    expect(readCount).toBe(0);
    expect(document.querySelector("iframe")).toBeNull();

    await act(async () => {
      intersections.observers[0]?.notify(true);
    });

    await screen.findByRole("button", { name: "Open full screen" });
    expect(readCount).toBe(1);
    expect(document.querySelector("iframe")).not.toBeNull();
  });

  test("loads stored HTML from the host and shows the page with one control and no title bar", async () => {
    renderPreview();

    await screen.findByRole("button", { name: "Open full screen" });
    const region = screen.getByRole("region", { name: "Weekly report HTML preview" });
    expect(region.querySelector("iframe")?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms",
    );
    expect(screen.queryByRole("heading", { name: "Weekly report" })).toBeNull();
    expect(screen.queryByRole("button", { name: "View source" })).toBeNull();
  });

  test("opens the complete source from the full-screen view", async () => {
    renderPreview();
    const open = await screen.findByRole("button", { name: "Open full screen" });
    fireEvent.click(open);

    const dialog = await screen.findByRole("dialog", { name: "Weekly report" });
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(dialog.textContent).toContain("<h1>Ready</h1>");
    expect(screen.getByRole("button", { name: "Source" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  test("returns focus to the button that opened the full-screen view", async () => {
    renderPreview();
    const open = await screen.findByRole("button", { name: "Open full screen" });
    open.focus();
    fireEvent.click(open);
    await screen.findByRole("dialog", { name: "Weekly report" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.activeElement === open).toBe(true));
  });

  test("shows an actionable retry state when the host cannot read the stored preview", async () => {
    let attempts = 0;
    renderPreview({
      readPreview: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("Preview missing from database.");
        return {
          previewId: PREVIEW_ID,
          html: "<h1>Recovered</h1>",
          byteSize: 18,
        };
      },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Preview missing from database.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Open full screen" });
  });

  test("offers both modes in the full-screen view and preserves the preview iframe across mode toggles", async () => {
    renderPreview();
    const open = await screen.findByRole("button", { name: "Open full screen" });
    fireEvent.click(open);

    const dialog = await screen.findByRole("dialog", { name: "Weekly report" });
    const frame = dialog.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.getAttribute("src")).toStartWith("about:blank");
    expect(dialog.textContent).not.toContain("<h1>Ready</h1>");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(dialog.textContent).toContain("<h1>Ready</h1>");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(dialog.querySelector("iframe")).toBe(frame);
  });

  test("shows a View source action when the inline iframe fails and hides the overlapping full-screen button", async () => {
    renderPreview();
    await screen.findByRole("button", { name: "Open full screen" });
    const region = screen.getByRole("region", { name: "Weekly report HTML preview" });
    const frame = region.querySelector("iframe");
    if (!frame) throw new Error("Missing inline preview iframe.");

    act(() => {
      frame.dispatchEvent(new Event("error"));
    });

    const viewSource = await screen.findByRole("button", { name: "View source" });
    expect(screen.queryByRole("button", { name: "Open full screen" })).toBeNull();
    fireEvent.click(viewSource);
    const dialog = await screen.findByRole("dialog", { name: "Weekly report" });
    expect(dialog.textContent).toContain("<h1>Ready</h1>");
  });
});
