// The screen of a task session in the mobile app, as session-view.tsx in
// apps/mobile/src/features/session: the header, the workflow rail, the transcript that keeps its
// newest rows at the bottom, the pending requests, and the composer. The track of the transcript
// has `data-track`, so `follow` of replicas/transcript/rows.ts glides it when rows come in.
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { Session } from "../../sample/sessions";
import type { Activity, RoleId } from "../vocabulary";
import { SessionHeader } from "./MobileHeader";
import { MobileComposer } from "./MobileComposer";
import { MobileRail, type RailStep } from "./MobileRail";
import { MobileScreen } from "./MobileScreen";
import "./SessionScreen.css";

type SessionScreenProps = {
  /** The name that screens.ts uses to find the screen. */
  id: string;
  title: string;
  session: Session;
  steps: Readonly<Record<RoleId, RailStep>>;
  role: RoleId;
  activity: Activity;
  /** The transcript rows, oldest first. */
  rows: ReactNode;
  /** The pending requests between the transcript and the composer. */
  pending?: ReactNode;
  /** The parts of the composer that a scene adds, such as the Message Queue. */
  composer?: Omit<ComponentProps<typeof MobileComposer>, "session" | "activity">;
  hidden?: boolean | undefined;
};

export function SessionScreen({
  id,
  title,
  session,
  steps,
  role,
  activity,
  rows,
  pending,
  composer,
  hidden,
}: SessionScreenProps): ReactElement {
  return (
    <MobileScreen id={id} over hidden={hidden}>
      <SessionHeader title={title} />
      <MobileRail steps={steps} selected={role} />
      <div className="mob-transcript">
        <div className="mob-track" data-track="">
          {rows}
        </div>
      </div>
      <div className="mob-pending" data-pending="">
        {pending}
      </div>
      <MobileComposer {...composer} session={session} activity={activity} />
    </MobileScreen>
  );
}
