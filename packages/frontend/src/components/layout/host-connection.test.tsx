import { expect, mock, test } from "bun:test";
import { act } from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import type { RemoteAccessBridge, RemoteAccessState } from "@openducktor/contracts";
import { QueryProvider } from "@/test-utils/query-provider";
import { ShellStateProvider } from "@/state/app-state-provider";
import { SettingsRemoteAccessSection } from "../features/settings/settings-remote-access-section";
import { HostConnectionProvider, HostSwitcher } from "./host-connection";

test("the rail, host modal, and Settings share live client counts and host addresses", async () => {
  let publish = (_state: RemoteAccessState) => {};
  const configuration = {
    listenHost: "192.168.1.9",
    listenPort: 14328,
    publicEndpoint: "http://192.168.1.9:14328",
    webOrigins: [],
  };
  const snapshot = Promise.withResolvers<RemoteAccessState>();
  const rejected = Promise.withResolvers<RemoteAccessState>();
  const disabled = Promise.withResolvers<RemoteAccessState>();
  const stop = mock(() => {});
  const bridge: RemoteAccessBridge = {
    readState: () => snapshot.promise,
    readNetworks: async () => [],
    enable: async () => {
      throw new Error("This test uses the live state stream.");
    },
    revokeClient: async () => ({
      status: "disabled",
      configuration: null,
      pairing: null,
      clients: [],
      connectedClients: 0,
    }),
    disable: mock(() => rejected.promise),
    startPairing: async () => {
      throw new Error("This test does not pair.");
    },
    stopPairing: async () => {
      throw new Error("This test does not pair.");
    },
    subscribeState: mock(async (listener: (state: RemoteAccessState) => void) => {
      publish = listener;
      return stop;
    }),
  };
  const selection = {
    target: { kind: "local" } as const,
    localHost: "web" as const,
    confirm: async (endpoint: string) => endpoint,
    select: async () => {},
    disconnect: async () => {},
  };
  const content = (settings: boolean, remote: boolean) => (
    <QueryProvider>
      <ShellStateProvider remoteAccess={bridge}>
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
      </ShellStateProvider>
    </QueryProvider>
  );
  const view = render(content(false, false));
  const control = await view.findByRole("button", { name: "Host connection: Web runner host" });
  await act(async () => {
    publish({
      status: "available",
      configuration,
      pairing: null,
      clients: [],
      connectedClients: 0,
    });
  });
  expect(control.getAttribute("aria-label")).toContain(
    "Remote control is on. No devices connected.",
  );
  expect(control.textContent).toBe("");
  fireEvent.click(control);
  const dialog = view.getByRole("dialog", { name: "Host connection" });
  fireEvent.keyDown(within(dialog).getByRole("tab", { name: "Remote control" }), {
    key: "Enter",
  });
  expect(within(dialog).getByText("No devices connected")).toBeDefined();
  // No pairing code exists until the operator adds a device.
  expect(within(dialog).queryByText(/^Pairing code \d/)).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Add device" })).toBeDefined();
  await act(async () => {
    publish({
      status: "available",
      configuration,
      pairing: null,
      clients: [],
      connectedClients: 2,
    });
  });
  expect(within(dialog).getByText("2 devices connected")).toBeDefined();
  expect(control.getAttribute("aria-label")).toContain("2 devices connected.");
  expect(control.getAttribute("title")).toBe(control.getAttribute("aria-label"));
  expect(control.textContent).toBe("");
  await act(async () => {
    snapshot.resolve({
      status: "disabled",
      configuration: null,
      pairing: null,
      clients: [],
      connectedClients: 0,
    });
    await snapshot.promise;
  });
  expect(control.getAttribute("aria-label")).toContain("2 devices connected.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  view.rerender(content(true, false));
  await view.findByText("On. 2 devices connected.");
  expect(bridge.subscribeState).toHaveBeenCalledTimes(1);
  await act(async () => {
    publish({
      status: "available",
      configuration,
      pairing: null,
      clients: [],
      connectedClients: 1,
    });
  });
  expect(control.getAttribute("aria-label")).toContain("1 device connected.");
  view.rerender(content(false, true));
  const remote = view.getByRole("button", { name: "Host connection: host.test" });
  expect(remote.textContent).toBe("");
  fireEvent.click(remote);
  expect(
    within(view.getByRole("dialog", { name: "Host connection" })).queryByRole("button", {
      name: "Copy address",
    }),
  ).toBeNull();
  expect(
    within(view.getByRole("dialog", { name: "Host connection" })).queryByRole("button", {
      name: "Disable remote control",
    }),
  ).toBeNull();
  view.rerender(content(false, false));
  fireEvent.keyDown(view.getByRole("tab", { name: "Remote control" }), { key: "Enter" });
  expect(
    within(view.getByRole("dialog", { name: "Host connection" })).getByText("1 device connected"),
  ).toBeDefined();
  fireEvent.click(view.getByRole("switch", { name: "Enable Remote Control" }));
  await view.findByText("Turning off remote control...");
  const sharingSwitch = view.getByRole("switch", { name: "Enable Remote Control" });
  expect(sharingSwitch.hasAttribute("disabled")).toBe(true);
  await act(async () => {
    rejected.reject(new Error("Could not stop sharing. Try again."));
  });
  expect((await view.findByRole("alert")).textContent).toBe("Could not stop sharing. Try again.");
  expect(sharingSwitch.hasAttribute("disabled")).toBe(false);
  bridge.disable = mock(() => disabled.promise);
  fireEvent.click(view.getByRole("switch", { name: "Enable Remote Control" }));
  await view.findByText("Turning off remote control...");
  await act(async () => {
    const next: RemoteAccessState = {
      status: "disabled",
      configuration: null,
      pairing: null,
      clients: [],
      connectedClients: 0,
    };
    publish(next);
    disabled.resolve(next);
  });
  expect(control.getAttribute("aria-label")).toBe("Host connection: Web runner host");
  expect(control.textContent).toBe("");
  expect(
    within(view.getByRole("dialog", { name: "Host connection" })).queryByRole("button", {
      name: "Add device",
    }),
  ).toBeNull();
  expect(
    await within(view.getByRole("dialog", { name: "Host connection" })).findByRole("button", {
      name: "Turn on remote control",
    }),
  ).toBeDefined();
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

test("opens remote control settings without changing the selected host", async () => {
  let openedFromRail = false;
  const openSettings = mock(() => {
    openedFromRail = document.activeElement === control;
  });
  const select = mock(async (_endpoint: string | null) => {});
  const bridge: RemoteAccessBridge = {
    readState: async () => ({
      status: "disabled",
      configuration: null,
      pairing: null,
      clients: [],
      connectedClients: 0,
    }),
    readNetworks: async () => [],
    enable: async () => {
      throw new Error("Not used by this test.");
    },
    revokeClient: async () => ({
      status: "disabled",
      configuration: null,
      pairing: null,
      clients: [],
      connectedClients: 0,
    }),
    disable: async () => {
      throw new Error("Not used by this test.");
    },
    startPairing: async () => {
      throw new Error("Not used by this test.");
    },
    stopPairing: async () => {
      throw new Error("Not used by this test.");
    },
    subscribeState: async () => () => {},
  };
  const view = render(
    <QueryProvider>
      <ShellStateProvider remoteAccess={bridge}>
        <HostConnectionProvider
          selection={{
            target: { kind: "local" },
            localHost: "electron",
            confirm: async (endpoint: string) => endpoint,
            select,
            disconnect: async () => {},
          }}
          connection={undefined}
        >
          <HostSwitcher onOpenSettings={openSettings} />
        </HostConnectionProvider>
      </ShellStateProvider>
    </QueryProvider>,
  );
  const control = view.getByRole("button", { name: "Host connection: Desktop app host" });
  control.focus();
  fireEvent.click(control);
  // Remote control opens first, because the rail control shows its status.
  await view.findByRole("button", { name: "Turn on remote control" });
  fireEvent.keyDown(view.getByRole("tab", { name: "Connect to a host" }), { key: "Enter" });
  const address = view.getByLabelText("Host address");
  if (!(address instanceof HTMLInputElement)) throw new Error("Expected a host address input.");
  fireEvent.change(address, { target: { value: "https://new-host.test" } });
  fireEvent.keyDown(view.getByRole("tab", { name: "Remote control" }), { key: "Enter" });
  fireEvent.keyDown(view.getByRole("tab", { name: "Connect to a host" }), { key: "Enter" });
  const restoredAddress = view.getByLabelText("Host address");
  if (!(restoredAddress instanceof HTMLInputElement))
    throw new Error("Expected a host address input.");
  expect(restoredAddress.value).toBe("https://new-host.test");
  fireEvent.keyDown(view.getByRole("tab", { name: "Remote control" }), { key: "Enter" });
  fireEvent.click(view.getByRole("button", { name: "Network settings" }));
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Host connection" })).toBeNull(), {
    timeout: 500,
  });
  await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1), { timeout: 500 });
  expect(openedFromRail).toBe(true);
  expect(select).not.toHaveBeenCalled();
});

