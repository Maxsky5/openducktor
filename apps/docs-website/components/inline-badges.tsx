import type { ReactNode } from "react";
import type { LaneId } from "@/lib/lanes";
import { LanePill } from "./lane-pill";

/** A board lane or a task badge, as a colored pill: `<Status of="spec_ready" />`. */
export function Status({ of }: { of: LaneId }) {
  return <LanePill lane={of} />;
}

/** A button of the app, as a small button chip: `<Action>Start Builder</Action>`. */
export function Action({ children }: { children: ReactNode }) {
  return <span className="docs-action">{children}</span>;
}
