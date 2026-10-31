import { motion } from "@/theme/tokens";

const ease = motion.easeOutCurve.factory();

/** What a height motion changes on screen. */
export type HeightMotionView = {
  /** Sets the height of the part, or null for the height of its content. */
  resize: (height: number | null) => void;
  /** Hides the content after it closed. */
  hide: () => void;
  /** The tallest height that the motion shows: one screen of the content can show at most. */
  limit: () => number;
};

type Phase = "idle" | "measuring" | "opening" | "closing";

/**
 * The height motion of a part that opens or closes, in `motion.fast`. Each frame gives the view
 * one height, so the view can measure its list row in the same frame. The end height of an open
 * motion is the latest content height: content can grow while it opens, such as text that
 * measures late.
 */
export class HeightMotion {
  private phase: Phase;
  /** The height that shows now. */
  private height: number;
  private content = 0;
  private frame: number | null = null;
  private view: HeightMotionView | null = null;

  /** With `from`, the content opens from that height at its first layout. */
  constructor(from: number | undefined) {
    this.phase = from === undefined ? "idle" : "measuring";
    this.height = from ?? 0;
  }

  connect(view: HeightMotionView): void {
    this.view = view;
  }

  /** The content changed size. The first layout of content that opens starts its motion. */
  measure(height: number): void {
    this.content = height;
    if (this.phase === "measuring") this.run("opening");
  }

  /** Starts the motion to the open or closed state, or stops it for a change without motion. */
  change(open: boolean, animates: boolean): void {
    if (!animates) {
      this.stop();
      this.phase = "idle";
    } else if (!open) {
      if (this.phase === "idle") this.height = this.content;
      this.run("closing");
    } else if (this.phase === "closing") {
      this.run("opening");
    } else {
      this.phase = "measuring";
      this.height = 0;
    }
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private run(phase: "opening" | "closing"): void {
    this.stop();
    this.phase = phase;
    const limit = () => this.view?.limit() ?? Number.POSITIVE_INFINITY;
    const start = Math.min(this.height, limit());
    const startedAt = Date.now();
    const step = () => {
      const end = phase === "opening" ? Math.min(this.content, limit()) : 0;
      const progress = Math.min(1, (Date.now() - startedAt) / motion.fast);
      if (progress === 1) {
        this.frame = null;
        this.finish(phase);
        return;
      }
      this.height = start + (end - start) * ease(progress);
      this.view?.resize(this.height);
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private finish(phase: "opening" | "closing"): void {
    this.phase = "idle";
    if (phase === "opening") {
      this.view?.resize(null);
      return;
    }
    this.height = 0;
    this.view?.hide();
  }
}
