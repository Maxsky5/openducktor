import {
  REMOTE_PAIRING_CODE_LIFETIME_MS,
  type RemoteAccessBridge,
  type RemoteAccessState,
} from "@openducktor/contracts";
import { remoteAccessQueryKey } from "@openducktor/frontend-core/queries/remote-access";
import { type QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { PairingPanel } from "@/components/features/remote-control/pairing-panel";
import { remoteControlSwitchDescription } from "@/components/features/remote-control/remote-control-status";
import { SettingsSwitchRow } from "@/components/features/settings/settings-switch-row";
import { TourMobilePhone } from "../feature-tour-mobile";
import { TOUR_PHONE_RUNNING_ROW_END, TOUR_PHONE_SIZE } from "../feature-tour-mobile-geometry";
import { createTourQueryClient } from "../feature-tour-query-client";
import { noop } from "../feature-tour-samples";
import { type FeatureTourSlide, type TourPart, TourPiece } from "../feature-tour-stage";

// Slide 7: remote control in Settings, and the mobile app that pairs with it.

const SETTINGS_WIDTH = 520;
const GAP = 64;
const HEIGHT = 628;
/** The phone fills the height of the stage. */
const PHONE_SCALE = HEIGHT / TOUR_PHONE_SIZE.height;
const PHONE_X = SETTINGS_WIDTH + GAP;
const WIDTH = PHONE_X + TOUR_PHONE_SIZE.width * PHONE_SCALE;

const PARTS: readonly TourPart[] = [
  {
    title: "Remote control",
    text: "Off by default. Turn it on in Settings, Remote control.",
    pin: { x: -4, y: 54, side: "left" },
  },
  {
    title: "Add a device",
    text: "Shows the host address and a code for one device. The code expires after 5 minutes.",
    pin: { x: -4, y: 138, side: "left" },
  },
  {
    title: "Mobile app",
    text: "Pair it with the address and the code. It lists your sessions, as the sidebar does.",
    pin: {
      x: PHONE_X + TOUR_PHONE_RUNNING_ROW_END.x * PHONE_SCALE,
      y: TOUR_PHONE_RUNNING_ROW_END.y * PHONE_SCALE,
      side: "right",
    },
  },
];

const LISTEN_HOST = "192.168.1.24";
const LISTEN_PORT = 14328;
const ENDPOINT = `http://${LISTEN_HOST}:${LISTEN_PORT}`;

/** The remote control of the host without its pairing window: on, with no paired device. */
const ENABLED_STATE: Omit<RemoteAccessState, "pairing"> = {
  status: "available",
  configuration: {
    listenHost: LISTEN_HOST,
    listenPort: LISTEN_PORT,
    publicEndpoint: ENDPOINT,
  },
  clients: [],
  connectedClients: 0,
};

/** An open pairing window with `code`, which expires `lifetimeMs` from now. */
const openPairing = (code: string, lifetimeMs: number): RemoteAccessState => ({
  ...ENABLED_STATE,
  pairing: { code, expiresAt: new Date(Date.now() + lifetimeMs).toISOString() },
});

/**
 * The lifetime of the first code: it shows part of its countdown. A tour slide stays open for much
 * less than this.
 */
const FIRST_CODE_LIFETIME_MS = 4 * 60_000 + 12_000;

const randomCode = (): string => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");

const tourOnly = (): Promise<never> =>
  Promise.reject(new Error("The tour picture changes only the pairing window."));

type TourRemoteHost = {
  bridge: RemoteAccessBridge;
  client: QueryClient;
  initialState: RemoteAccessState;
};

/**
 * The host of the picture, in memory. Its pairing window is open for a first phone. A renewal of
 * an expired code gives a new code for 5 minutes, as the host does, so the panel shows a live
 * countdown that never stops. The picture has no other control that acts.
 */
const createTourRemoteHost = (): TourRemoteHost => {
  let state = openPairing("482913", FIRST_CODE_LIFETIME_MS);
  const bridge: RemoteAccessBridge = {
    readState: async () => state,
    readNetworks: tourOnly,
    enable: tourOnly,
    disable: tourOnly,
    revokeClient: tourOnly,
    startPairing: async () => {
      state = openPairing(randomCode(), REMOTE_PAIRING_CODE_LIFETIME_MS);
      return state;
    },
    stopPairing: async () => {
      state = { ...ENABLED_STATE, pairing: null, pairingEnd: "stopped" };
      return state;
    },
    subscribeState: tourOnly,
  };
  return { bridge, client: createTourQueryClient(), initialState: state };
};

/** The Remote control section of Settings, with the real switch and pairing panel. */
function TourRemoteSettings({
  bridge,
  initialState,
}: {
  bridge: RemoteAccessBridge;
  initialState: RemoteAccessState;
}): ReactElement {
  // The key of the remote control state in Settings. The pairing panel writes each new state there.
  const { data: state } = useQuery({
    queryKey: remoteAccessQueryKey,
    queryFn: () => bridge.readState(),
    initialData: initialState,
  });
  return (
    <div className="grid content-start gap-4 p-4">
      <SettingsSwitchRow
        title="Enable Remote Control"
        description={remoteControlSwitchDescription(state, false)}
        checked
        disabled={false}
        ariaLabel="Enable Remote Control"
        onCheckedChange={noop}
      />
      <PairingPanel
        bridge={bridge}
        endpoint={ENDPOINT}
        pairing={state.pairing}
        pairingEnd={state.pairingEnd}
      />
    </div>
  );
}

function RemoteControlStage(): ReactElement {
  const [{ bridge, client, initialState }] = useState(createTourRemoteHost);
  return (
    <>
      <TourPiece x={0} y={0} width={SETTINGS_WIDTH} height={HEIGHT}>
        <QueryClientProvider client={client}>
          <TourRemoteSettings bridge={bridge} initialState={initialState} />
        </QueryClientProvider>
      </TourPiece>
      <div
        className="absolute origin-top-left"
        style={{ left: PHONE_X, top: 0, scale: PHONE_SCALE }}
      >
        <TourMobilePhone />
      </div>
    </>
  );
}

export const remoteControlSlide: FeatureTourSlide = {
  id: "remote-control",
  title: "Control it from your phone",
  text: "Your computer does the work. In Settings, turn on remote control and select Add device, then pair the OpenDucktor mobile app. Follow and answer your agents from your phone.",
  explainer: { width: WIDTH, height: HEIGHT, parts: PARTS, stage: <RemoteControlStage /> },
};
