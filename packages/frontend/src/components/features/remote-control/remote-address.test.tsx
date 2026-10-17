import { expect, mock, test } from "bun:test";
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

test("opens QR inside the host dialog and returns focus when it closes", async () => {
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
  const qr = await screen.findByRole("img", { name: `Host address QR code: ${endpoint}` });
  expect(qr.closest('[role="dialog"]')).not.toBeNull();
  expect(qr.getAttribute("src")).toStartWith("data:image/png;base64,");
  const dialog = screen.getByRole("dialog", { name: "Host address" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.activeElement === showQr).toBe(true), { timeout: 500 });
  expect(screen.getByRole("dialog", { name: "Host connection" })).toBeDefined();
});
