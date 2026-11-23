import { describe, expect, test } from "bun:test";
import type { PermissionCheckHandlerHandlerDetails, WebContents } from "electron";
import {
  ELECTRON_ARTIFACT_PREVIEW_PROTOCOL,
  ELECTRON_HTML_PREVIEW_PROTOCOL,
  ELECTRON_HTML_PREVIEW_URL,
} from "../shared/electron-bridge-contract";
import {
  configureElectronRendererPermissions,
  type ElectronPreviewDevicePermissionHandler,
  type ElectronPreviewPermissionCheckHandler,
  type ElectronPreviewPermissionRequestHandler,
  isTrustedRendererOrigin,
  registerElectronHtmlPreviewProtocol,
} from "./electron-html-preview-protocol";

type Handler = (request: Request) => Response | Promise<Response>;

type CapturedProtocolHandler = {
  handler: Handler | undefined;
};

type CapturedPermissionHandlers = {
  requestHandler: ElectronPreviewPermissionRequestHandler;
  checkHandler: ElectronPreviewPermissionCheckHandler;
  deviceHandler: ElectronPreviewDevicePermissionHandler;
};

const setupProtocol = () => {
  const captured: CapturedProtocolHandler = { handler: undefined };
  registerElectronHtmlPreviewProtocol({
    protocol: {
      handle(scheme, nextHandler) {
        expect(scheme).toBe(ELECTRON_HTML_PREVIEW_PROTOCOL);
        captured.handler = nextHandler;
      },
    },
  });
  if (!captured.handler) throw new Error("Missing HTML preview protocol handler.");
  return captured.handler;
};

const setupPermissions = (rendererDevUrl: string | undefined) => {
  const captured: CapturedPermissionHandlers = {
    requestHandler: null,
    checkHandler: null,
    deviceHandler: null,
  };

  configureElectronRendererPermissions(
    {
      setPermissionRequestHandler(next) {
        captured.requestHandler = next;
      },
      setPermissionCheckHandler(next) {
        captured.checkHandler = next;
      },
      setDevicePermissionHandler(next) {
        captured.deviceHandler = next;
      },
    },
    rendererDevUrl,
  );

  if (!captured.requestHandler || !captured.checkHandler || !captured.deviceHandler) {
    throw new Error("Missing renderer permission handlers.");
  }
  return {
    requestHandler: captured.requestHandler,
    checkHandler: captured.checkHandler,
    deviceHandler: captured.deviceHandler,
  };
};

// SAFETY: The preview permission handlers never dereference webContents; tests pass a stub object.
const stubWebContents = {} as WebContents;

type RequestHandlerDetails = Parameters<NonNullable<ElectronPreviewPermissionRequestHandler>>[3];

const requestDetails = (overrides: {
  requestingUrl?: string;
  securityOrigin?: string;
  isMainFrame?: boolean;
}): RequestHandlerDetails =>
  // SAFETY: Only requestingUrl, securityOrigin, and isMainFrame are inspected by the handler.
  ({
    requestingUrl: "",
    isMainFrame: true,
    ...overrides,
  }) as RequestHandlerDetails;

const checkDetails = (
  overrides: Partial<PermissionCheckHandlerHandlerDetails>,
): PermissionCheckHandlerHandlerDetails =>
  // SAFETY: Only requestingUrl, securityOrigin, and isMainFrame are inspected by the handler.
  ({ ...overrides }) as PermissionCheckHandlerHandlerDetails;

