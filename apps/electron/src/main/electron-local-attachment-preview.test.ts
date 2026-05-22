import { describe, expect, test } from "bun:test";
import {
  createElectronLocalAttachmentPreviewUrl,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL,
  readElectronLocalAttachmentPreviewRequestPath,
  readLocalAttachmentPreviewPath,
  registerElectronLocalAttachmentPreviewProtocol,
} from "./electron-local-attachment-preview";

describe("electron local attachment previews", () => {
  test("creates an app protocol URL for staged attachment paths", () => {
    const previewUrl = createElectronLocalAttachmentPreviewUrl(
      "/tmp/openducktor-local-attachments/staged screenshot.png",
    );

    expect(previewUrl).toBe(
      `${ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL}://preview/%2Ftmp%2Fopenducktor-local-attachments%2Fstaged%20screenshot.png`,
    );
    expect(readElectronLocalAttachmentPreviewRequestPath(previewUrl)).toBe(
      "/tmp/openducktor-local-attachments/staged screenshot.png",
    );
  });

  test("rejects missing or malformed preview paths", () => {
    expect(() => readLocalAttachmentPreviewPath("  ")).toThrow(
      "Local attachment preview path must be a non-empty string.",
    );
    expect(() => readLocalAttachmentPreviewPath(null)).toThrow(
      "Local attachment preview path must be a non-empty string.",
    );
    expect(() =>
      readElectronLocalAttachmentPreviewRequestPath(
        "file:///tmp/openducktor-local-attachments/a.png",
      ),
    ).toThrow("Invalid local attachment preview URL.");
    expect(() =>
      readElectronLocalAttachmentPreviewRequestPath(
        `${ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL}://preview/%`,
      ),
    ).toThrow("Invalid local attachment preview URL.");
  });

  test("resolves the protocol request through the host before serving the file", async () => {
    let protocolHandler: ((request: Request) => Response | Promise<Response>) | null = null;
    const resolvedPaths: string[] = [];
    const servedUrls: string[] = [];

    registerElectronLocalAttachmentPreviewProtocol({
      session: {
        protocol: {
          handle(scheme, handler) {
            expect(scheme).toBe(ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL);
            protocolHandler = handler;
          },
        },
      },
      net: {
        async fetch(url) {
          servedUrls.push(url);
          return new Response("image bytes", { status: 200 });
        },
      },
      async resolveLocalAttachmentPath(filePath) {
        resolvedPaths.push(filePath);
        return "/tmp/openducktor-local-attachments/resolved.png";
      },
    });

    if (!protocolHandler) {
      throw new Error("Preview protocol handler was not registered.");
    }

    const response = await protocolHandler(
      new Request(
        createElectronLocalAttachmentPreviewUrl("/tmp/openducktor-local-attachments/staged.png"),
      ),
    );

    expect(resolvedPaths).toEqual(["/tmp/openducktor-local-attachments/staged.png"]);
    expect(servedUrls).toEqual(["file:///tmp/openducktor-local-attachments/resolved.png"]);
    expect(await response.text()).toBe("image bytes");
  });
});
