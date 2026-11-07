import { useRequiredTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { isKanbanTaskCreationDisabled } from "@openducktor/frontend-core/tasks/board/task-creation-availability";
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import { Activity, type ReactElement, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { returnFocusOnClose } from "@/components/ui/open-dialogs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readDevicePlatform } from "@/lib/device-platform";
import { cn } from "@/lib/utils";
import { useActiveWorkspace, useChecksState } from "@/state/app-state-provider";
import { useFeatureTourState } from "./feature-tour-context";
import { buildFeatureTourSlides } from "./feature-tour-slides";
import { TOUR_GEOMETRY_STYLE } from "./feature-tour-geometry";
import { type FeatureTourSlide, TourExplainer } from "./feature-tour-stage";
import "./feature-tour.css";

/** Where the last slide change went. The first slide of an opening shows without motion. */
type SlideDirection = "forward" | "backward";

/** The current slide, the direction of the last change, and the slides seen since the opening. */
type TourPosition = { index: number; direction: SlideDirection | null; seen: ReadonlySet<number> };

const moveTo = (current: TourPosition, index: number): TourPosition => ({
  index,
  direction: index > current.index ? "forward" : "backward",
  seen: current.seen.has(index) ? current.seen : new Set(current.seen).add(index),
});

// The hidden copies of the slide text use the same type as the visible slide.
const TITLE_CLASS_NAME = "text-xl font-semibold leading-6";
const TEXT_CLASS_NAME = "mt-2 max-w-[46rem] text-sm leading-6 text-muted-foreground";

/** The tour dialog. `FeatureTourDialogHost` loads and mounts it. */
export function FeatureTourDialog(): ReactElement {
  const { open, returnFocus, close } = useFeatureTourState();
  const [slides] = useState(() => buildFeatureTourSlides(readDevicePlatform()));
  const [position, setPosition] = useState<TourPosition>(() => ({
    index: 0,
    direction: null,
    seen: new Set([0]),
  }));
  const backRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const slideIndex = position.index;
  const direction = position.direction ?? undefined;
  const slide = slides[slideIndex];
  if (!slide) throw new Error(`The feature tour has no slide ${slideIndex + 1}.`);
  const isFirstSlide = slideIndex === 0;
  const isLastSlide = slideIndex === slides.length - 1;

  const goTo = (index: number): void => {
    if (index === slideIndex) return;
    setPosition((current) => moveTo(current, index));
  };
  const goNext = (): void => {
    if (!isLastSlide) goTo(slideIndex + 1);
  };
  const goBack = (): void => {
    if (isFirstSlide) return;
    const backHadFocus = document.activeElement === backRef.current;
    flushSync(() => setPosition((current) => moveTo(current, slideIndex - 1)));
    // Back is disabled on slide 1, so the focus moves to Next before the button loses it.
    if (slideIndex === 1 && backHadFocus) nextRef.current?.focus();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogContent
        // The dialog keeps one size. Its width follows the window height, so the picture, the
        // text, and the footer fit the window. In a shorter window the positioner scrolls it.
        className="max-h-none max-w-[min(80rem,calc((100dvh-21.5rem)*var(--t-tour-frame-aspect)+2*var(--t-tour-inset)))] gap-0 overflow-hidden p-0 [container-type:inline-size]"
        style={TOUR_GEOMETRY_STYLE}
        // The close button sits over the pictures, so it has its own surface.
        closeButton={
          <DialogClose className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-full bg-popover/90 text-muted-foreground shadow-sm ring-1 ring-border outline-none backdrop-blur-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        }
        // An outside click must not end the tour, because the tour opens by itself only once.
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          // Back is disabled on slide 1, so the first control is a stepper dot. Start on Next.
          event.preventDefault();
          nextRef.current?.focus();
        }}
        onCloseAutoFocus={returnFocusOnClose(() => returnFocus)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") goNext();
          if (event.key === "ArrowLeft") goBack();
        }}
      >
        <div className="grid shrink-0 px-5 pb-4 pt-5 sm:px-7">
          {/*
           * Hidden copies of every slide share one grid cell with the current slide. The text area
           * then has the height of the longest slide at any width, so the dialog keeps one size.
           */}
          {slides.map((entry) => (
            <div key={entry.id} aria-hidden="true" className="invisible [grid-area:1/1]">
              <p className={TITLE_CLASS_NAME}>{entry.title}</p>
              <p className={TEXT_CLASS_NAME}>{entry.text}</p>
            </div>
          ))}
          <div className="[grid-area:1/1]">
            <div aria-live="polite" aria-atomic="true">
              {/* The stepper shows the progress. Screen readers hear it with the title. */}
              <p className="sr-only">
                {slideIndex + 1} of {slides.length}
              </p>
              <DialogTitle
                key={slide.id}
                className={cn("t-tour-copy", TITLE_CLASS_NAME)}
                data-direction={direction}
              >
                {slide.title}
              </DialogTitle>
            </div>
            <DialogDescription
              key={slide.id}
              className={cn("t-tour-copy", TEXT_CLASS_NAME)}
              data-direction={direction}
            >
              {slide.text}
            </DialogDescription>
            {/* The picture is hidden from screen readers, so they get its list of parts here. */}
            {slide.explainer ? (
              <ol aria-label="Parts of the picture" className="sr-only">
                {slide.explainer.parts.map((part) => (
                  <li key={part.title}>
                    {part.title}: {part.text}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </div>
        {/*
         * Back starts the footer and the actions end it. The stepper sits in the center, and on a
         * phone it takes its own row above the buttons.
         */}
        <DialogFooter className="mt-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-5 pb-5 pt-2 sm:grid-cols-[1fr_auto_1fr] sm:px-7">
          <Button
            ref={backRef}
            type="button"
            variant="outline"
            // Slide 1 has nothing behind it, so Back keeps its place but does not show.
            className={cn("order-2 justify-self-start sm:order-1", isFirstSlide && "invisible")}
            disabled={isFirstSlide}
            onClick={goBack}
          >
            <ArrowLeft data-icon="inline-start" />
            {/* A phone row has no room for three labels, so Back keeps its label for readers. */}
            <span className="max-sm:sr-only">Back</span>
          </Button>
          <TourStepper slides={slides} currentIndex={slideIndex} onSelect={goTo} />
          <div className="order-3 flex gap-2 justify-self-end">
            {/* Next becomes Done on the last slide, so the focused button stays the same element. */}
            <Button
              ref={nextRef}
              type="button"
              variant={isLastSlide ? "outline" : "default"}
              onClick={isLastSlide ? close : goNext}
            >
              {isLastSlide ? (
                "Done"
              ) : (
                <>
                  Next
                  <ArrowRight data-icon="inline-end" />
                </>
              )}
            </Button>
            {isLastSlide ? <CreateTaskButton returnFocus={returnFocus} onClose={close} /> : null}
          </div>
        </DialogFooter>
        {/*
         * The picture area shows first, but it comes after the text and the footer in the DOM. Radix
         * `FocusScope` wraps Tab between the first and the last tabbable element of the dialog, and
         * it does not check for `inert`. Thus a sample control in a picture is never an edge.
         */}
        <div
          aria-hidden="true"
          inert
          className="t-tour-dots @container relative order-first shrink-0 overflow-hidden border-b border-border bg-background"
          // The picture area fits a frame of the scene ratio with the same inset on every side.
          style={{
            height:
              "calc((100cqw - 2 * var(--t-tour-inset)) / var(--t-tour-frame-aspect) + 2 * var(--t-tour-inset))",
          }}
        >
          {/*
           * A seen picture stays mounted while hidden, so a live scene keeps its loaded page and a
           * return shows it at once. A hidden picture has `display: none`, so the slide-in
           * animation starts again each time that the picture shows.
           */}
          {slides.map((entry, index) =>
            position.seen.has(index) ? (
              <Activity key={entry.id} mode={index === slideIndex ? "visible" : "hidden"}>
                <div className="t-tour-picture absolute inset-0" data-direction={direction}>
                  {/* The real app parts in the pictures show tooltips, which need a provider. */}
                  <TooltipProvider>
                    {entry.explainer ? <TourExplainer {...entry.explainer} /> : entry.picture}
                  </TooltipProvider>
                </div>
              </Activity>
            ) : null,
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type TourStepperProps = {
  slides: readonly FeatureTourSlide[];
  currentIndex: number;
  onSelect: (index: number) => void;
};

/** The dots of the slides. Each dot opens its slide. */
function TourStepper({ slides, currentIndex, onSelect }: TourStepperProps): ReactElement {
  return (
    <div
      role="group"
      aria-label="Tour slides"
      className="order-1 col-span-2 flex justify-center sm:order-2 sm:col-span-1"
    >
      {slides.map((entry, index) => (
        <button
          key={entry.id}
          type="button"
          aria-label={`Slide ${index + 1}: ${entry.title}`}
          aria-current={index === currentIndex ? "step" : undefined}
          // The ring sits on the dot, as the footer gives each button a tall hit area.
          className="group flex w-5 items-center justify-center outline-none"
          onClick={() => onSelect(index)}
        >
          <span
            className={cn(
              "t-tour-dot h-1.5 rounded-full ring-offset-2 ring-offset-popover group-focus-visible:ring-2 group-focus-visible:ring-ring",
              index === currentIndex
                ? "w-4 bg-primary"
                : "w-1.5 bg-muted-foreground/35 group-hover:bg-muted-foreground",
            )}
          />
        </button>
      ))}
    </div>
  );
}

type CreateTaskButtonProps = {
  returnFocus: HTMLElement | null;
  onClose: () => void;
};

/** Opens the New task form, with the rule of the sidebar New task button. */
function CreateTaskButton({ returnFocus, onClose }: CreateTaskButtonProps): ReactElement {
  const { onCreateTask } = useRequiredTaskWorkflowActions();
  const activeWorkspace = useActiveWorkspace();
  const { taskStoreCheck } = useChecksState();
  return (
    <Button
      type="button"
      disabled={isKanbanTaskCreationDisabled(activeWorkspace, taskStoreCheck)}
      onClick={() => {
        // The closed tour no longer traps the focus. The New task form then records the opener
        // of the tour, and gives the focus back to it when the form closes.
        flushSync(onClose);
        returnFocus?.focus();
        onCreateTask();
      }}
    >
      <Plus data-icon="inline-start" />
      Create task
    </Button>
  );
}
