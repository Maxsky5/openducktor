// The keys that the visitor holds during a scene, over the bottom of the window: the key caps of
// components/ui/kbd.tsx at a larger size. It is a part of the demonstration, like the pointer, so
// the app shows no such display. heldKeys of held-keys.ts fills it, and it hides when the keys go
// up. A captioned scene keeps it out, because its host shows the keys in its captions.
import type { ReactElement } from "react";
import "./Kbd.css";
import "./Keystrokes.css";

export function Keystrokes(): ReactElement {
  return (
    <span className="keystrokes" hidden aria-hidden="true" data-keystrokes="">
      <span className="ui-kbd keystrokes-tray" data-keystrokes-tray="" />
    </span>
  );
}
