import { type HostEventWireEnvelope, hostEventEnvelopeSchema } from "@openducktor/contracts";
import type { IpcRendererEvent } from "electron";
import type { ElectronHostEventSubscription } from "../shared/electron-bridge-contract";
import {
  electronHostEventChannel,
  electronHostEventEnvelopeChannel,
} from "../shared/electron-host-event-channel";

export type ElectronHostEventWireEnvelope = HostEventWireEnvelope;
export type ElectronHostEventListener = (
  event: IpcRendererEvent,
  envelope: ElectronHostEventWireEnvelope,
) => void;
type ElectronHostEventIpcRenderer = {
  off(channel: string, listener: ElectronHostEventListener): void;
  on(channel: string, listener: ElectronHostEventListener): void;
};

type ElectronHostEventRoute = {
  handleEvent: ElectronHostEventListener;
  subscriptions: Set<ElectronHostEventSubscription>;
};
const routesByRenderer = new WeakMap<
  ElectronHostEventIpcRenderer,
  Map<string, ElectronHostEventRoute>
>();

export function subscribeElectronHostEvent(
  ipcRenderer: ElectronHostEventIpcRenderer,
  ...subscription: ElectronHostEventSubscription
): () => void {
  const ipcChannel =
    subscription[0] === "openducktor://agent-session-live-event"
      ? electronHostEventChannel(subscription[0], subscription[2])
      : electronHostEventChannel(subscription[0]);
  let routes = routesByRenderer.get(ipcRenderer);
  if (!routes) {
    routes = new Map();
    routesByRenderer.set(ipcRenderer, routes);
  }
  let route = routes.get(ipcChannel);
  if (!route) {
    const subscriptions = new Set<ElectronHostEventSubscription>();
    const handleEvent: ElectronHostEventListener = (_event, envelope) => {
      const parsed = hostEventEnvelopeSchema.safeParse(envelope);
      if (!parsed.success) {
        console.error("Received invalid host event from Electron main process.", {
          issues: parsed.error.issues,
        });
        return;
      }
      const hostEvent = parsed.data;
      if (electronHostEventEnvelopeChannel(hostEvent) !== ipcChannel) {
        console.error("Received host event on the wrong Electron IPC channel.");
        return;
      }
      // oxlint-disable-next-line unicorn/no-useless-spread -- preserve EventEmitter dispatch order when callbacks change subscriptions
      for (const active of [...subscriptions]) {
        if (hostEvent.channel === "openducktor://run-event") {
          if (active[0] === hostEvent.channel) active[1](hostEvent.payload);
        } else if (hostEvent.channel === "openducktor://dev-server-event") {
          if (active[0] === hostEvent.channel) active[1](hostEvent.payload);
        } else if (active[0] === hostEvent.channel) {
          active[1](hostEvent.payload);
        }
      }
    };
    route = { handleEvent, subscriptions };
    routes.set(ipcChannel, route);
    ipcRenderer.on(ipcChannel, handleEvent);
  }
  route.subscriptions.add(subscription);

  return () => {
    if (!route.subscriptions.delete(subscription) || route.subscriptions.size > 0) return;
    ipcRenderer.off(ipcChannel, route.handleEvent);
    routes.delete(ipcChannel);
    if (routes.size === 0) routesByRenderer.delete(ipcRenderer);
  };
}