test("keeps all host actions in the modal footer", () => {
  const view = render(
    <HostConnectionProvider
      selection={{
        target: { kind: "remote", endpoint: "https://host.test" },
        localHost: "web",
        confirm: async (endpoint: string) => endpoint,
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
      selection={{
        target: { kind: "local" },
        localHost: "web",
        confirm: async (endpoint: string) => endpoint,
        select,
        disconnect,
      }}
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
        confirm: async (endpoint: string) => endpoint,
        select: async () => {},
        disconnect: async () => {},
      }}
      connection={{
        readState: () => state,
        subscribeState: (listener) => {
          notify = listener;
          return () => {};
        },
        connect: async () => {},
        disconnect: async () => {},
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
        confirm: async (endpoint: string) => endpoint,
        select,
        disconnect: async () => {},
      }}
      connection={{
        readState: () => state,
        subscribeState: (listener) => {
          notify = listener;
          return () => {};
        },
        connect: async () => {},
        disconnect: async () => {},
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

test.each(["new", "returning"])(
  "pairing cancellation then picker dismissal leaves an explicit retry for the %s client",
  async (client) => {
    const hasConnected = client === "returning";
    const failure = {
      code: "authorization_required" as const,
      message: "A pairing code is required.",
      nextAction: "Enter the code shown on the host.",
    };
    let state: RemoteConnectionState = {
      status: hasConnected ? "connected" : "failed",
      generation: 1,
    };
    if (!hasConnected) state.failure = failure;
    let notify = (_state: RemoteConnectionState) => {};
    const connect = mock(async () => {});
    const disconnect = mock(async () => {
      state = { status: "idle", generation: 2 };
      notify(state);
    });
    const retry = mock(async () => {
      state = { status: "failed", generation: 3, failure };
      notify(state);
    });
    const view = render(
      <HostConnectionProvider
        selection={{
          target: { kind: "remote", endpoint: "https://host.test" },
          localHost: null,
          confirm: async (endpoint: string) => endpoint,
          select: async () => {},
          disconnect: async () => {},
        }}
        connection={{
          readState: () => state,
          subscribeState: (listener) => {
            notify = listener;
            return () => {};
          },
          connect,
          disconnect,
          retry,
        }}
      >
        <button type="button">Send work</button>
      </HostConnectionProvider>,
    );
    if (hasConnected)
      await act(async () => {
        state = { status: "failed", generation: 2, failure };
        notify(state);
      });
    expect(view.getByRole("textbox", { name: "Pairing code" })).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    const picker = await view.findByRole("dialog", { name: "Host connection" });
    if (hasConnected) fireEvent.keyDown(picker, { key: "Escape", code: "Escape" });
    else fireEvent.click(within(picker).getByRole("button", { name: "Cancel" }));
    await view.findByRole("heading", { name: "Host connection stopped" }, { timeout: 500 });
    expect(state.status).toBe("idle");
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    const button = view.getByRole("button", { name: "Retry connection" });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    await view.findByRole("textbox", { name: "Pairing code" });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  },
);
