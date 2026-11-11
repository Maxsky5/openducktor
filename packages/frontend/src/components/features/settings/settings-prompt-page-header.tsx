import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode, Ref } from "react";
import { Button } from "@/components/ui/button";

/** A heading and its description, at the size of a Settings card title. */
export function ListHeading({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  description?: string;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h4 id={id} className="text-sm font-medium text-foreground">
        {title}
      </h4>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/**
 * The header of a page below the first screen: a back link to the screen that opened it, then the
 * title, in one row, so the title stays at the place of the title of the first screen.
 */
export function PromptPageHeader({
  backTitle,
  title,
  titleRef,
  aside,
  children,
  onBack,
}: {
  backTitle: string;
  title: string;
  titleRef?: Ref<HTMLHeadingElement>;
  /** Marks after the title, such as the status badges of a prompt. */
  aside?: ReactNode;
  children?: ReactNode;
  onBack: () => void;
}): ReactElement {
  return (
    <header className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label={`Back to ${backTitle}`}
          className="-ml-2 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
          {backTitle}
        </Button>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3
          ref={titleRef}
          tabIndex={-1}
          className="mr-1 text-sm font-semibold text-foreground outline-none"
        >
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </header>
  );
}
