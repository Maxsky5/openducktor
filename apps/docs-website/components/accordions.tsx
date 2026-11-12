"use client";
import {
  Accordion as FumadocsAccordion,
  Accordions as FumadocsAccordions,
} from "fumadocs-ui/components/accordion";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { onOpenSection, sectionId } from "@/lib/focus";

type AccordionsProps = Omit<
  ComponentProps<typeof FumadocsAccordions>,
  "type" | "value" | "defaultValue" | "onValueChange"
>;

/**
 * The Fumadocs accordions, with one item open at a time. An item with an `id` opens when the page
 * opens with its address, and when `openSection` opens it: a link to the item, or a search result.
 * After the item that closes above it stops moving, the page scrolls to the opened item.
 */
export function Accordions(props: AccordionsProps) {
  const root = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    /** Opens the item of the header `id` when this group holds it. */
    const open = (id: string | null): boolean => {
      const header = id ? document.getElementById(id) : null;
      if (!header || !root.current?.contains(header)) return false;
      setValue(header.id);
      return true;
    };
    open(sectionId(window.location.hash));
    return onOpenSection((id) => {
      const element = root.current;
      if (!element || !open(id)) return;
      // React shows the opened item before the next frame. An item that closes above it moves it
      // until the end of its animation.
      requestAnimationFrame(() => {
        void Promise.allSettled(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        ).then(() => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView()));
      });
    });
  }, []);

  return (
    <FumadocsAccordions
      ref={root}
      type="single"
      value={value}
      onValueChange={setValue}
      {...props}
    />
  );
}

/** An accordion item. An item with an `id` has the id as its value, so a link to it opens it. */
export function Accordion({ id, title, ...props }: ComponentProps<typeof FumadocsAccordion>) {
  return <FumadocsAccordion id={id} title={title} value={id ?? String(title)} {...props} />;
}
