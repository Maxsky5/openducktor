// The colors of a session row of the mobile app. The mobile rows share the entries of the desktop
// sidebar (nav.ts) and the rules of session-entry-presentation.ts in packages/frontend-core.
// Sources: sessionRowSurface and the title colors of session-list-model.ts in
// apps/mobile/src/features/sessions.
import type { NavEntry } from "../shell/nav";

/** The card of a row: warning while the session needs you, running blue, or the sidebar color. */
export type RowSurface = "attention" | "running" | "plain";

export function rowSurface(entry: NavEntry): RowSurface {
  if (entry.attention) return "attention";
  return entry.running ? "running" : "plain";
}

/** The title: warning while the session needs you, dimmed when it is read and settled. */
export type TitleTone = "attention" | "read" | "default";

export function titleTone(entry: NavEntry): TitleTone {
  if (entry.attention) return "attention";
  return !entry.running && !entry.unread ? "read" : "default";
}
