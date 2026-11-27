// The small parts of usage-parts.tsx that the copied sections share: the dot of a runtime in its
// series color, and the heading of a section.
import type { ReactElement } from "react";
import type { RuntimeKind } from "../../sample/models";
import "./UsageParts.css";

export function RuntimeDot({ runtime }: { runtime: RuntimeKind }): ReactElement {
  return <span className="usage-dot" data-series={runtime} />;
}

/** SectionHeading: a title in a row of min-h-9. */
export function SectionHeading({ title }: { title: string }): ReactElement {
  return (
    <div className="usage-section-heading">
      <p className="usage-section-title">{title}</p>
    </div>
  );
}
