import { expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import * as QRCode from "qrcode";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RemoteAddress } from "./remote-address";

const endpoint = "http://192.168.1.9:51541";

test("copies the host address and confirms success", async () => {
  const copy = mock(async (_value: string) => {});
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  try {
    render(<RemoteAddress endpoint={endpoint} connectedClients={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(endpoint));
    await screen.findByRole("button", { name: "Copied" });
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

test("shows the copy action again when the host address changes", async () => {
  const copy = mock(async (_value: string) => {});
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  try {
    const view = render(<RemoteAddress endpoint={endpoint} connectedClients={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await screen.findByRole("button", { name: "Copied" });
    view.rerender(<RemoteAddress endpoint="http://192.168.1.10:51541" connectedClients={1} />);
    expect(screen.getByRole("button", { name: "Copy address" })).toBeDefined();
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

test("shows a failed copy from the QR dialog inside the dialog", async () => {
  const copy = mock(async (_value: string) => {
    throw new DOMException("Clipboard access denied.", "NotAllowedError");
  });
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  const encode = spyOn(QRCode, "toDataURL").mockImplementation(
    async () => "data:image/png;base64,",
  );
  try {
    render(<RemoteAddress endpoint={endpoint} connectedClients={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    const dialog = await screen.findByRole("dialog", { name: "Host address" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy host address" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("Could not copy the address. Select the address and copy it.");
    expect(screen.getAllByRole("alert", { hidden: true })).toHaveLength(1);
  } finally {
    encode.mockRestore();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

test("opens QR inside the host dialog and returns focus when it closes", async () => {
  const image = Promise.withResolvers<string>();
  const imageUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=";
  const encode = spyOn(QRCode, "toDataURL").mockImplementation(() => image.promise);
  try {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Host connection</DialogTitle>
            <DialogDescription>Choose the host for this window.</DialogDescription>
          </DialogHeader>
          <RemoteAddress endpoint={endpoint} connectedClients={0} />
        </DialogContent>
      </Dialog>,
    );
    const showQr = screen.getByRole("button", { name: "Show QR code" });
    showQr.focus();
    fireEvent.click(showQr);
    await screen.findByRole("button", { name: "Creating QR code..." });
    expect(screen.queryByRole("dialog", { name: "Host address" })).toBeNull();
    await act(async () => {
      image.resolve(imageUrl);
    });
    const qr = await screen.findByRole("img", { name: `Host address QR code: ${endpoint}` });
    expect(qr.closest('[role="dialog"]')).not.toBeNull();
    expect(qr.getAttribute("src")).toBe(imageUrl);
    const dialog = screen.getByRole("dialog", { name: "Host address" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.activeElement === showQr).toBe(true), { timeout: 500 });
    expect(screen.getByRole("dialog", { name: "Host connection" })).toBeDefined();
  } finally {
    image.resolve(imageUrl);
    encode.mockRestore();
  }
});
