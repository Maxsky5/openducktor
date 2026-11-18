// The keys that the visitor holds during a scene, over the bottom of the window: the key caps of
// components/ui/kbd.tsx at a larger size. It is a part of the demonstration, like the pointer, so
// the app shows no such display. held-keys.ts fills it, and it hides when the keys go up.
import type { ReactElement } from "react";
import "./Kbd.css";
import "./Keystrokes.css";

/** With `byHost`, the host shows the keys itself, such as a film in its caption column. */
export function Keystrokes({ byHost = false }: { byHost?: boolean }): ReactElement {
  return (
    <span
      className="keystrokes"
      hidden
      aria-hidden="true"
      data-keystrokes=""
      data-by-host={byHost ? "" : undefined}
    >
      <span className="ui-kbd keystrokes-tray" data-keystrokes-tray="" />
    </span>
  );
}
