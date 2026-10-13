import { expect, mock, test } from "bun:test";
import { act } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import { HostConnectionProvider, HostSwitcher } from "./host-connection";

test("keeps all host actions in the modal footer", () => {
  const view = render(
    <HostConnectionProvider
      selection={{
        target: { kind: "remote", endpoint: "https://host.test" },
        localHost: "web",
        select: async () => {},
        disconnect: async () => {},
      }}
      connection={undefined}
    >
      <HostSwitcher />
    </HostConnectionProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Host connection: host.test" }));
  const footer = view.queryByRole("group", { name: "Connection actions" });
  expect(footer).not.toBeNull();
  for (const name of ["Cancel", "Switch host", "Disconnect", "Use web runner"]) {
    expect(footer?.contains(view.getByRole("button", { name }))).toBe(true);
  }
});

test("Cancel keeps the current host and returns keyboard focus to the rail control", async () => {
  const select = mock(async (_endpoint: string | null) => {});
  const disconnect = mock(async () => {});
  const view = render(
    <HostConnectionProvider
      selection={{ target: { kind: "local" }, localHost: "web", select, disconnect }}
      connection={undefined}
    >
      <HostSwitcher />
    </HostConnectionProvider>,
  );
  const control = view.getByRole("button", { name: "Host connection: Web runner host" });
  control.focus();
  fireEvent.click(control);
  expect(view.getByText("Web runner host")).toBeDefined();
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(document.activeElement === control).toBe(true), { timeout: 500 });
  expect(select).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
});

test("starts host work only after connection and keeps host selection in navigation", async () => {
  let state: RemoteConnectionState = { status: "connecting", generation: 1 };
  let notify = (_state: RemoteConnectionState) => {};
  const mount = mock(() => {});
  function Work() {
    mount();
    return (
      <nav aria-label="App controls">
        <HostSwitcher />
      </nav>
    );
  }
  const view = render(
    <HostConnectionProvider
      selection={{
        target: { kind: "remote", endpoint: "https://host.test" },
        localHost: null,
        select: async () => {},
        disconnect: async () => {},
      }}
      connection={{
        readState: () => state,
        subscribeState: (listener) => {
          notify = listener;
          return () => {};
        },
        retry: async () => {},
      }}
    >
      <Work />
    </HostConnectionProvider>,
  );
  expect(view.getByRole("heading", { name: "Connecting to host" })).toBeDefined();
  expect(mount).not.toHaveBeenCalled();
  await act(async () => {
    state = { status: "connected", generation: 1 };
    notify(state);
  });
  const control = view.getByRole("button", { name: "Host connection: host.test" });
  expect(control.closest("nav")?.getAttribute("aria-label")).toBe("App controls");
  fireEvent.click(control);
  expect(view.getByRole("dialog", { name: "Host connection" })).toBeDefined();
  expect(view.queryByRole("button", { name: "Use web runner" })).toBeNull();
});

test("the host picker stays usable while the current host connection changes", async () => {
  let state: RemoteConnectionState = { status: "synchronizing", generation: 1 };
  let notify = (_state: RemoteConnectionState) => {};
  const select = mock(async (_endpoint: string | null) => {});
  const view = render(
    <HostConnectionProvider
      selection={{
        target: { kind: "remote", endpoint: "https://host.test/remote" },
        localHost: "web",
        select,
        disconnect: async () => {},
      }}
      connection={{
        readState: () => state,
        subscribeState: (listener) => {
          notify = listener;
          return () => {};
        },
        retry: async () => {},
      }}
    >
      <button type="button">Send work</button>
    </HostConnectionProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Choose another host" }));
  await waitFor(
    () =>
      expect(
        view
          .getAllByRole("dialog", { hidden: true })
          .filter((dialog) => dialog.getAttribute("aria-hidden") === "false"),
      ).toHaveLength(1),
    { timeout: 500 },
  );
  await act(async () => {
    state = { status: "disconnected", generation: 2 };
    notify(state);
  });
  expect(view.getByRole("dialog", { name: "Host connection" })).toBeDefined();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Use web runner" }));
  });
  expect(select).toHaveBeenCalledWith(null);
});
