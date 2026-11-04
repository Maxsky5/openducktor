import { expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import * as QRCode from "qrcode";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RemoteAccessBridge, RemoteAccessState } from "@openducktor/contracts";
import { QueryProvider } from "@/test-utils/query-provider";
import { PairingPanel } from "./pairing-panel";

const endpoint = "http://192.168.1.9:51541";
const pairing = { code: "012345", expiresAt: "2030-01-01T00:00:00Z" };
const state = (next: Partial<RemoteAccessState>): RemoteAccessState => ({
  status: "available",
  configuration: { listenHost: "192.168.1.9", listenPort: 51541, publicEndpoint: endpoint },
  pairing: null,
  clients: [],
  connectedClients: 0,
  ...next,
});
const bridge = (overrides: Partial<RemoteAccessBridge> = {}): RemoteAccessBridge => ({
  readState: async () => state({}),
  readNetworks: async () => [],
  enable: async () => state({}),
  disable: async () => state({ status: "disabled" }),
  revokeClient: async () => state({}),
  startPairing: async () => state({ pairing }),
  stopPairing: async () => state({}),
  subscribeState: async () => () => {},
  ...overrides,
});
type Props = Partial<Parameters<typeof PairingPanel>[0]>;
const show = (props: Props = {}) => {
  const operator = props.bridge ?? bridge();
  const panel = (next: Props) => (
    <QueryProvider>
      <PairingPanel
        bridge={operator}
        endpoint={endpoint}
        pairing={null}
        pairingEnd={undefined}
        {...next}
      />
    </QueryProvider>
  );
  const view = render(panel(props));
  return { ...view, update: (next: Props) => view.rerender(panel({ ...props, ...next })) };
};
const withClipboard = async (copy: (value: string) => Promise<void>, run: () => Promise<void>) => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  try {
    await run();
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
};

