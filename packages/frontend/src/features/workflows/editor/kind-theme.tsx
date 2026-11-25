import type { WorkflowElementKind } from "@openducktor/workflows";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { KIND_THEME, KIND_TILE_CLASSES, type KindColor } from "./kind-styles";

const TILE_SIZES = {
  sm: "size-6 rounded-md [&_svg]:size-3.5",
  md: "size-8 rounded-lg [&_svg]:size-4",
  lg: "size-10 rounded-xl [&_svg]:size-5",
} as const;

/** An icon on the soft tint of its colour, such as the icon of an element kind. */
export function IconTile({
  Icon,
  color,
  size = "md",
  className,
}: {
  Icon: LucideIcon;
  color: KindColor;
  size?: keyof typeof TILE_SIZES;
  className?: string;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center",
        TILE_SIZES[size],
        KIND_TILE_CLASSES[color],
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/** The icon tile of an element kind. */
export function KindTile({
  kind,
  size,
}: {
  kind: WorkflowElementKind;
  size?: keyof typeof TILE_SIZES;
}): ReactElement {
  const { Icon, color } = KIND_THEME[kind];
  return <IconTile Icon={Icon} color={color} size={size ?? "md"} />;
}
