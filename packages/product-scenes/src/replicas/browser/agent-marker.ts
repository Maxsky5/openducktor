// The pulse of browser-agent-marker.tsx in the browser tab of a replica: a sky ring at the center
// of the element where an agent clicks, hovers, or types. The host sends the center of the element
// of the ref, and the ring grows from scale 0.5 to 1.5 while it fades out in 700 ms, ease out.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** The actions that show a marker: BrowserAgentMarkerAction in the contracts. */
export type MarkerAction = "click" | "hover" | "type";

/** The agent marker of a browser tab. */
export type AgentMarker = {
  /** Pulses on `target` for `action`. Use it only in a change of `scene.at`. */
  pulse: (target: HTMLElement, action: MarkerAction) => void;
};

/** The agent marker of the browser tab in the replica `root`. It is hidden at build time. */
export function agentMarker(scene: Scene, root: HTMLElement): AgentMarker {
  const area = must(root, "[data-bw-page]");
  const ring = must(area, "[data-bw-agent-marker]");
  ring.hidden = true;

  const pulse = (target: HTMLElement, action: MarkerAction): void => {
    const { x, y } = offsetIn(target, area);
    ring.dataset.action = action;
    ring.hidden = false;
    gsap.set(ring, { left: x + target.offsetWidth / 2, top: y + target.offsetHeight / 2 });
    scene.run(
      gsap.fromTo(
        ring,
        { scale: 0.5, opacity: 1 },
        { scale: 1.5, opacity: 0, duration: 0.7, ease: EASE.enter },
      ),
    );
  };

  return { pulse };
}
