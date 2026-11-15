import { CheckCircle2, CheckSquare, Circle, Square } from "lucide-react";
import type { ReactElement } from "react";

/** The mark of an option: a box for a multiple choice option, a circle for another option. */
export const QuestionOptionIcon = ({
  multiple,
  selected,
}: {
  multiple: boolean;
  selected: boolean;
}): ReactElement => {
  const className = selected ? "size-3.5 text-foreground" : "size-3.5 text-muted-foreground";
  if (multiple) {
    return selected ? <CheckSquare className={className} /> : <Square className={className} />;
  }
  return selected ? <CheckCircle2 className={className} /> : <Circle className={className} />;
};
