import { expect, mock, test } from "bun:test";
import { act } from "react";
import { toast } from "sonner";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import { RemoteConnectionBoundary } from "./remote-connection-boundary";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

test("blocks work until synchronization finishes and exposes the connection failure action", async () => {
  let state: RemoteConnectionState = { status: "synchronizing", generation: 1 };
  let notify = (_state: RemoteConnectionState) => {};
  const retry = mock(async () => {});
  const connection = {
    readState: () => state,
    subscribeState: (listener: (next: RemoteConnectionState) => void) => {
      notify = listener;
      return () => {};
    },
    retry,
  };
  const tree = (open: boolean) => (
    <RemoteConnectionBoundary connection={connection}>
      <button type="button">Send work</button>
      <Sheet open={open}>
        <SheetContent>
          <SheetTitle>App diagnostics</SheetTitle>
          <SheetDescription>Check host work.</SheetDescription>
          <button type="button">Refresh diagnostics</button>
        </SheetContent>
      </Sheet>
    </RemoteConnectionBoundary>
  );
  const rendered = render(tree(false));
  expect(screen.getByText("Restoring your work from the host.")).toBeTruthy();
  expect(screen.getByText("Send work").parentElement?.hasAttribute("inert")).toBe(true);
  await act(async () => {
    state = { status: "connected", generation: 1 };
    notify(state);
  });
  expect(screen.getByText("Send work").parentElement?.hasAttribute("inert")).toBe(false);
  await act(async () => {
    state = {
      status: "failed",
      generation: 2,
      failure: {
        code: "protocol_mismatch",
        message: "Client protocol 2 does not match host protocol 1.",
        nextAction: "Update the host.",
      },
    };
    notify(state);
  });
  expect(screen.getByText("Update the host.")).toBeTruthy();
  rendered.rerender(tree(true));
  expect(screen.queryByRole("dialog", { name: "App diagnostics" }) !== null).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => {
    state = { status: "connected", generation: 2 };
    notify(state);
  });
  expect(screen.getByRole("dialog", { name: "App diagnostics" })).toBeTruthy();
});

test("keeps a failed retry busy for 500 ms and reports it outside blocked work", async () => {
  let state: RemoteConnectionState = {
    status: "disconnected",
    generation: 1,
    failure: {
      code: "transport_failure",
      message: "The host is not reachable.",
      nextAction: "Check the network and retry.",
    },
  };
  let notify = (_state: RemoteConnectionState) => {};
  const retry = mock(async () => {
    state = { ...state, status: "connecting" };
    notify(state);
    await Promise.resolve();
    state = { ...state, status: "disconnected" };
    notify(state);
    throw new Error("The host is not reachable.");
  });
  const view = render(
    <RemoteConnectionBoundary
      connection={{
        readState: () => state,
        subscribeState: (listener) => {
          notify = listener;
          return () => {};
        },
        retry,
      }}
      changeHost={() => {}}
    >
      <button type="button">Send work</button>
    </RemoteConnectionBoundary>,
  );
  try {
    const started = performance.now();
    const button = view.getByRole("button", { name: "Retry connection" });
    if (!(button instanceof HTMLButtonElement)) throw new Error("Expected a retry button.");
    await act(async () => fireEvent.click(button));
    expect(view.getByRole("button", { name: "Retrying…" })).toBe(button);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(view.queryByText("Could not reconnect to host")).toBeNull();
    await waitFor(() => expect(button.disabled).toBe(false), { timeout: 750 });
    expect(performance.now() - started).toBeGreaterThanOrEqual(500);
    const notification = await view.findByText("Could not reconnect to host");
    expect(notification.closest("[inert]")).toBeNull();
    expect(view.getByText("Send work").parentElement?.hasAttribute("inert")).toBe(true);
  } finally {
    view.unmount();
    toast.dismiss("host-connection-retry");
  }
});
