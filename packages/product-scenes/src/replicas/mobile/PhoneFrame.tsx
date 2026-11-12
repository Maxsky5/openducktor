// An Android phone that runs the mobile app of apps/mobile, as the screenshots of the documentation
// show it: a thin black bezel, a display 411 dp wide in the 9:20 ratio, and the Android status bar
// with the time 9:41 at the left and the Wi-Fi and battery icons at the right. The screenshots
// crop the navigation bar, so the display has no gesture bar and no bottom inset. One design pixel
// is one dp of the phone. The screens are layers of the display, and screens.ts moves them. The
// overlay holds the parts over every screen, such as a toast or the touch of a finger.
import type { ReactElement, ReactNode } from "react";
import { classes } from "../classes";
import "./PhoneFrame.css";

type PhoneFrameProps = {
  /** The screens of the app, as `MobileScreen` layers. */
  children: ReactNode;
  /** The parts over every screen, such as `MobileToast` and `Touch`. */
  overlay?: ReactNode;
  /**
   * The color of the status bar icons: dark over a light screen, or light over the camera. The
   * dark theme makes them light. A scene changes `data-bar` of the display.
   */
  bar?: "dark" | "light";
  className?: string;
};

/** The Wi-Fi and battery icons of the Android status bar, in dp. */
function SystemIcons(): ReactElement {
  return (
    <svg className="mob-system" viewBox="0 0 49.2 13.2" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M1.2 3.9a11.5 11.5 0 0 1 13.6 0" />
        <path d="M3.4 7.1a8.9 8.9 0 0 1 9.2 0" />
      </g>
      <circle cx="8" cy="11.3" r="1.4" fill="currentColor" />
      <rect x="22.3" y="0" width="24" height="13.2" rx="4" fill="currentColor" />
      <rect x="47.4" y="3.5" width="1.8" height="5.7" rx="0.6" fill="currentColor" />
    </svg>
  );
}

export function PhoneFrame({
  children,
  overlay,
  bar = "dark",
  className,
}: PhoneFrameProps): ReactElement {
  return (
    <div className={classes("mob-phone", className)} data-phone="">
      <div className="mob-display" data-bar={bar} data-display="">
        {children}
        <div className="mob-status">
          <span className="mob-clock">9:41</span>
          <SystemIcons />
        </div>
        {overlay}
      </div>
    </div>
  );
}