test("shows no code until the operator adds a device, then reports the paired device", async () => {
  const startPairing = mock(async () => state({ pairing }));
  const stopPairing = mock(async () => state({}));
  const view = show({ bridge: bridge({ startPairing, stopPairing }) });
  expect(screen.queryByText(/^Pairing code \d/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add device" }));
  await waitFor(() => expect(startPairing).toHaveBeenCalledTimes(1));
  // Add device asks for a new window, so the host starts a new count of wrong codes.
  expect(startPairing).toHaveBeenCalledWith({ renew: false });
  view.update({ pairing });
  expect(screen.getByText("Pairing code 0 1 2 3 4 5")).toBeDefined();
  expect(screen.getByText(endpoint).textContent).toBe(`Host address ${endpoint}`);
  view.update({ pairing: null, pairingEnd: "paired" });
  expect(screen.getByText("Device paired")).toBeDefined();
  expect(screen.getByRole("button", { name: "Add another device" })).toBeDefined();
  expect(stopPairing).not.toHaveBeenCalled();
});

test("explains a window that wrong codes closed, and ignores a reason for a window it never showed", () => {
  const view = show({ pairing });
  view.update({ pairing: null, pairingEnd: "refused" });
  expect(screen.getByText("Pairing stopped after five wrong codes")).toBeDefined();
  expect(screen.getByRole("button", { name: "Add device" })).toBeDefined();
  // A view that opens later shows the plain start, not an old outcome.
  view.unmount();
  show({ pairing: null, pairingEnd: "paired" });
  expect(screen.getByText("Add a phone or another computer")).toBeDefined();
});

test("keeps a failed pairing request beside its action", async () => {
  show({
    bridge: bridge({
      startPairing: async () => {
        throw new Error("Remote control is off. Turn on Remote control, then add the device.");
      },
    }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Add device" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Remote control is off.");
});

test("copies only the host address and keeps a failed copy beside it", async () => {
  const copy = mock(async (_value: string) => {});
  await withClipboard(copy, async () => {
    show({ pairing });
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(endpoint));
    await screen.findByRole("button", { name: "Copied address" });
  });
  await withClipboard(
    async () => {
      throw new DOMException("Clipboard access denied.", "NotAllowedError");
    },
    async () => {
      show({ pairing, endpoint: "http://192.168.1.10:51541" });
      fireEvent.click(screen.getAllByRole("button", { name: "Copy address" }).at(-1)!);
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Could not copy the address. Select it and copy it.",
      );
    },
  );
});

test("creates the QR only on request and never shows the QR of a replaced code", async () => {
  const second = Promise.withResolvers<string>();
  const encoded: string[] = [];
  const encode = spyOn(QRCode, "toDataURL").mockImplementation(async (payload) => {
    encoded.push(String(payload));
    return encoded.length === 1 ? "data:image/png;base64,first" : second.promise;
  });
  try {
    const view = show({ pairing });
    expect(encode).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Scan a QR code" }), { key: "Enter" });
    await screen.findByRole("img");
    view.update({ pairing: { code: "654321", expiresAt: "2030-01-01T00:05:00Z" } });
    expect(screen.queryByRole("img")).toBeNull();
    await act(async () => second.resolve("data:image/png;base64,second"));
    expect((await screen.findByRole("img")).getAttribute("src")).toBe(
      "data:image/png;base64,second",
    );
    expect(encoded.map((text) => JSON.parse(text))).toEqual([
      { type: "openducktor-pairing", version: 1, endpoint, code: "012345" },
      { type: "openducktor-pairing", version: 1, endpoint, code: "654321" },
    ]);
    view.update({ pairing: null });
    expect(screen.queryByRole("img")).toBeNull();
  } finally {
    second.resolve("data:image/png;base64,second");
    encode.mockRestore();
  }
});

// Uses a real deadline so parallel tests do not share a mocked clock.
test("renews an expired code while the operator watches, without showing Add device", async () => {
  const startPairing = mock(async () => state({ pairing }));
  const view = show({
    bridge: bridge({ startPairing }),
    pairing: { code: "123456", expiresAt: new Date(Date.now() + 150).toISOString() },
  });
  expect(screen.getByRole("timer").textContent).toContain("Expires in 0:01");
  await act(() => Bun.sleep(400));
  expect(startPairing).toHaveBeenCalledTimes(1);
  expect(startPairing).toHaveBeenCalledWith({ renew: true });
  // The host may close the old window first. The view keeps the old code until the new one comes.
  view.update({ pairing: null, pairingEnd: "expired" });
  expect(screen.getByRole("timer").textContent).toBe("Getting a new code...");
  expect(screen.queryByRole("button", { name: "Add device" })).toBeNull();
  view.update({ pairing });
  expect(screen.getByText("Pairing code 0 1 2 3 4 5")).toBeDefined();
  expect(startPairing).toHaveBeenCalledTimes(1);
});

test("Stop pairing and an early close show Add device at once", async () => {
  const stopPairing = mock(async () => state({}));
  const view = show({ bridge: bridge({ stopPairing }), pairing });
  fireEvent.click(screen.getByRole("button", { name: "Stop pairing" }));
  expect(screen.getByRole("button", { name: "Add device" })).toBeDefined();
  await waitFor(() => expect(stopPairing).toHaveBeenCalledTimes(1));
  view.update({ pairing: { code: "654321", expiresAt: "2030-01-01T00:05:00Z" } });
  // Five wrong codes close the window long before it expires.
  view.update({ pairing: null, pairingEnd: "refused" });
  expect(screen.getByRole("button", { name: "Add device" })).toBeDefined();
});

test("a failed Stop pairing does not stop a later renewal", async () => {
  const startPairing = mock(async () => state({ pairing }));
  const stopPairing = mock(async (): Promise<RemoteAccessState> => {
    throw new Error("Could not stop pairing. Try again.");
  });
  const view = show({ bridge: bridge({ startPairing, stopPairing }), pairing });
  fireEvent.click(screen.getByRole("button", { name: "Stop pairing" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not stop pairing");
  // Another view opens a window whose code is about to expire.
  view.update({ pairing: { code: "999999", expiresAt: new Date(Date.now() + 150).toISOString() } });
  await act(() => Bun.sleep(400));
  expect(startPairing).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("timer").textContent).toBe("Getting a new code...");
});
