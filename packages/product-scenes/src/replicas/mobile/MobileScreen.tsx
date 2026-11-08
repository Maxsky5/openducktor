// One screen of the mobile app in the display of PhoneFrame.tsx. The screen starts under the status
// bar. `Screen` of apps/mobile/src/ui/screen.tsx paints the chat background, and the Sessions tab
// paints the sidebar color. screens.ts finds a screen by `data-screen` and moves it.
import type { ReactElement, ReactNode } from "react";
import { classes } from "../classes";

type MobileScreenProps = {
  /** The name that screens.ts uses to find the screen. */
  id: string;
  background?: "chat" | "sidebar" | "camera";
  /** The screen shows over the others, such as a pushed session or a full-screen modal. */
  over?: boolean;
  hidden?: boolean | undefined;
  className?: string;
  children: ReactNode;
};

export function MobileScreen({
  id,
  background = "chat",
  over = false,
  hidden,
  className,
  children,
}: MobileScreenProps): ReactElement {
  return (
    <section
      className={classes("mob-screen", className)}
      data-screen={id}
      data-background={background}
      data-layer={over ? "over" : undefined}
      hidden={hidden}
    >
      {children}
    </section>
  );
}
