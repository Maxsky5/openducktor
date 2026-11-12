// The Remote control section of RemoteControl.tsx: Add device opens the pairing window on the
// Enter a code tab, a tab trigger selects its tab, and a paired device closes the window, shows
// Device paired, and joins Paired devices.
import { must } from "../../motion/dom";
import { growIn, settleIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import type { PairingView } from "./PairingPanel";
import { switchStatus } from "./RemoteControl";

/** The Remote control section in `root`. */
export function remotePairing(scene: Scene, root: HTMLElement) {
  const pairing = must(root, "[data-pairing]");
  const panel = must(pairing, "[data-pairing-panel]");
  const status = must(root, "[data-switch-status]");
  const devices = must(root, "[data-devices]");
  const addDevice = must(pairing, "[data-add-device]");
  const trigger = (tab: "code" | "qr"): HTMLElement => must(panel, `[data-tab-trigger="${tab}"]`);

  /** Build time: shows the view before a pairing window, with no paired device. */
  const reset = (): void => {
    pairing.dataset.pairing = "start" satisfies PairingView;
    panel.dataset.tab = "code";
    status.textContent = switchStatus(0);
    devices.dataset.devices = "none";
  };

  /** Opens the pairing window on its Enter a code tab at `at`. */
  const open = (at: number): void =>
    scene.at(at, () => {
      pairing.dataset.pairing = "open" satisfies PairingView;
      panel.dataset.tab = "code";
      scene.run(settleIn([panel]));
    });

  /** Selects the tab `tab` at `at`. */
  const select = (tab: "code" | "qr", at: number): void =>
    scene.at(at, () => {
      panel.dataset.tab = tab;
      scene.run(
        settleIn([...panel.querySelectorAll(tab === "qr" ? ".rc-qr-tab" : ".rc-code-tab")]),
      );
    });

  /** The device pairs at `at`: the window closes and the device joins the list. */
  const paired = (at: number): void =>
    scene.at(at, () => {
      pairing.dataset.pairing = "paired" satisfies PairingView;
      status.textContent = switchStatus(1);
      devices.dataset.devices = "one";
      scene.run(settleIn([must(pairing, '[data-for="paired"]')]));
      scene.run(growIn(must(devices, ".rc-device"), 0.4));
    });

  return { addDevice, trigger, reset, open, select, paired };
}
