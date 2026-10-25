import { SESSION_GROUP_LABELS } from "@openducktor/frontend-core/sessions/navigation/session-navigation-entry-labels";
import type { SessionNavigationGroupId } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { Fragment, type ReactElement } from "react";
import { type DimensionValue, ScrollView } from "react-native";
import { SkeletonFrame } from "@/ui/placeholders";
import { SessionGroupHeaderPlaceholder } from "./session-group-header";
import { SessionRowPlaceholder } from "./session-row";

type PlaceholderRow = {
  id: string;
  task: boolean;
  workspace: DimensionValue;
  title: DimensionValue;
};

/**
 * The groups of the list with a usual mix of task and chat rows, and text widths that change from
 * row to row as real workspace names and titles do. Recent shows when it has rows.
 */
const GROUPS: readonly { id: SessionNavigationGroupId; rows: readonly PlaceholderRow[] }[] = [
  { id: "needs_you", rows: [{ id: "row-1", task: true, workspace: "34%", title: "72%" }] },
  { id: "running", rows: [{ id: "row-2", task: true, workspace: "26%", title: "58%" }] },
  {
    id: "recent",
    rows: [
      { id: "row-3", task: true, workspace: "40%", title: "84%" },
      { id: "row-4", task: false, workspace: "30%", title: "64%" },
      { id: "row-5", task: true, workspace: "34%", title: "78%" },
      { id: "row-6", task: false, workspace: "26%", title: "52%" },
      { id: "row-7", task: false, workspace: "40%", title: "68%" },
      { id: "row-8", task: true, workspace: "30%", title: "74%" },
    ],
  },
];

/**
 * The Sessions list for its first load, in the layout of the loaded list: the scope control, the
 * group headers, and the row cards. The list then takes the place of each part without a move.
 */
export function SessionListSkeleton({ header }: { header: ReactElement | null }): ReactElement {
  return (
    <ScrollView scrollEnabled={false} contentInsetAdjustmentBehavior="automatic">
      {header}
      <SkeletonFrame label="Loading sessions">
        {GROUPS.map((group) => (
          <Fragment key={group.id}>
            <SessionGroupHeaderPlaceholder
              groupId={group.id}
              label={SESSION_GROUP_LABELS[group.id]}
            />
            {group.rows.map((row) => (
              <SessionRowPlaceholder
                key={row.id}
                task={row.task}
                workspaceWidth={row.workspace}
                titleWidth={row.title}
              />
            ))}
          </Fragment>
        ))}
      </SkeletonFrame>
    </ScrollView>
  );
}
