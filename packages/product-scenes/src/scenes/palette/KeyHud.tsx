// The keys that the visitor presses during the palette scene. This is site UI over the product
// view, like the pointer: the product shows no such overlay. The timeline fills it.
import type { ReactElement } from "react";
import { flag } from "../../replicas/flag";
import "./KeyHud.css";

type KeyHudProps = {
  /** The keys sit at the bottom right of the stage, clear of the palette in a short stage. */
  end?: boolean;
};

export function KeyHud({ end = false }: KeyHudProps): ReactElement {
  return <div className="key-hud" hidden aria-hidden="true" data-keys="" data-end={flag(end)} />;
}
