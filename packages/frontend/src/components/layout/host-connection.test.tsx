import { expect, mock, test } from "bun:test";
import { act } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import type { RemoteAccessBridge, RemoteAccessState } from "@openducktor/contracts";
import { QueryProvider } from "@/lib/query-provider";
import { RemoteAccessProvider } from "@/state/remote-access-provider";
import { SettingsRemoteAccessSection } from "../features/settings/settings-remote-access-section";
import { HostConnectionProvider, HostSwitcher } from "./host-connection";

test("the rail tracks local sharing and live clients through the same subscription as Settings", async () => {
  let publish = (_state: RemoteAccessState) => {};
  const snapshot = Promise.withResolvers<RemoteAccessState>();
  const stop = mock(() => {});
  const bridge: RemoteAccessBridge = {
    readState: () => snapshot.promise,
    readNetworks: async () => [],
    enable: async () => {
      throw new Error("This test uses the live state stream.");
    },
    disable: async () => {
      throw new Error("This test uses the live state stream.");
    },
    subscribeState: mock(async (listener: (state: RemoteAccessState) => void) => {
      publish = listener;
      return stop;
    }),
  };
  const selection = {
    target: { kind: "local" } as const,
    localHost: "web" as const,
    select: async () => {},
    disconnect: async () => {},
  };
  const content = (settings: boolean, remote: boolean) => (
    <QueryProvider useIsolatedClient>
      <RemoteAccessProvider bridge={bridge}>
        <HostConnectionProvider
          selection={
            remote
              ? { ...selection, target: { kind: "remote", endpoint: "https://host.test" } }
              : selection
          }
          connection={undefined}
        >
          <HostSwitcher />
          {settings ? <SettingsRemoteAccessSection /> : null}
        </HostConnectionProvider>
      </RemoteAccessProvider>
    </QueryProvider>
  );
  const view = render(content(false, false));
  const control = await view.findByRole("button", { name: "Host connection: Web runner host" });
  await act(async () => {
    publish({ status: "available", configuration: null, connectedClients: 0 });
  });
  expect(control.getAttribute("aria-label")).toContain(
    "Remote control is on. No clients connected.",
  );
  expect(control.textContent).toBe("");
  await act(async () => {
    publish({ status: "available", configuration: null, connectedClients: 2 });
  });
  expect(control.getAttribute("aria-label")).toContain("2 clients connected.");
  expect(control.getAttribute("title")).toBe(control.getAttribute("aria-label"));
  expect(control.textContent).toBe("");
  await act(async () => {
    snapshot.resolve({ status: "disabled", configuration: null, connectedClients: 0 });
    await snapshot.promise;
  });
  expect(control.getAttribute("aria-label")).toContain("2 clients connected.");
  view.rerender(content(true, false));
  await view.findByText("On");
  expect(bridge.subscribeState).toHaveBeenCalledTimes(1);
  await act(async () => {
    publish({ status: "available", configuration: null, connectedClients: 1 });
  });
  expect(control.getAttribute("aria-label")).toContain("1 client connected.");
  view.rerender(content(false, true));
  const remote = view.getByRole("button", { name: "Host connection: host.test" });
  expect(remote.textContent).toBe("");
  view.rerender(content(false, false));
  await act(async () => {
    publish({ status: "disabled", configuration: null, connectedClients: 0 });
  });
  expect(control.getAttribute("aria-label")).toBe("Host connection: Web runner host");
  expect(control.textContent).toBe("");
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

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
