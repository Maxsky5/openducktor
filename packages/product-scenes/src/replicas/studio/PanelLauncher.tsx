// The Open a tab launcher of session-panel-launcher.tsx: one card for each tab kind that a panel
// can open now, with the label and the description of panel-tab-kinds.ts. A New tab shows it. A
// scene sets `data-hover` on the card under the pointer.
import { ArrowRight, Globe, type LucideIcon, SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import "./PanelLauncher.css";

type LaunchKind = { id: string; label: string; description: string; icon: LucideIcon };

/** The host tab kinds, which a task panel with its tool tabs open can still open. */
export const LAUNCH_KINDS = [
  {
    id: "terminal",
    label: "Terminal",
    description: "Run commands in a new shell.",
    icon: SquareTerminal,
  },
  { id: "browser", label: "Browser", description: "Open a web page.", icon: Globe },
] as const satisfies readonly LaunchKind[];

export function PanelLauncher(): ReactElement {
  return (
    <section className="pl">
      <ul className="pl-grid">
        {LAUNCH_KINDS.map(({ id, label, description, icon: Icon }) => (
          <li className="pl-card" data-launch={id} key={id}>
            <span className="pl-icon">
              <Icon />
            </span>
            <span className="pl-text">
              <span className="pl-label">{label}</span>
              <span className="pl-description">{description}</span>
            </span>
            <ArrowRight className="pl-arrow" />
          </li>
        ))}
      </ul>
    </section>
  );
}