describe("Electron HTML preview protocol", () => {
  test("serves the bootstrap when the surface is in the fragment", async () => {
    const handler = setupProtocol();
    const response = await handler(new Request(`${ELECTRON_HTML_PREVIEW_URL}#odt-surface=%7B%7D`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  test("rejects another route", async () => {
    const handler = setupProtocol();
    const response = await handler(
      new Request(`${ELECTRON_HTML_PREVIEW_URL}-other#odt-surface=%7B%7D`),
    );

    expect(response.status).toBe(404);
  });
});

describe("Electron renderer permissions", () => {
  test("allows only the trusted dev main frame and fails closed for subframes, preview origins, blob/data, empty URLs, and devices", () => {
    const devUrl = "http://localhost:5173";
    const { requestHandler, checkHandler, deviceHandler } = setupPermissions(devUrl);

    const ask = (details: {
      requestingUrl?: string;
      securityOrigin?: string;
      isMainFrame?: boolean;
    }): boolean => {
      let granted = false;
      requestHandler(
        stubWebContents,
        "geolocation",
        (result) => {
          granted = result;
        },
        requestDetails(details),
      );
      return granted;
    };

    expect(isTrustedRendererOrigin("http://localhost:5173/sessions", devUrl)).toBe(true);
    expect(isTrustedRendererOrigin(`${ELECTRON_HTML_PREVIEW_PROTOCOL}://bootstrap`, devUrl)).toBe(
      false,
    );
    expect(
      isTrustedRendererOrigin(`${ELECTRON_ARTIFACT_PREVIEW_PROTOCOL}://bootstrap`, devUrl),
    ).toBe(false);
    expect(isTrustedRendererOrigin("about:srcdoc", devUrl)).toBe(false);
    expect(isTrustedRendererOrigin("blob:null/worker", devUrl)).toBe(false);
    expect(isTrustedRendererOrigin("data:text/html,<script>", devUrl)).toBe(false);
    expect(isTrustedRendererOrigin("null", devUrl)).toBe(false);
    expect(isTrustedRendererOrigin("", devUrl)).toBe(false);

    expect(ask({ requestingUrl: "http://localhost:5173/", isMainFrame: true })).toBe(true);
    expect(ask({ requestingUrl: "http://localhost:5173/", isMainFrame: false })).toBe(false);
    expect(ask({ requestingUrl: ELECTRON_HTML_PREVIEW_URL, isMainFrame: true })).toBe(false);
    expect(ask({ requestingUrl: "", isMainFrame: true })).toBe(false);
    expect(ask({ requestingUrl: "blob:null/123", isMainFrame: true })).toBe(false);
    expect(ask({ requestingUrl: "data:text/html,hi", isMainFrame: true })).toBe(false);
    expect(ask({ requestingUrl: "about:srcdoc", isMainFrame: true })).toBe(false);
    expect(
      ask({ requestingUrl: "http://localhost:5173/", securityOrigin: "null", isMainFrame: true }),
    ).toBe(false);

    expect(checkHandler(stubWebContents, "media", "http://localhost:5173", checkDetails({}))).toBe(
      true,
    );
    expect(
      checkHandler(
        stubWebContents,
        "media",
        "http://localhost:5173",
        checkDetails({ isMainFrame: false }),
      ),
    ).toBe(false);
    expect(checkHandler(stubWebContents, "media", "null", checkDetails({}))).toBe(false);
    expect(checkHandler(stubWebContents, "media", "blob:null/123", checkDetails({}))).toBe(false);
    expect(checkHandler(stubWebContents, "media", "data:text/html,hi", checkDetails({}))).toBe(
      false,
    );
    expect(
      checkHandler(
        stubWebContents,
        "media",
        `${ELECTRON_HTML_PREVIEW_PROTOCOL}://bootstrap`,
        checkDetails({}),
      ),
    ).toBe(false);
    expect(
      checkHandler(stubWebContents, "media", "", checkDetails({ requestingUrl: "about:srcdoc" })),
    ).toBe(false);

    // SAFETY: Device permission handler unconditionally denies without reading details.
    expect(deviceHandler({} as Parameters<NonNullable<typeof deviceHandler>>[0])).toBe(false);
  });

  test("allows only file:// main-frame requests in the packaged app", () => {
    const { requestHandler, checkHandler } = setupPermissions(undefined);
    let granted = false;
    requestHandler(
      stubWebContents,
      "clipboard-sanitized-write",
      (result) => {
        granted = result;
      },
      requestDetails({ requestingUrl: "file:///app/index.html", isMainFrame: true }),
    );
    expect(granted).toBe(true);
    expect(
      checkHandler(stubWebContents, "clipboard-sanitized-write", "file://", checkDetails({})),
    ).toBe(true);
    expect(checkHandler(stubWebContents, "media", "http://localhost:5173", checkDetails({}))).toBe(
      false,
    );
  });
});
