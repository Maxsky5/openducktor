// IconTile of kind-theme.tsx in packages/frontend/src/features/workflows/editor: an icon on the
// soft tint of its colour, with the colours of KIND_TILE_CLASSES in kind-styles.ts. The editor
// shows the kind of each element, section, and card with it.
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import "./IconTile.css";

/** KindColor of kind-styles.ts: the colour family of a kind of element. */
export type KindColor =
  | "slate"
  | "violet"
  | "sky"
  | "amber"
  | "emerald"
  | "indigo"
  | "rose"
  | "teal";

type IconTileProps = {
  Icon: LucideIcon;
  color: KindColor;
  /** sm: size-6 rounded-md, md: size-8 rounded-lg, lg: size-10 rounded-xl. */
  size?: "sm" | "md" | "lg";
};

export function IconTile({ Icon, color, size = "md" }: IconTileProps): ReactElement {
  return (
    <span className="wfe-tile" data-color={color} data-size={size}>
      <Icon />
    </span>
  );
}
