import { describe, expect, test } from "bun:test";
import {
  buildHtmlPreviewHostControllerScript,
  HTML_PREVIEW_ESCAPE_MESSAGE,
  HTML_PREVIEW_OPEN_LINK_MESSAGE,
  HTML_PREVIEW_RESIZE_MESSAGE,
  HTML_PREVIEW_RESTORE_LIMITS,
  HTML_PREVIEW_SANDBOX,
  HTML_PREVIEW_THEME_MESSAGE,
} from "./html-preview-policy";

describe("buildHtmlPreviewHostControllerScript", () => {
  test("includes sandbox, restore limits, theme push, and optional desktop events", () => {
    const desktopScript = buildHtmlPreviewHostControllerScript({
      maxContentHeight: 20_000,
      forwardEscape: true,
    });

    expect(desktopScript).toContain(`frame.sandbox = "${HTML_PREVIEW_SANDBOX}"`);
    expect(desktopScript).toContain(`type: "${HTML_PREVIEW_THEME_MESSAGE}"`);
    expect(desktopScript).toContain(`data.type === "${HTML_PREVIEW_RESIZE_MESSAGE}"`);
    expect(desktopScript).toContain(`data.type === "${HTML_PREVIEW_OPEN_LINK_MESSAGE}"`);
    expect(desktopScript).toContain(`data.type === "${HTML_PREVIEW_ESCAPE_MESSAGE}"`);
    expect(desktopScript).toContain("Math.min(Math.ceil(height), 20000)");
    expect(desktopScript).toContain(
      `windowRestores > ${HTML_PREVIEW_RESTORE_LIMITS.perWindow} || restores > ${HTML_PREVIEW_RESTORE_LIMITS.perGeneration}`,
    );
    expect(desktopScript).not.toContain("allow-same-origin");
    expect(desktopScript).not.toContain('frame.scrolling = "no"');
  });

  test("supports mobile user-activation gating, frame scrolling disable, and omits desktop-only escape branch", () => {
    const mobileScript = buildHtmlPreviewHostControllerScript({
      maxContentHeight: 2_000,
      requireUserActivationForLinks: true,
      disableFrameScrolling: true,
    });

    expect(mobileScript).toContain("Math.min(Math.ceil(height), 2000)");
    expect(mobileScript).toContain("navigator.userActivation.isActive");
    expect(mobileScript).toContain('frame.scrolling = "no"');
    expect(mobileScript).not.toContain(HTML_PREVIEW_ESCAPE_MESSAGE);
  });
});
