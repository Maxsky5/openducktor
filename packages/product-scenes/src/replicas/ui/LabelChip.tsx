// A task label of task-label-chip.tsx: the tag icon and the name in a muted pill.
import { Tag } from "lucide-react";
import type { ReactElement } from "react";
import "./LabelChip.css";

export function LabelChip({ name }: { name: string }): ReactElement {
  return (
    <span className="label-chip">
      <Tag className="i12" />
      {name}
    </span>
  );
}
