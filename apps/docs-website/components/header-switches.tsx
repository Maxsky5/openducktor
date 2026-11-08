"use client";
import { AppearanceSwitch } from "./appearance";
import { MotionControl } from "./motion-control";

/** The animation and appearance buttons at the end of the header. */
export function HeaderSwitches({ className }: { className?: string | undefined }) {
  return (
    <>
      <MotionControl />
      <AppearanceSwitch className={className} />
    </>
  );
}
