// A caption of a film: a kicker with the chapter, a title of short lines, and a sentence under it.
// Each word of the title sits in a mask, so it can rise into view. A part of a title line between
// asterisks takes the brand color. The timeline shows the caption with `captions.show`.
import type { ReactElement } from "react";
import { flag } from "../../replicas/flag";
import "./Caption.css";

export type CaptionText = {
  id: string;
  kicker: string;
  /** The lines of the title. A part between asterisks takes the brand color. */
  title: readonly string[];
  sub: string;
};

/** The words of a title line, each with its color. */
function wordsOf(line: string): { word: string; brand: boolean }[] {
  return line.split("*").flatMap((part, index) =>
    part
      .split(" ")
      .filter((word) => word.length > 0)
      .map((word) => ({ word, brand: index % 2 === 1 })),
  );
}

export function Caption({ caption }: { caption: CaptionText }): ReactElement {
  return (
    <div className="film-caption" data-caption={caption.id}>
      <p className="film-kicker" data-kicker="">
        <i />
        {caption.kicker}
      </p>
      <h2 className="film-title">
        {caption.title.map((line) => (
          <span className="film-line" key={line}>
            {wordsOf(line).map(({ word, brand }, index) => (
              <span className="film-word" key={`${index}-${word}`}>
                <span data-word="" data-brand={flag(brand)}>
                  {word}
                </span>
              </span>
            ))}
          </span>
        ))}
      </h2>
      <p className="film-sub" data-sub="">
        {caption.sub}
      </p>
    </div>
  );
}
