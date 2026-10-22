import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BrowserPermissionKind } from "@openducktor/contracts";
import type { ElectronDownloadItem } from "./electron-browser-downloads";
import {
  type BrowserPartitionSessionInput,
  configureBrowserPartitionSession,
  createBrowserPermissionGrants,
  type ElectronBrowserPartitionSession,
  permissionOrigin,
} from "./electron-browser-session";

type RequestHandler = Parameters<ElectronBrowserPartitionSession["setPermissionRequestHandler"]>[0];
type CheckHandler = Parameters<ElectronBrowserPartitionSession["setPermissionCheckHandler"]>[0];

class FakePartitionSession extends EventEmitter {
  requestHandler: RequestHandler | null = null;
  checkHandler: CheckHandler | null = null;
  deviceHandler: (() => boolean) | null = null;

  get webRequest(): never {
    throw new Error("Browser partitions must not use web request handlers.");
  }

  get protocol(): never {
    throw new Error("Browser partitions must not use custom protocols.");
  }

  setPermissionRequestHandler(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  setPermissionCheckHandler(handler: CheckHandler): void {
    this.checkHandler = handler;
  }

  setDevicePermissionHandler(handler: () => boolean): void {
    this.deviceHandler = handler;
  }

  clearData = () => Promise.resolve();
  clearStorageData = () => Promise.resolve();
  clearCache = () => Promise.resolve();
}

type Asked = { tabId: string; origin: string; permission: BrowserPermissionKind };

const setup = (answers: Partial<Record<BrowserPermissionKind, boolean>> = {}) => {
  const session = new FakePartitionSession();
  const grants = createBrowserPermissionGrants();
  const asked: Asked[] = [];
  const downloads: string[] = [];
  const refusedSchemes: Array<[string, string]> = [];
  const input: BrowserPartitionSessionInput = {
    session,
    workspaceId: "repo",
    grants,
    tabOf: (id) => (id === 7 ? "tab-1" : null),
    askPermission: (tabId, origin, permission) => {
      asked.push({ tabId, origin, permission });
      return Promise.resolve(answers[permission] ?? false);
    },
    startDownload: (tabId) => downloads.push(tabId),
    onSchemeRefused: (tabId, scheme) => refusedSchemes.push([tabId, scheme]),
  };
  configureBrowserPartitionSession(input);
  const request = (permission: string, details: Parameters<RequestHandler>[3], id = 7) =>
    new Promise<boolean>((resolve) =>
      session.requestHandler?.({ id }, permission, resolve, details),
    );
  const check = (permission: string, origin: string, details: Parameters<CheckHandler>[3] = {}) =>
    session.checkHandler?.({ id: 7 }, permission, origin, details);
  return { session, grants, asked, downloads, refusedSchemes, request, check };
};

describe("permissionOrigin", () => {
  test("reads the origin of a page URL", () => {
    expect(permissionOrigin("http://localhost:3000/a?b")).toBe("http://localhost:3000");
    expect(permissionOrigin("data:text/html,x")).toBeNull();
    expect(permissionOrigin("")).toBeNull();
    expect(permissionOrigin(undefined)).toBeNull();
  });
});

describe("configureBrowserPartitionSession", () => {
  test("asks the host for each media kind and stops at the first denial", async () => {
    const { asked, request } = setup({ camera: false, microphone: true });
    const granted = await request("media", {
      requestingUrl: "https://meet.example/room",
      mediaTypes: ["video", "audio"],
    });
    expect(granted).toBe(false);
    expect(asked).toEqual([
      { tabId: "tab-1", origin: "https://meet.example", permission: "camera" },
    ]);
  });

  test("answers later checks from the grants of this run", async () => {
    const { check, request } = setup({ geolocation: true });
    expect(check("geolocation", "https://maps.example/")).toBe(false);
    expect(await request("geolocation", { requestingUrl: "https://maps.example/x" })).toBe(true);
    expect(check("geolocation", "https://maps.example/")).toBe(true);
    expect(check("geolocation", "https://other.example/")).toBe(false);
  });

  test("a reset ends the grants of the site, so its next request asks again", async () => {
    const { asked, check, grants, request } = setup({ camera: true, geolocation: true });
    await request("media", { requestingUrl: "https://meet.example/room", mediaTypes: ["video"] });
    await request("geolocation", { requestingUrl: "https://meet.example/room" });
    await request("geolocation", { requestingUrl: "https://maps.example/" });

    grants.revoke("repo", "https://meet.example", "camera");
    expect(check("media", "https://meet.example/", { mediaType: "video" })).toBe(false);
    expect(check("geolocation", "https://meet.example/")).toBe(true);
    grants.revoke("repo", "https://meet.example", null);
    expect(check("geolocation", "https://meet.example/")).toBe(false);
    expect(check("geolocation", "https://maps.example/")).toBe(true);

    asked.length = 0;
    await request("media", { requestingUrl: "https://meet.example/room", mediaTypes: ["video"] });
    expect(asked).toEqual([
      { tabId: "tab-1", origin: "https://meet.example", permission: "camera" },
    ]);
  });

  test("asks for each prompted permission kind, and asks camera then microphone", async () => {
    const { asked, request } = setup({
      camera: true,
      microphone: true,
      geolocation: true,
      clipboard_read: true,
    });
    const page = { requestingUrl: "https://meet.example/room" };

    expect(await request("media", { ...page, mediaTypes: ["video", "audio"] })).toBe(true);
    expect(await request("geolocation", page)).toBe(true);
    expect(await request("clipboard-read", page)).toBe(true);

    expect(asked.map(({ permission }) => permission)).toEqual([
      "camera",
      "microphone",
      "geolocation",
      "clipboard_read",
    ]);
  });

  test("denies device, MIDI, screen capture, and empty media requests without asking", async () => {
    const { asked, request } = setup({ camera: true, microphone: true });
    const page = { requestingUrl: "https://a.example/" };
    for (const permission of ["hid", "serial", "usb", "midi", "display-capture"]) {
      expect(await request(permission, page)).toBe(false);
    }
    expect(await request("media", { ...page, mediaTypes: [] })).toBe(false);
    expect(asked).toEqual([]);
  });

  test("refuses a link to another scheme and reports the scheme to the tab", async () => {
    const { asked, refusedSchemes, request } = setup();

    expect(
      await request("openExternal", {
        requestingUrl: "https://a.example/",
        externalURL: "vscode://file/repo",
      }),
    ).toBe(false);

    expect(refusedSchemes).toEqual([["tab-1", "vscode"]]);
    expect(asked).toEqual([]);
  });

  test("denies requests of unknown pages and unprompted permissions without asking", async () => {
    const { asked, request, session } = setup({ geolocation: true });
    expect(await request("geolocation", { requestingUrl: "https://a.example/" }, 99)).toBe(false);
    expect(await request("usb", { requestingUrl: "https://a.example/" })).toBe(false);
    expect(
      await request("clipboard-sanitized-write", { requestingUrl: "https://a.example/" }),
    ).toBe(true);
    expect(asked).toEqual([]);
    expect(session.deviceHandler?.()).toBe(false);
  });

  test("keeps notification checks denied so only the page script reports notifications", async () => {
    const { check, request } = setup({ notifications: true });
    expect(await request("notifications", { requestingUrl: "https://a.example/" })).toBe(true);
    expect(check("notifications", "https://a.example/")).toBe(false);
  });

  test("starts downloads of bound tabs and cancels other downloads", () => {
    const { session, downloads } = setup();
    let canceled = 0;
    const event = { preventDefault: () => (canceled += 1) };
    const item: ElectronDownloadItem = {
      getFilename: () => "a.txt",
      getURL: () => "https://a.example/a.txt",
      getReceivedBytes: () => 0,
      getTotalBytes: () => 0,
      setSavePath: () => {},
      on: () => {},
      once: () => {},
    };
    session.emit("will-download", event, item, { id: 7 });
    session.emit("will-download", event, item, { id: 8 });
    expect(downloads).toEqual(["tab-1"]);
    expect(canceled).toBe(1);
  });
});
