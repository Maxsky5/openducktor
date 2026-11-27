// A text of the Usage page that changes with the metric: its words for each metric. The page shows
// the words of its metric, and a text with the same words for both metrics does not change.
import type { ReactElement } from "react";
import "./MetricText.css";

export function MetricText({ tokens, cost }: { tokens: string; cost: string }): ReactElement {
  if (tokens === cost) return <>{tokens}</>;
  return (
    <>
      <span data-metric-text="tokens">{tokens}</span>
      <span data-metric-text="cost">{cost}</span>
    </>
  );
}
