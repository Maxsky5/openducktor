import { useMemo, useState } from "react";
import type { DocumentRow } from "../documents/document-rows";

/** A card of the task details that its header opens and closes. */
export type DetailsSectionKey = "description" | "sessions" | "work" | "metadata";

/** The rows of the details list. The description blocks are rows, so a long text scrolls well. */
export type DetailsRow =
  | { kind: "summary"; key: "summary" }
  | { kind: "notices"; key: "notices" }
  | { kind: "sessions"; key: "sessions" }
  | { kind: "work"; key: "work" }
  | { kind: "metadata"; key: "metadata" }
  | DocumentRow;

export const detailsRowKey = (row: DetailsRow): string => row.key;
export const detailsRowType = (row: DetailsRow): string =>
  row.kind === "doc_block" ? row.block.route : row.kind;

/**
 * The rows of the task details: the summary, unless a low window shows it in its own pane, the
 * notices, the description, the sessions, the work views, and the metadata at the end. A closed description keeps only its header row.
 */
export const buildTaskDetailsRows = ({
  summaryInList,
  descriptionRows,
  collapsed,
}: {
  summaryInList: boolean;
  descriptionRows: readonly DocumentRow[];
  collapsed: ReadonlySet<DetailsSectionKey>;
}): DetailsRow[] => [
  ...(summaryInList ? [{ kind: "summary", key: "summary" } as const] : []),
  { kind: "notices", key: "notices" },
  ...(collapsed.has("description")
    ? descriptionRows.filter((row) => row.kind === "doc_header")
    : descriptionRows),
  { kind: "sessions", key: "sessions" },
  { kind: "work", key: "work" },
  { kind: "metadata", key: "metadata" },
];

const NO_SECTIONS: ReadonlySet<DetailsSectionKey> = new Set();

type SectionToggles = { readonly [Key in DetailsSectionKey]: () => void };

/** The closed cards of one details view, and the toggle of each card. */
export type CollapsedDetailsSections = {
  collapsed: ReadonlySet<DetailsSectionKey>;
  /** Each toggle keeps its identity, so a memoized card renders only for its own changes. */
  toggles: SectionToggles;
};

/** The closed cards of one details view. They open again when the view leaves. */
export const useCollapsedDetailsSections = (): CollapsedDetailsSections => {
  const [collapsed, setCollapsed] = useState(NO_SECTIONS);
  const [toggles] = useState((): SectionToggles => {
    const toggle = (key: DetailsSectionKey) => () =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    return {
      description: toggle("description"),
      sessions: toggle("sessions"),
      work: toggle("work"),
      metadata: toggle("metadata"),
    };
  });
  return useMemo(() => ({ collapsed, toggles }), [collapsed, toggles]);
};
