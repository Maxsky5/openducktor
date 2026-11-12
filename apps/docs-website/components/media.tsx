import type { ReactNode } from "react";
import { SCREENS, type Screen, type ScreenId } from "@/assets/media";
import { ScreenPair } from "./screen-pair";
import { shotFrame } from "./shot-frame";

/** The class names that are set, joined with spaces. */
const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/**
 * A screenshot of the real app with sample data. The text in `children` shows beside a phone
 * screen on a wide page, such as the steps of that screen, and under the screenshot otherwise.
 */
export function Screenshot({
  id,
  alt,
  children,
}: {
  id: ScreenId;
  alt: string;
  children?: ReactNode;
}) {
  const screen: Screen = SCREENS[id];
  const frame = shotFrame(screen.light);
  const figure = (
    <figure className={classes("docs-shot", frame.className, "not-prose")} style={frame.style}>
      <ScreenPair light={screen.light} dark={screen.dark} alt={alt} sizes={frame.sizes} />
    </figure>
  );
  if (children === undefined) return figure;
  return (
    <div className={frame.phone ? "docs-beside" : undefined}>
      {figure}
      <div className="docs-beside-text">{children}</div>
    </div>
  );
}

/** Shows phone screenshots side by side on wide screens. */
export function ScreenRow({ children }: { children: ReactNode }) {
  return <div className="docs-shot-row not-prose">{children}</div>;
}

/** A numbered part of an annotated screenshot. `at` is the key of its box in `SCREENS[id].parts`. */
type ShotPart = { at: string; title: string; text: string };

const percent = (value: number) => `${value}%`;

/**
 * A screenshot of the real app with a numbered box around each main part, and the list of the
 * parts. The list gives the same information as text, and it shows beside a phone screen on a wide
 * page. A click opens the capture at full size without the boxes, so small text is easy to read.
 */
export function AnnotatedScreenshot({
  id,
  alt,
  parts,
}: {
  id: ScreenId;
  alt: string;
  parts: ShotPart[];
}) {
  const screen: Screen = SCREENS[id];
  const frame = shotFrame(screen.light);
  const items = parts.map((part) => {
    const box = screen.parts?.[part.at];
    if (!box) {
      throw new Error(
        `The screenshot ${id} has no part "${part.at}". Add its box to SCREENS["${id}"].parts in assets/media.ts.`,
      );
    }
    return { ...part, box };
  });
  return (
    <figure
      className={classes("docs-shot docs-annotated", frame.phone && "docs-beside", "not-prose")}
    >
      <div className={classes("docs-annotated-stage", frame.className)} style={frame.style}>
        <ScreenPair light={screen.light} dark={screen.dark} alt={alt} sizes={frame.sizes} />
        <div className="docs-part-boxes" aria-hidden="true">
          {items.map(({ at, box }, index) => (
            <span
              key={at}
              className="docs-part-box"
              style={{
                left: percent(box.x),
                top: percent(box.y),
                width: percent(box.w),
                height: percent(box.h),
              }}
            >
              <span className="docs-part-pin">{index + 1}</span>
            </span>
          ))}
        </div>
      </div>
      <ol className="docs-annotated-parts">
        {items.map((part, index) => (
          <li key={part.at}>
            <span className="docs-part-pin" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <p className="docs-part-title">{part.title}</p>
              <p className="docs-part-text">{part.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}
