import { ChevronDown, ChevronUp } from "lucide-react";
import { splitPromptTemplate } from "@openducktor/contracts";
import { PROMPT_LAYER_LABELS, type PromptLayerPart } from "@openducktor/workflows";
import {
  type ComponentProps,
  memo,
  type ReactElement,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ROW_LIST_CLASS_NAME } from "./settings-prompt-rows";

/** A built-in part longer than this many lines shows its start until the user expands it. */
const COLLAPSED_LINES = 8;

/**
 * The text of a part, with each placeholder marked, so the reader sees what OpenDucktor fills. A
 * placeholder that the prompt cannot fill is marked as an error.
 */
// The built-in part does not change while the user types an append, so it is not rendered again.
const PartText = memo(function PartText({
  text,
  placeholders,
}: {
  text: string;
  placeholders: readonly string[];
}): ReactElement {
  if (!text) return <span className="italic text-muted-foreground">(empty)</span>;
  const fillable = new Set(placeholders);
  let offset = 0;
  return (
    <>
      {splitPromptTemplate(text).map(({ text: piece, placeholder }) => {
        // The offset of a piece keys it, as the pieces of a text never move.
        const key = offset;
        offset += piece.length;
        return placeholder === undefined ? (
          <span key={key}>{piece}</span>
        ) : (
          <span
            key={key}
            className={cn(
              "rounded-sm px-0.5 font-medium",
              fillable.has(placeholder)
                ? "bg-muted text-foreground ring-1 ring-inset ring-border"
                : "bg-destructive/15 text-destructive-muted line-through",
            )}
          >
            {piece}
          </span>
        );
      })}
    </>
  );
});

/** An append part matches the Appended badge, and an override part the Overridden badge. */
const PART_BADGE_VARIANTS = {
  builtin: "outline",
  global_override: "secondary",
  repository_override: "secondary",
  global_append: "success",
  repository_append: "success",
} as const satisfies Record<PromptLayerPart["source"], ComponentProps<typeof Badge>["variant"]>;

function FinalTextPart({
  part,
  placeholders,
}: {
  part: PromptLayerPart;
  placeholders: readonly string[];
}): ReactElement {
  const isUserText = part.source !== "builtin";
  const isLong = part.text.split("\n").length > COLLAPSED_LINES;
  const [isExpanded, setIsExpanded] = useState(false);
  const isCollapsed = !isUserText && isLong && !isExpanded;
  // The control that the user clicked unmounts, so the text that replaces it takes the focus.
  const textRef = useRef<HTMLElement>(null);
  const setTextElement = (element: HTMLElement | null): void => {
    textRef.current = element;
  };
  const hasToggled = useRef(false);
  useLayoutEffect(() => {
    if (!hasToggled.current) return;
    textRef.current?.focus({ preventScroll: isExpanded });
    // The folded text is shorter, so the pane brings its start back into view.
    if (!isExpanded) textRef.current?.scrollIntoView({ block: "nearest" });
  }, [isExpanded]);
  const toggle = (expanded: boolean): void => {
    hasToggled.current = true;
    setIsExpanded(expanded);
  };
  const text = <PartText text={part.text} placeholders={placeholders} />;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3",
        // The text that the user wrote stands out from the built-in text.
        isUserText && "border-l-2 border-l-input bg-muted",
      )}
    >
      <div>
        <Badge variant={PART_BADGE_VARIANTS[part.source]}>{PROMPT_LAYER_LABELS[part.source]}</Badge>
      </div>
      {isCollapsed ? (
        // The whole preview opens the text, so the user does not have to find a small button.
        <button
          ref={setTextElement}
          type="button"
          aria-expanded={false}
          aria-label={`Show all of the ${PROMPT_LAYER_LABELS[part.source]} text`}
          className="group/expand flex w-full cursor-pointer flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => toggle(true)}
        >
          <span className="block max-h-40 overflow-hidden whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
            {text}
          </span>
          {/* Show all looks like Show less, the ghost button that folds the text again. */}
          <span className="flex justify-center">
            <span className="inline-flex h-6 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors group-hover/expand:bg-accent/60 group-hover/expand:text-foreground">
              Show all
              <ChevronDown className="size-4" aria-hidden="true" />
            </span>
          </span>
        </button>
      ) : (
        <pre
          ref={setTextElement}
          tabIndex={isExpanded ? -1 : undefined}
          className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground outline-none"
        >
          {text}
        </pre>
      )}
      {isExpanded ? (
        <div className="flex justify-center">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-expanded
            className="text-muted-foreground"
            onClick={() => toggle(false)}
          >
            Show less
            <ChevronUp aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The final text of one prompt, part by part, as the agent receives it before placeholders fill. */
export function PromptFinalText({
  parts,
  placeholders,
}: {
  parts: readonly PromptLayerPart[];
  /** The placeholders that the prompt can fill. */
  placeholders: readonly string[];
}): ReactElement {
  return (
    <section aria-label="Final text" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium text-foreground">Final text</h4>
        <p className="text-xs text-muted-foreground">
          What the agent receives. OpenDucktor fills the marked placeholders when it sends the
          prompt.
        </p>
      </div>
      <div className={cn("flex flex-col", ROW_LIST_CLASS_NAME)}>
        {parts.map((part) => (
          <FinalTextPart key={part.source} part={part} placeholders={placeholders} />
        ))}
      </div>
    </section>
  );
}
