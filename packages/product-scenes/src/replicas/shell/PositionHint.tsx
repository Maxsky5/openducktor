// PositionHint of features/shortcuts/position-hint.tsx: one key cap with the shortcut of a session
// or a workspace position. It is hidden until the window has `data-hints`, while the visitor holds
// Mod, and then it shows at once, as position-hints.css shows it. positionHint of nav.ts gives the
// text.
import type { ReactElement } from "react";
import { classes } from "../classes";
import { Kbd } from "../ui/Kbd";
import "./PositionHint.css";

export function PositionHint({
  text,
  className,
}: {
  text: string;
  className?: string;
}): ReactElement {
  return <Kbd keys={[text]} className={classes("position-hint", className)} />;
}
