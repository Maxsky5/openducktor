import { describe, expect, test } from "bun:test";
import { ElectronOperationError, ElectronValidationError } from "../effect/electron-errors";
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
    const blankPathError = (() => {
      try {
        readLocalAttachmentPreviewPath("  ");
      } catch (error) {
        return error;
      }
      throw new Error("Expected readLocalAttachmentPreviewPath to fail.");
    })();

    expect(blankPathError).toBeInstanceOf(ElectronValidationError);
    expect(blankPathError).toMatchObject({
      _tag: "ElectronValidationError",
      operation: "electron.preview.read-path",
      message: "Local attachment preview path must be a non-empty string.",
    });
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

  test("returns structured error responses for invalid preview requests", async () => {
    let protocolHandler: ((request: Request) => Response | Promise<Response>) | null = null;

    registerElectronLocalAttachmentPreviewProtocol({
      session: {
        protocol: {
          handle(_scheme, handler) {
            protocolHandler = handler;
          },
        },
      },
      net: {
        async fetch() {
          throw new Error("Fetch should not run for invalid requests.");
        },
      },
      async resolveLocalAttachmentPath() {
        throw new Error("Resolve should not run for invalid requests.");
      },
    });

    if (!protocolHandler) {
      throw new Error("Preview protocol handler was not registered.");
    }

    const response = await protocolHandler(new Request("file:///tmp/not-a-preview.png"));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid local attachment preview URL.");
  });

  test("returns structured error responses for rejected host resolution", async () => {
    let protocolHandler: ((request: Request) => Response | Promise<Response>) | null = null;

    registerElectronLocalAttachmentPreviewProtocol({
      session: {
        protocol: {
          handle(_scheme, handler) {
            protocolHandler = handler;
          },
        },
      },
      net: {
        async fetch() {
          throw new Error("Fetch should not run when resolution fails.");
        },
      },
      async resolveLocalAttachmentPath() {
        throw new ElectronValidationError({
          operation: "electron.preview.resolve-host-path",
          message: "Attachment path is not a staged local attachment.",
          field: "path",
        });
      },
    });

    if (!protocolHandler) {
      throw new Error("Preview protocol handler was not registered.");
    }

    const response = await protocolHandler(
      new Request(
        createElectronLocalAttachmentPreviewUrl("/tmp/openducktor-local-attachments/outside.png"),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Attachment path is not a staged local attachment.");
  });

  test("returns structured error responses for host resolver operation failures", async () => {
    let protocolHandler: ((request: Request) => Response | Promise<Response>) | null = null;

    registerElectronLocalAttachmentPreviewProtocol({
      session: {
        protocol: {
          handle(_scheme, handler) {
            protocolHandler = handler;
          },
        },
      },
      net: {
        async fetch() {
          throw new Error("Fetch should not run when host resolution fails.");
        },
      },
      async resolveLocalAttachmentPath() {
        throw new ElectronOperationError({
          operation: "electron.preview.resolve-host-path",
          message: "Host command router failed.",
        });
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

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Host command router failed.");
  });

  test("returns structured error responses for invalid host resolver return shapes", async () => {
    let protocolHandler: ((request: Request) => Response | Promise<Response>) | null = null;

    registerElectronLocalAttachmentPreviewProtocol({
      session: {
        protocol: {
          handle(_scheme, handler) {
            protocolHandler = handler;
          },
        },
      },
      net: {
        async fetch() {
          throw new Error("Fetch should not run when resolution returns an invalid shape.");
        },
      },
      async resolveLocalAttachmentPath() {
        return null as never;
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

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Local attachment preview path must be a non-empty string.");
  });

  test("returns structured error responses for preview file serving failures", async () => {
    let protocolHandler: ((request: Request) => Response | Promise<Response>) | null = null;

    registerElectronLocalAttachmentPreviewProtocol({
      session: {
        protocol: {
          handle(_scheme, handler) {
            protocolHandler = handler;
          },
        },
      },
      net: {
        async fetch() {
          throw new Error("Failed to load preview bytes.");
        },
      },
      async resolveLocalAttachmentPath() {
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

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Failed to load preview bytes.");
  });
});
