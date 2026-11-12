"use client";
import { bindMotionControl } from "@openducktor/product-scenes/motion/preference";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The header button that pauses and plays every demonstration, as on the marketing website
 * (WCAG 2.2.2). The preference module of the scenes owns the state, so the scenes follow it, and
 * it sets the label and the pressed state of the button. The button shows only while the reader
 * accepts motion. The page CSS hides it with reduced motion, so the server markup has the final
 * header and the header does not move when the page hydrates.
 */
export function MotionControl() {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    return bindMotionControl(element);
  }, []);
  return (
    <button
      ref={button}
      type="button"
      className="docs-icon-button docs-motion-control"
      aria-label="Pause animations"
      data-requires-script=""
    >
      <Pause className="docs-motion-pause" aria-hidden="true" />
      <Play className="docs-motion-play" aria-hidden="true" />
    </button>
  );
}
