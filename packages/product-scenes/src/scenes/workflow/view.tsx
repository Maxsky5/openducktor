// The workflow chapter player: one tab and one session page for each step. Without JavaScript the
// panels stack under their own headings. The page styles the tabs, the headings, and the copy.
import type { ReactElement } from "react";
import type { SceneViewProps } from "../../frame/SceneFrame";
import { CHAPTERS } from "./sample";
import { STEPS } from "./steps";

const number = (index: number): string => String(index + 1).padStart(2, "0");

export function WorkflowView({ theme, ref }: SceneViewProps): ReactElement {
  return (
    <div className="wrap-wide chapters" data-chapters="workflow" data-theme={theme} ref={ref}>
      <div className="chapter-tabs" role="tablist" aria-label="Workflow steps" hidden>
        {CHAPTERS.map((chapter, index) => (
          <button
            className="chapter-tab"
            type="button"
            role="tab"
            id={`workflow-tab-${chapter.id}`}
            aria-controls={`workflow-panel-${chapter.id}`}
            aria-label={`${number(index)} ${chapter.label}`}
            aria-describedby={`workflow-text-${chapter.id}`}
            aria-selected={index === 0 ? "true" : "false"}
            tabIndex={index === 0 ? 0 : -1}
            data-chapter={chapter.id}
            key={chapter.id}
          >
            <span className="chapter-bar" aria-hidden="true">
              <i />
            </span>
            <span className="chapter-index">{number(index)}</span>
            <strong>{chapter.label}</strong>
            <span className="chapter-text" id={`workflow-text-${chapter.id}`}>
              {chapter.text}
            </span>
          </button>
        ))}
      </div>
      {CHAPTERS.map((chapter) => {
        const { Stage, Stock } = STEPS[chapter.id];
        return (
          <div
            className="chapter-panel"
            id={`workflow-panel-${chapter.id}`}
            data-chapter-panel={chapter.id}
            key={chapter.id}
          >
            <h3 className="chapter-heading">{chapter.label}</h3>
            <p className="chapter-copy" data-chapter-copy="">
              {chapter.text}
            </p>
            <div className="stage" data-stage="" role="img" aria-label={chapter.alt}>
              <Stage />
            </div>
            <Stock />
          </div>
        );
      })}
    </div>
  );
}
