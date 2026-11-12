type ShotKind = "phone" | "tall" | "small" | "page";

/**
 * The display of each kind: the image sizes hint, the figure class, and the widest that it shows.
 * A phone screen always shows at phone size.
 */
const SHOT_KINDS = {
  phone: { sizes: "288px", className: "docs-shot-phone", cap: null },
  tall: { sizes: "576px", className: "docs-shot-tall", cap: "36rem" },
  small: { sizes: "384px", className: "docs-shot-small", cap: "24rem" },
  page: { sizes: "(max-width: 900px) 100vw, 860px", className: undefined, cap: "100%" },
} satisfies Record<ShotKind, { sizes: string; className: string | undefined; cap: string | null }>;

function shotKind({ width, height }: { width: number; height: number }): ShotKind {
  // A phone screen is more than twice as tall as wide, and it shows at phone size.
  if (height > width * 2) return "phone";
  // A tall dialog shows narrower than the article, so it stays on one screen.
  if (height > width) return "tall";
  // A capture of one small part, such as a toast, shows at its own size, not at the article width.
  if (width <= 1000) return "small";
  return "page";
}

export type ShotFrame = {
  sizes: string;
  /** The class of the kind, or none for a page capture. */
  className: string | undefined;
  style: { maxWidth: string; marginInline: string } | undefined;
  /** A phone screen shows its text beside it on a wide page. */
  phone: boolean;
};

/**
 * The frame of a screenshot: the image sizes hint, the figure class, and the figure style. A
 * capture is at 2x, so it never shows larger than in the app.
 */
export function shotFrame(screen: { width: number; height: number }): ShotFrame {
  const kind = shotKind(screen);
  const { sizes, className, cap } = SHOT_KINDS[kind];
  const style = cap
    ? { maxWidth: `min(${cap}, ${screen.width / 2}px)`, marginInline: "auto" }
    : undefined;
  return { sizes, className, style, phone: kind === "phone" };
}
