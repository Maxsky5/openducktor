import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { SceneBuilder } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { finger } from "../../replicas/mobile/finger";
import { screens } from "../../replicas/mobile/screens";
import { toast } from "../../replicas/mobile/toast";
import { remotePairing } from "../../replicas/settings/remote-pairing";
import { pointer } from "../../replicas/shell/cursor";
import { expiry, OPENED_LEFT } from "./sample";

/** Seconds that the camera takes to bring the QR code into the viewfinder. */
const CAMERA = 1.5;

/** Seconds that the app takes to connect after the scan. */
const CONNECT = 1.4;

/**
 * The visitor pairs the phone with the host. On the computer, Add device opens the pairing window,
 * and Scan a QR code shows the QR code. On the phone, Scan QR code opens the camera, and the code
 * comes into the viewfinder. The app reads it, closes the camera, fills the address and the code,
 * and connects at once. It shows the toast and opens the Sessions tab, and the computer shows
 * Device paired. A phone stage hides the computer, so the phone part plays alone. The markup holds
 * the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const desktop = remotePairing(scene, root);
  const cursor = pointer(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const setup = phone.screen("setup");
  const form = must(setup, "[data-host-step]");
  const scan = phone.screen("scan");
  const view = must(scan, "[data-camera-view]");
  const connectedToast = toast(scene, root, "connected");
  const countdowns = [...root.querySelectorAll<HTMLElement>(".rc-expiry")];
  // A phone stage hides the computer, so its steps run on time without the pointer.
  const narrow = getComputedStyle(must(root, ".mob-stage-lead")).display === "none";
  const click = (find: () => HTMLElement, at: number, travel = 0.9): number =>
    narrow ? at + travel : cursor.click(find, at, travel);

  // Start: Remote control is on with no device, and the phone has no host.
  desktop.reset();
  phone.only("setup");
  form.dataset.hostStep = "address";

  // The code counts down from its full lifetime while the window is open.
  const tick = (seconds: number, at: number): void =>
    scene.at(at, () => {
      const { text, left } = expiry(seconds);
      for (const countdown of countdowns) {
        must(countdown, "span:last-child").textContent = `Expires in ${text}`;
        must(countdown, "i").style.width = `${left}%`;
      }
    });

  // On the computer, Add device opens the window, and Scan a QR code shows the code.
  const added = click(() => desktop.addDevice, 0.5);
  desktop.open(added);
  const qr = click(() => desktop.trigger("qr"), added + 1.2, 0.7);
  desktop.select("qr", qr);
  cursor.hide(qr + 0.6);
  for (let second = 0; second < 9; second += 1) tick(OPENED_LEFT - second, added + second);

  // On the phone, Scan QR code opens the camera, and the visitor points it at the code. A phone
  // stage shows no computer, so the phone starts at once.
  const tapped = tap(() => must(setup, "[data-scan]"), narrow ? 1 : qr + 0.9);
  phone.bar("light", tapped);
  const camera = phone.push("setup", "scan", tapped);
  scene.at(camera, () => {
    // The QR code is an SVG element in the center of the screen of the computer, so the scene
    // measures the screen.
    const code = must(view, "[data-camera-screen]");
    const finder = must(scan, "[data-viewfinder]");
    const from = offsetIn(code, scan);
    const to = offsetIn(finder, scan);
    const x = to.x + finder.offsetWidth / 2 - (from.x + code.offsetWidth / 2);
    const y = to.y + finder.offsetHeight / 2 - (from.y + code.offsetHeight / 2);
    scene.run(
      gsap.fromTo(
        view,
        { x: x + 70, y: y + 110, rotation: -7, scale: 0.86 },
        { x, y, rotation: 0, scale: 1.04, duration: CAMERA, ease: EASE.move },
      ),
    );
  });

  // The code stays in the viewfinder for a moment. The app reads it and closes the camera. The
  // form fills the address and the code and connects.
  const read = camera + CAMERA + 0.3;
  phone.bar("dark", read);
  const closed = phone.pop("scan", "setup", read);
  scene.at(read + 0.1, () => {
    form.dataset.hostStep = "pairing";
  });

  // The host takes the code: the computer shows Device paired, and the phone opens its sessions
  // with the toast.
  const connected = closed + CONNECT;
  desktop.paired(connected);
  const opened = phone.replace("setup", "sessions", connected);
  scene.endAt(connectedToast.show(opened) + 1.6);
};
