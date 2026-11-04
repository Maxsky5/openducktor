import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RemoteAccessBridge, RemoteAccessState } from "@openducktor/contracts";
import { QueryProvider } from "@/test-utils/query-provider";
import { RemoteAccessProvider } from "@/state/remote-access-provider";
import { HostSharing } from "./host-sharing";

const configuration = {
  listenHost: "192.168.1.9",
  listenPort: 14328,
  publicEndpoint: "http://192.168.1.9:14328",
};
const off: RemoteAccessState = {
  status: "disabled",
  configuration: null,
  pairing: null,
  clients: [],
  connectedClients: 0,
};
const bridge = (initial: RemoteAccessState, overrides: Partial<RemoteAccessBridge> = {}) => {
  const operator: RemoteAccessBridge = {
    readState: async () => initial,
    readNetworks: async () => [{ name: "en0", address: "192.168.1.9" }],
    enable: async () => ({ ...off, status: "available", configuration }),
    disable: async () => off,
    revokeClient: async () => initial,
    startPairing: async () => initial,
    stopPairing: async () => initial,
    subscribeState: async () => () => {},
    ...overrides,
  };
  return operator;
};
const show = (operator: RemoteAccessBridge) =>
  render(
    <QueryProvider>
      <RemoteAccessProvider bridge={operator}>
        <HostSharing bridge={operator} />
      </RemoteAccessProvider>
    </QueryProvider>,
  );

test("turns on remote control from Host connection with the only network chosen", async () => {
  const enable = mock(async () => ({ ...off, status: "available" as const, configuration }));
  show(bridge(off, { enable }));
  const turnOn = await screen.findByRole("button", { name: "Turn on remote control" });
  await waitFor(() => expect(turnOn.hasAttribute("disabled")).toBe(false));
  // The first enable shows the network, with the only one already chosen.
  expect(screen.getByRole("radio", { name: /192.168.1.9/ }).getAttribute("aria-checked")).toBe(
    "true",
  );
  fireEvent.click(turnOn);
  await waitFor(() =>
    expect(enable).toHaveBeenCalledWith({ listenHost: "192.168.1.9", listenPort: 14328 }),
  );
  expect(await screen.findByText("Remote control is on")).toBeDefined();
});

test("asks for a network before turning on when the computer has several", async () => {
  const enable = mock(async () => ({ ...off, status: "available" as const, configuration }));
  show(
    bridge(off, {
      enable,
      readNetworks: async () => [
        { name: "en0", address: "192.168.1.9" },
        { name: "vpn", address: "100.64.0.1" },
      ],
    }),
  );
  await screen.findByRole("radiogroup", { name: "Network" });
  const turnOn = screen.getByRole("button", { name: "Turn on remote control" });
  expect(turnOn.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /100.64.0.1/ }));
  fireEvent.click(turnOn);
  await waitFor(() =>
    expect(enable).toHaveBeenCalledWith({ listenHost: "100.64.0.1", listenPort: 14328 }),
  );
});

test("lists connected devices first and removes one device with feedback", async () => {
  const removal = Promise.withResolvers<RemoteAccessState>();
  const revokeClient = mock((_clientId: string) => removal.promise);
  const clients = [
    {
      clientId: "30000000-0000-4000-8000-000000000001",
      kind: "browser" as const,
      reference: "30000000",
      status: "offline" as const,
    },
    {
      clientId: "30000000-0000-4000-8000-000000000002",
      kind: "mobile" as const,
      reference: "30000001",
      status: "connected" as const,
    },
  ];
  const on: RemoteAccessState = {
    status: "available",
    configuration,
    pairing: null,
    clients,
    connectedClients: 1,
  };
  show(bridge(on, { revokeClient }));
  const list = await screen.findByRole("list");
  expect(
    within(list)
      .getAllByRole("listitem")
      .map((row) => row.textContent),
  ).toEqual([
    expect.stringContaining("Mobile app 30000001Connected"),
    expect.stringContaining("Web browser 30000000Offline"),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Web browser 30000000" }));
  await waitFor(() => expect(revokeClient).toHaveBeenCalledWith(clients[0]!.clientId));
  expect(await screen.findByText("Removing...")).toBeDefined();
  removal.reject(new Error("Could not remove the device. Try again."));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not remove the device. Try again.",
  );
});
