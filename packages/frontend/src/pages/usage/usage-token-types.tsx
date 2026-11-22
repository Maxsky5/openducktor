import type { UsageFigure } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { formatCompactCount, formatShare, missingReason } from "./usage-format";
import { SectionHeading } from "./usage-parts";

/** From reused context to generated output. Cache reads, most tokens, take a quiet color. */
const TOKEN_TYPES = [
  { key: "cacheRead", label: "Cache reads", color: "var(--chart-cache-read)" },
  { key: "cacheWrite", label: "Cache writes", color: "var(--chart-cache-write)" },
  { key: "input", label: "New input", color: "var(--chart-input)" },
  { key: "output", label: "Output", color: "var(--chart-output)" },
] as const;

/** One proportional bar of the four token types, with their values and shares. */
export function UsageTokenTypes({ figure }: { figure: UsageFigure }): ReactElement {
  const { processed } = figure.tokens;
  const types = TOKEN_TYPES.map((type) => ({
    ...type,
    value: figure.tokens[type.key],
    share: processed === 0 ? 0 : figure.tokens[type.key] / processed,
  }));
  // Without counts, or with a zero that coverage cannot confirm, there is nothing to divide.
  const missing = missingReason(figure, "tokens");
  return (
    <section aria-labelledby="usage-token-types" className="flex flex-col gap-3">
      <SectionHeading id="usage-token-types" title="Tokens by type" />
      {missing !== null ? (
        <p className="text-sm text-muted-foreground">{missing}</p>
      ) : (
        <>
          <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {types
              .filter((type) => type.share > 0)
              .map((type) => (
                <span
                  key={type.key}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  // A small type keeps a visible segment.
                  style={{ width: `${type.share * 100}%`, minWidth: 6, background: type.color }}
                />
              ))}
          </div>
          <dl className="grid max-w-3xl grid-cols-2 gap-x-8 gap-y-3 @xl:grid-cols-4">
            {types.map((type) => (
              <div key={type.key} className="flex min-w-0 flex-col gap-0.5">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    // A ring keeps a pale swatch visible on the page surface.
                    className="size-2 shrink-0 rounded-sm ring-1 ring-foreground/15"
                    style={{ background: type.color }}
                    aria-hidden="true"
                  />
                  {type.label}
                </dt>
                <dd className="flex items-baseline gap-1.5">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatCompactCount(type.value)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatShare(type.share)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">Output includes reasoning tokens.</p>
        </>
      )}
    </section>
  );
}
