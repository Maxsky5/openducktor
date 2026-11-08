// The first screen of the mobile app without a host, as app/(setup)/index.tsx in apps/mobile/src:
// the brand header with the theme control, one card that adds a host, and the app name and version
// under the card, as AppVersionFooter of src/ui/settings-layout.tsx shows them.
import { Monitor } from "lucide-react";
import type { ReactElement } from "react";
import { HostForm } from "./HostForm";
import { MobileScreen } from "./MobileScreen";
import "./MobileHeader.css";
import "./SetupScreen.css";

/** The version label of the app build in the screenshots, as appVersionLabel gives it. */
export const APP_VERSION = "1.1.0 (1)";

/** The text of the card. */
export const SETUP_TEXT = {
  title: "Connect to a host",
  description: "Follow and control the agents that run on your computer.",
} as const;

type SetupScreenProps = {
  step: "address" | "pairing";
  endpoint: string;
  code: string;
  hidden?: boolean | undefined;
};

export function SetupScreen({ step, endpoint, code, hidden }: SetupScreenProps): ReactElement {
  return (
    <MobileScreen id="setup" hidden={hidden}>
      <div className="mob-setup">
        <header className="mob-brand">
          <span className="mob-brand-mark" />
          <span className="mob-brand-name">OpenDucktor</span>
          <span className="mob-outline-icon">
            <Monitor />
          </span>
        </header>
        <div className="mob-setup-card">
          <div className="mob-setup-head">
            <h2 className="mob-setup-title">{SETUP_TEXT.title}</h2>
            <p className="mob-setup-description">{SETUP_TEXT.description}</p>
          </div>
          <div className="mob-setup-content">
            <HostForm step={step} endpoint={endpoint} code={code} />
          </div>
        </div>
        <p className="mob-setup-version">OpenDucktor {APP_VERSION}</p>
      </div>
    </MobileScreen>
  );
}
