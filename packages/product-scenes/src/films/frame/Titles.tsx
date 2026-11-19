// The title cards of a release film: the opening, with the mark, the name, the version, and a
// line next to the wall of the sets, and the closing, with the name, the version, a line, and the
// addresses of the project. engine/titles.ts moves them.
import type { ReactElement } from "react";
import { Mark } from "./Mark";
import "./Titles.css";

const NAME = "OpenDucktor";

type IntroProps = {
  version: string;
  /** The line under the version. */
  line: string;
};

export function IntroCard({ version, line }: IntroProps): ReactElement {
  return (
    <div className="film-intro" data-intro="">
      <div className="film-intro-content" data-intro-content="">
        <div className="film-intro-lockup">
          <Mark />
          <span className="film-intro-word">{NAME}</span>
        </div>
        <span className="film-intro-number">{version}</span>
        <p className="film-intro-line">{line}</p>
      </div>
    </div>
  );
}

/** An address of the closing card. */
export type OutroLink = { kind: "site" | "docs" | "github"; text: string };

type OutroProps = {
  version: string;
  line: string;
  links: readonly OutroLink[];
};

/** The icon of each kind of address: a globe, an open book, and the GitHub mark. */
function LinkIcon({ kind }: { kind: OutroLink["kind"] }): ReactElement {
  if (kind === "github") {
    return (
      <svg viewBox="0 0 24 24" className="film-outro-icon" data-fill="">
        <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
      </svg>
    );
  }
  if (kind === "docs") {
    return (
      <svg viewBox="0 0 24 24" className="film-outro-icon">
        <path d="M12 7v14" />
        <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="film-outro-icon">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function OutroCard({ version, line, links }: OutroProps): ReactElement {
  return (
    <div className="film-outro" data-outro="">
      <div className="film-outro-lockup" data-outro-lockup="">
        <Mark />
        <span className="film-outro-word">
          {NAME}
          <b>{version}</b>
        </span>
      </div>
      <p className="film-outro-line" data-outro-line="">
        {line}
      </p>
      <div className="film-outro-links">
        {links.map((link) => (
          <span className="film-outro-link" data-outro-link="" key={link.text}>
            <LinkIcon kind={link.kind} />
            {link.text}
          </span>
        ))}
      </div>
    </div>
  );
}
