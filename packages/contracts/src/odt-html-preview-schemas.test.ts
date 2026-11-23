import { describe, expect, test } from "bun:test";
import {
  HTML_PREVIEW_CONTENT_SECURITY_POLICY,
  HTML_PREVIEW_ESCAPE_MESSAGE,
  HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT,
  HTML_PREVIEW_OPEN_LINK_MESSAGE,
  HTML_PREVIEW_RESTORE_LIMITS,
  HTML_PREVIEW_SANDBOX,
  ODT_HTML_PREVIEW_MAX_BYTES,
  ODT_HTML_PREVIEW_MAX_IMAGE_BYTES,
  ODT_HTML_PREVIEW_MAX_STORED_BYTES,
  ODT_HTML_PREVIEW_TITLE_MAX_CHARS,
  OdtPublishHtmlInputSchema,
  odtHtmlPreviewByteSize,
  odtPublishHtmlResultSchema,
  sessionHtmlPreviewReadRequestSchema,
  sessionHtmlPreviewReadResultSchema,
} from "@openducktor/contracts";

const PREVIEW_ID = "11111111-1111-4111-8111-111111111111";

describe("HTML preview contracts", () => {
  test("accepts exactly one of html or path and rejects blank values", () => {
    expect(
      OdtPublishHtmlInputSchema.parse({
        title: "  Weekly report  ",
        html: "  <p>Ready</p>  ",
      }),
    ).toEqual({ title: "Weekly report", html: "  <p>Ready</p>  " });

    expect(
      OdtPublishHtmlInputSchema.parse({
        title: "Weekly report",
        path: "  /tmp/report.html  ",
      }),
    ).toEqual({ title: "Weekly report", path: "/tmp/report.html" });

    expect(OdtPublishHtmlInputSchema.safeParse({ title: "Report" }).success).toBe(false);
    expect(
      OdtPublishHtmlInputSchema.safeParse({
        title: "Report",
        html: "<p>Ready</p>",
        path: "/tmp/report.html",
      }).success,
    ).toBe(false);
    expect(OdtPublishHtmlInputSchema.safeParse({ title: " ", html: "<p>Ready</p>" }).success).toBe(
      false,
    );
    expect(OdtPublishHtmlInputSchema.safeParse({ title: "Report", html: " \n " }).success).toBe(
      false,
    );
    expect(OdtPublishHtmlInputSchema.safeParse({ title: "Report", path: "  " }).success).toBe(
      false,
    );
  });

  test("limits the title and the UTF-8 size of inline html", () => {
    expect(
      OdtPublishHtmlInputSchema.safeParse({
        title: "t".repeat(ODT_HTML_PREVIEW_TITLE_MAX_CHARS + 1),
        html: "<p>Ready</p>",
      }).success,
    ).toBe(false);

    const fit = "a".repeat(ODT_HTML_PREVIEW_MAX_BYTES);
    expect(OdtPublishHtmlInputSchema.safeParse({ title: "Report", html: fit }).success).toBe(true);
    expect(odtHtmlPreviewByteSize("é")).toBe(2);
    expect(
      OdtPublishHtmlInputSchema.safeParse({
        title: "Report",
        html: `${fit}é`,
      }).success,
    ).toBe(false);
    expect(ODT_HTML_PREVIEW_MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(ODT_HTML_PREVIEW_MAX_STORED_BYTES).toBe(25 * 1024 * 1024);
  });

  test("describes the publish result, host read contract, and shared page policy", () => {
    expect(
      odtPublishHtmlResultSchema.parse({
        htmlPreview: { previewId: PREVIEW_ID, title: "Weekly report", byteSize: 12 },
      }),
    ).toEqual({
      htmlPreview: { previewId: PREVIEW_ID, title: "Weekly report", byteSize: 12 },
    });
    expect(
      sessionHtmlPreviewReadRequestSchema.parse({
        workspaceId: "ws-1",
        repoPath: "/repo",
        previewId: PREVIEW_ID,
      }),
    ).toEqual({
      workspaceId: "ws-1",
      repoPath: "/repo",
      previewId: PREVIEW_ID,
    });
    expect(
      sessionHtmlPreviewReadResultSchema.parse({
        previewId: PREVIEW_ID,
        html: "<p>Ready</p>",
        byteSize: 12,
      }),
    ).toEqual({
      previewId: PREVIEW_ID,
      html: "<p>Ready</p>",
      byteSize: 12,
    });
    expect(HTML_PREVIEW_SANDBOX).toBe("allow-scripts allow-forms");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("connect-src https:");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("frame-src 'none'");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).not.toContain("allow-same-origin");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).not.toContain("sandbox");
    expect(HTML_PREVIEW_OPEN_LINK_MESSAGE).toBe("odt-html-preview-open-link");
    expect(HTML_PREVIEW_ESCAPE_MESSAGE).toBe("odt-html-preview-escape");
    expect(HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT).toBe(2_000);
  });

  test("pins the restore limits that the docs quote", () => {
    expect(HTML_PREVIEW_RESTORE_LIMITS).toEqual({
      perWindow: 3,
      windowMs: 1000,
      perGeneration: 5,
    });
  });
});
