import type { BrowserClientMessage, BrowserServerMessage } from "@openducktor/contracts";
import { Effect } from "effect";
import type { BrowserAnchorBoxes } from "./browser-host-tab-session";
import type { BrowserPicker } from "./browser-picker";
import { browserServiceErrorToFailure, type BrowserServiceError } from "./browser-service-error";
import type { BrowserClientSession, BrowserClientSessionInput } from "./browser-service-types";
import type { BrowserTabService } from "./browser-tab-service";

type ConnectedClient = {
  readonly clientId: string;
  readonly send: BrowserClientSessionInput["send"];
  /** Tabs whose annotation anchor boxes this client follows. */
  readonly anchorTabs: Set<string>;
};

export type BrowserClientHubInput = {
  tabs: Pick<BrowserTabService, "live">;
  picker: Pick<BrowserPicker, "hover">;
};

/**
 * The Electron windows that show browser tabs. Each window gets its own session. The hub sends
 * agent markers and anchor boxes to the windows that need them.
 */
export const createBrowserClientHub = ({ tabs, picker }: BrowserClientHubInput) => {
  const clients = new Map<string, ConnectedClient>();

  /** Runs one client request. A failure goes back to the client as a protocol error. */
  const request = (
    client: ConnectedClient,
    tabId: string,
    effect: Effect.Effect<void, BrowserServiceError>,
  ): Effect.Effect<void> =>
    effect.pipe(
      Effect.catchTag("BrowserServiceError", (error) =>
        Effect.sync(() =>
          client.send({
            type: "protocol_error",
            tabId,
            failure: browserServiceErrorToFailure(error),
          }),
        ),
      ),
    );

  const handle = (client: ConnectedClient, message: BrowserClientMessage): Effect.Effect<void> =>
    Effect.suspend(() => {
      switch (message.type) {
        case "picker_hover":
          return request(
            client,
            message.tabId,
            picker.hover(message.tabId, message.x, message.y).pipe(
              Effect.map((target) =>
                client.send({
                  type: "picker_target",
                  tabId: message.tabId,
                  x: message.x,
                  y: message.y,
                  target,
                }),
              ),
            ),
          );
        case "anchors": {
          const host = tabs.live(message.tabId);
          if (message.anchors.length === 0) {
            client.anchorTabs.delete(message.tabId);
          } else {
            client.anchorTabs.add(message.tabId);
          }
          if (!host) {
            return Effect.void;
          }
          return request(client, message.tabId, host.setAnchors(message.anchors));
        }
        case "reveal_anchor": {
          const host = tabs.live(message.tabId);
          if (!host) {
            return Effect.void;
          }
          return request(client, message.tabId, host.revealAnchor(message.annotationId));
        }
      }
    });

  return {
    connect(input: BrowserClientSessionInput): BrowserClientSession {
      const client: ConnectedClient = {
        clientId: input.clientId,
        send: input.send,
        anchorTabs: new Set(),
      };
      clients.set(input.clientId, client);
      return {
        handle: (message) => handle(client, message),
        close: () =>
          Effect.sync(() => {
            clients.delete(input.clientId);
          }),
      };
    },
    broadcast(message: BrowserServerMessage): void {
      for (const client of clients.values()) {
        client.send(message);
      }
    },
    sendAnchorBoxes(tabId: string, boxes: BrowserAnchorBoxes): void {
      for (const client of clients.values()) {
        if (client.anchorTabs.has(tabId)) {
          client.send({ type: "anchor_boxes", tabId, boxes });
        }
      }
    },
  };
};

export type BrowserClientHub = ReturnType<typeof createBrowserClientHub>;
