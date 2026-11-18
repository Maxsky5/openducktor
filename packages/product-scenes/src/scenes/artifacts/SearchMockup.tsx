// The page of the HTML file that the Builder saves: a wireframe of the search dialog of Fieldnotes,
// the notes app of the sample repository. The page draws the dialog in grey boxes, numbers its
// parts, and notes each part under it. The page has no dark style, so it stays a light page in both
// themes, as the app shows any page without a dark style, and it never reads as a part of the app.
import type { ReactElement } from "react";
import "./SearchMockup.css";

/** The recent notes, as grey bars. The style gives each bar its own width. */
const NOTES = ["first", "second", "third", "fourth"] as const;

/** The keys in the footer of the dialog. */
const KEYS = [
  { keys: "↑ ↓", action: "Move" },
  { keys: "↵", action: "Open" },
  { keys: "esc", action: "Close" },
] as const;

/** The notes on the numbered parts of the wireframe. */
const PARTS = [
  "Search field with the ⌘K hint.",
  "Four recent notes. The first one is selected.",
  "The keys of the dialog.",
] as const;

/** The number of a part, on the wireframe and in the notes. */
function Mark({ part }: { part: number }): ReactElement {
  return <span className="wf-mark">{part}</span>;
}

export function SearchMockup(): ReactElement {
  return (
    <div className="wf">
      <div className="wf-sheet">
        <p className="wf-head">
          <span className="wf-tag">Wireframe</span>
          Search dialog · v1
        </p>
        <div className="wf-dialog">
          <div className="wf-field">
            <span className="wf-lens" />
            <span className="wf-text">Search notes</span>
            <span className="wf-key">⌘K</span>
            <Mark part={1} />
          </div>
          <div className="wf-list">
            <p className="wf-label">Recent notes</p>
            {NOTES.map((note, index) => (
              <div className="wf-row" data-selected={index === 0 ? "" : undefined} key={note}>
                <span className="wf-icon" />
                <span className="wf-bar" />
              </div>
            ))}
            <Mark part={2} />
          </div>
          <div className="wf-foot">
            {KEYS.map(({ keys, action }) => (
              <span className="wf-hint" key={action}>
                <span className="wf-key">{keys}</span>
                {action}
              </span>
            ))}
            <Mark part={3} />
          </div>
        </div>
        <ol className="wf-notes">
          {PARTS.map((note, index) => (
            <li key={note}>
              <Mark part={index + 1} />
              {note}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
