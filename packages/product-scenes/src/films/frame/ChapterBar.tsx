// The chapter bar of a film, under the captions. Each chapter has its number, its name, and a bar
// that fills while it plays.
import type { ReactElement } from "react";
import "./ChapterBar.css";

export function ChapterBar({ chapters }: { chapters: readonly string[] }): ReactElement {
  return (
    <ol className="film-chapters" data-film-chapters="">
      {chapters.map((chapter, index) => (
        <li className="film-chapter" data-film-chapter="" data-current="false" key={chapter}>
          <span className="film-chapter-label">
            <b>{String(index + 1).padStart(2, "0")}</b>
            {chapter}
          </span>
          <span className="film-chapter-track">
            <i data-film-chapter-fill="" />
          </span>
        </li>
      ))}
    </ol>
  );
}
