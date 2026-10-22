import { SquareDashedMousePointer } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SentBrowserAnnotation } from "./browser-annotation-message";

const MAX_NAME = 40;

/** Everyday words for the kinds of elements, by role or by tag. */
const ELEMENT_WORDS = new Map([
  ["a", "link"],
  ["link", "link"],
  ["button", "button"],
  ["img", "image"],
  ["image", "image"],
  ["input", "field"],
  ["textarea", "field"],
  ["textbox", "field"],
  ["select", "menu"],
  ["combobox", "menu"],
  ["p", "text"],
  ["paragraph", "text"],
  ["h1", "heading"],
  ["h2", "heading"],
  ["h3", "heading"],
  ["h4", "heading"],
  ["h5", "heading"],
  ["h6", "heading"],
  ["heading", "heading"],
  ["li", "list item"],
  ["listitem", "list item"],
  ["ul", "list"],
  ["ol", "list"],
  ["list", "list"],
  ["nav", "navigation"],
  ["navigation", "navigation"],
  ["form", "form"],
  ["table", "table"],
  ["svg", "icon"],
]);

/** The browser annotations of a sent message: one chip for each, with its details on hover. */
export function BrowserAnnotationMessageChips({
  annotations,
}: {
  annotations: readonly SentBrowserAnnotation[];
}): ReactElement {
  return (
    <TooltipProvider>
      <ul aria-label="Browser annotations" className="flex flex-wrap gap-1.5">
        {annotations.map((annotation) => (
          <li key={annotation.number} className="min-w-0 max-w-full">
            <BrowserAnnotationMessageChip annotation={annotation} />
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}

function BrowserAnnotationMessageChip({
  annotation,
}: {
  annotation: SentBrowserAnnotation;
}): ReactElement {
  const element = describeElement(annotation);
  const page = annotation.pageUrl.replace(/^https?:\/\//, "");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="secondary"
          tabIndex={0}
          aria-label={`Browser annotation ${annotation.number}: ${annotation.comment}. ${element} on ${page}`}
          className="inline-flex h-6 max-w-64 items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 text-xs font-medium text-sky-900 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100"
          data-testid="browser-annotation-message-chip"
        >
          <SquareDashedMousePointer className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{annotation.comment}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="flex flex-col gap-1">
          <p className="line-clamp-6 whitespace-pre-wrap font-medium">{annotation.comment}</p>
          <p className="opacity-80">
            {element} on {page}
          </p>
          {annotation.source ? (
            <p className="font-mono opacity-80">{fileLine(annotation.source)}</p>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** The first element in everyday words, for example `“Save” button`. */
const describeElement = (annotation: SentBrowserAnnotation): string => {
  const { tag, name, role } = annotation.element;
  const word = ELEMENT_WORDS.get(role) ?? ELEMENT_WORDS.get(tag) ?? "element";
  const shortName = name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
  const element = name
    ? `“${shortName}” ${word}`
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  const others = annotation.elementCount - 1;
  return others > 0 ? `${element} and ${others} more` : element;
};

/** `src/app/page.tsx:12:5` shows as `page.tsx:12`. */
const fileLine = (source: string): string => {
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(source);
  const path = match?.[1] ?? source;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return match ? `${name}:${match[2]}` : name;
};
