import { type LucideIcon, SlidersHorizontal } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { Disclosure } from "../../disclosure";
import { useEditorState } from "../editor-context";
import type { KindColor } from "../kind-styles";
import { CollapsibleCard } from "./panel-card";

/**
 * The rules that most elements do not need, closed at first. It opens by itself while one of its
 * fields has a value or a problem. A click on the title decides until the next focus request. A
 * request for one of its fields opens it, so a problem click always shows its field.
 */
export function MoreRules({
  title = "More rules",
  active,
  roots,
  description,
  Icon = SlidersHorizontal,
  color = "slate",
  inline = false,
  children,
}: {
  title?: string;
  /** One muted line under the title that tells what the group holds. */
  description?: string;
  Icon?: LucideIcon;
  color?: KindColor;
  /** A plain disclosure inside another card, instead of a card of its own. */
  inline?: boolean;
  /** One of the fields has a value or a problem. */
  active: boolean;
  /** The first parts of the field paths inside, such as `guards` or `agent`. */
  roots: readonly string[];
  children: ReactNode;
}): ReactElement {
  const focusRequest = useEditorState((state) => state.selection?.focusRequest ?? 0);
  const focusRoot = useEditorState((state) => state.selection?.fieldPath?.[0]);
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
  const [seenRequest, setSeenRequest] = useState(focusRequest);
  if (seenRequest !== focusRequest) {
    setSeenRequest(focusRequest);
    setChosenOpen(roots.includes(String(focusRoot)) ? true : null);
  }
  // Once open for a value, it stays open when the last value goes, so the panel does not jump.
  const [wasActive, setWasActive] = useState(active);
  if (active && !wasActive) setWasActive(true);
  const open = chosenOpen ?? (active || wasActive);
  if (inline)
    return (
      <Disclosure title={title} open={open} onOpenChange={setChosenOpen}>
        <div className="flex flex-col gap-4 pb-1">{children}</div>
      </Disclosure>
    );
  return (
    <CollapsibleCard
      title={title}
      description={description}
      Icon={Icon}
      color={color}
      open={open}
      onOpenChange={setChosenOpen}
    >
      {children}
    </CollapsibleCard>
  );
}

/** A titled group inside More rules, with a plain help line. */
export function RuleGroup({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="flex flex-col gap-3 border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>
        {help ? <p className="text-xs leading-5 text-muted-foreground">{help}</p> : null}
      </div>
      {children}
    </section>
  );
}
