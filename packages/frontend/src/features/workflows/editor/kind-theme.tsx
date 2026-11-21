import type { WorkflowElementKind } from "@openducktor/workflows";
import {
  Bot,
  CheckCheck,
  Columns3,
  FileText,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  MessageSquareText,
  MousePointerClick,
  Play,
  Radio,
  Settings2,
  Spline,
  Tag,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

/** The colour family of a kind. Every surface of the editor uses the same one. */
export type KindColor =
  | "slate"
  | "violet"
  | "sky"
  | "amber"
  | "emerald"
  | "indigo"
  | "rose"
  | "teal"
  | "fuchsia"
  | "orange";

/** A soft tint behind an icon in the strong shade, for light and dark themes. */
export const KIND_TILE_CLASSES = {
  slate: "bg-slate-500/12 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300",
  violet: "bg-violet-500/12 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
  sky: "bg-sky-500/12 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
  amber: "bg-amber-500/14 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  emerald: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  indigo: "bg-indigo-500/12 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300",
  rose: "bg-rose-500/12 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300",
  teal: "bg-teal-500/12 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300",
  fuchsia: "bg-fuchsia-500/12 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-300",
  orange: "bg-orange-500/12 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300",
} satisfies Record<KindColor, string>;

/** The strong shade of a colour, for a small icon without a tile. */
export const KIND_ICON_CLASSES = {
  slate: "text-slate-500 dark:text-slate-400",
  violet: "text-violet-500 dark:text-violet-400",
  sky: "text-sky-500 dark:text-sky-400",
  amber: "text-amber-500 dark:text-amber-400",
  emerald: "text-emerald-500 dark:text-emerald-400",
  indigo: "text-indigo-500 dark:text-indigo-400",
  rose: "text-rose-500 dark:text-rose-400",
  teal: "text-teal-500 dark:text-teal-400",
  fuchsia: "text-fuchsia-500 dark:text-fuchsia-400",
  orange: "text-orange-500 dark:text-orange-400",
} satisfies Record<KindColor, string>;

type KindTheme = {
  readonly Icon: LucideIcon;
  readonly color: KindColor;
  /** One plain sentence that tells what an element of the kind is. */
};

/** The icon, colour, and meaning of each element kind. */
export const KIND_THEME = {
  workflow: {
    Icon: Settings2,
    color: "slate",
  },
  issueType: { Icon: Tag, color: "teal" },
  role: {
    Icon: Bot,
    color: "emerald",
  },
  artifact: { Icon: FileText, color: "rose" },
  verdict: { Icon: CheckCheck, color: "rose" },
  state: {
    Icon: Columns3,
    color: "violet",
  },
  step: {
    Icon: ListChecks,
    color: "indigo",
  },
  launchAction: { Icon: Play, color: "indigo" },
  action: {
    Icon: MousePointerClick,
    color: "amber",
  },
  event: {
    Icon: Spline,
    color: "sky",
  },
  signal: {
    Icon: Radio,
    color: "fuchsia",
  },
  automation: {
    Icon: Play,
    color: "fuchsia",
  },
  prompt: { Icon: MessageSquareText, color: "orange" },
  actionOrder: { Icon: ListOrdered, color: "slate" },
  actionPriority: {
    Icon: ListOrdered,
    color: "slate",
  },
  launchOrder: {
    Icon: ListOrdered,
    color: "slate",
  },
} satisfies Record<WorkflowElementKind, KindTheme>;

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
