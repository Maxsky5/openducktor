// UsagePageSkeleton of usage-page-skeleton.tsx: the layout of a report while the page has no data
// yet. Each block is the Skeleton of components/ui/skeleton.tsx: animate-pulse rounded-md
// bg-accent. The sizes are the classes of the app in design pixels.
import type { ComponentProps, ReactElement } from "react";
import "./UsagePageSkeleton.css";

/** One Skeleton block of `width` by `height`, or the full width without `width`. */
function Bone({
  width,
  height,
  className,
}: {
  width?: number;
  height: number;
  className?: string;
}): ReactElement {
  const size = width === undefined ? "100%" : `calc(${width} * var(--u))`;
  return (
    <span
      className={className ? `usage-bone ${className}` : "usage-bone"}
      style={{ width: size, height: `calc(${height} * var(--u))` }}
    />
  );
}

const ROWS = ["first", "second", "third"] as const;
const TYPES = ["reads", "writes", "input", "output"] as const;
const LINES = ["1", "2", "3", "4", "5"] as const;

export function UsagePageSkeleton(attributes: ComponentProps<"div">): ReactElement {
  return (
    <div className="usage-skeleton" {...attributes}>
      <div className="usage-skeleton-overview">
        <div className="usage-skeleton-side">
          <div className="usage-skeleton-total">
            <Bone width={112} height={12} />
            <Bone width={160} height={48} />
            <Bone width={144} height={14} />
          </div>
          <div className="usage-skeleton-rows">
            {ROWS.map((row) => (
              <div key={row} className="usage-skeleton-row">
                <Bone height={16} />
                <Bone width={160} height={12} className="usage-bone-indent" />
              </div>
            ))}
          </div>
        </div>
        <div className="usage-skeleton-chart">
          <Bone width={176} height={16} />
          <Bone height={260} className="usage-bone-lg" />
        </div>
      </div>
      <div className="usage-skeleton-types">
        <Bone width={112} height={16} />
        <Bone height={8} className="usage-bone-full" />
        <div className="usage-skeleton-type-grid">
          {TYPES.map((type) => (
            <div key={type} className="usage-skeleton-type">
              <Bone width={80} height={12} />
              <Bone width={96} height={20} />
            </div>
          ))}
        </div>
      </div>
      <div className="usage-skeleton-table">
        <div className="usage-skeleton-table-head">
          <Bone width={96} height={16} />
          <Bone width={208} height={36} className="usage-bone-lg" />
        </div>
        {LINES.map((line) => (
          <Bone key={line} height={44} />
        ))}
      </div>
    </div>
  );
}
