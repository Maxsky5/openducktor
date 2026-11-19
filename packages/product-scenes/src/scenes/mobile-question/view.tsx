// The mobile app answers a Structured Question. The Sessions tab shows the Spec session of the pin
// task in Needs you, and its tab shows the Needs you badge. The visitor opens the session, reads
// the question, chooses an answer, and taps Confirm Answers. The card shows its submit progress and
// goes when the host takes the answer. The question in the transcript shows the answer, and the
// Spec agent continues. Sources: sessions-screen.tsx and session-row.tsx in
// apps/mobile/src/features/sessions, session-view.tsx, structured-question-card.tsx, and
// tool-call-row.tsx in apps/mobile/src/features/session. The markup holds the last frame. A phone
// stage shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { QuestionCard } from "../../replicas/mobile/QuestionCard";
import { QuestionToolRow } from "../../replicas/mobile/QuestionToolRow";
import { SessionScreen } from "../../replicas/mobile/SessionScreen";
import { SessionsTab } from "../../replicas/mobile/SessionsTab";
import { Touch } from "../../replicas/mobile/Touch";
import { ToolRun } from "../../replicas/mobile/ToolRun";
import { AgentMessage } from "../../replicas/mobile/TranscriptRows";
import { UserMessageRow } from "../../replicas/mobile/UserMessageRow";
import {
  KICKOFF_MESSAGE,
  LAST_SESSIONS,
  NOTES,
  PIN_SPEC_SESSION,
  QUESTION,
  QUESTION_CALL,
  RAIL,
  REPLY,
  RUNS,
  STEPS,
  TITLE,
  TOOLS,
} from "./sample";
import "./view.css";

export function MobileQuestionView(props: SceneViewProps): ReactElement {
  const options = QUESTION.options.map((option) => option.label).join(", ");
  return (
    <SceneFrame
      {...props}
      name="mobile-question"
      alt={`The OpenDucktor mobile app on a phone. The Sessions tab lists the sessions of every open workspace in the groups Needs you, Running, and Recent. The Sessions tab icon shows a red badge with 1. In Needs you, the Spec session of the task "${TITLE}" shows the badge Backlog and the chip Question. The user taps the session. The session opens with the workflow rail, where the Spec step waits for input. The transcript shows the messages of the agent between five folded tool runs, and the last row, Question, which has moving bars and No answer yet. Above the composer is a card: Input needed, ${QUESTION.header}, 0/1 answered, the question "${QUESTION.question}", the options ${options}, each with a short description, an Other answer button, the hint Answer all questions to confirm, and the buttons Reset and Confirm Answers. The user taps ${QUESTION.answer}. The option shows a check mark, the card shows 1/1 answered and All questions answered, and Confirm Answers turns on. The user taps Confirm Answers. The button shows Submitting… with a loader, and the line Submitting answers… shows under the card. The card goes, and the Question row shows the answer ${QUESTION.answer}. The Spec agent answers that the newest pin goes first, and it runs a command. Next to the phone, a list of five steps highlights the current step.`}
    >
      <MobileStage
        steps={STEPS}
        phone={
          <PhoneFrame overlay={<Touch />}>
            <SessionsTab entries={LAST_SESSIONS} />
            <SessionScreen
              id="session"
              title={TITLE}
              session={PIN_SPEC_SESSION}
              steps={RAIL.working}
              role="spec"
              activity="working"
              rows={
                <>
                  <UserMessageRow {...KICKOFF_MESSAGE} />
                  <AgentMessage paragraphs={[NOTES.intro]} />
                  <ToolRun tools={TOOLS} calls={RUNS.lookups} row="lookups" folded />
                  <AgentMessage paragraphs={[NOTES.plan]} />
                  <ToolRun tools={TOOLS} calls={RUNS.reads} row="reads" folded />
                  <AgentMessage paragraphs={[NOTES.sorting]} />
                  <ToolRun tools={TOOLS} calls={RUNS.checks} row="checks" folded />
                  <AgentMessage paragraphs={[NOTES.types]} />
                  <ToolRun tools={TOOLS} calls={RUNS.menu} row="menu" folded />
                  <AgentMessage paragraphs={[NOTES.menu]} />
                  <ToolRun tools={TOOLS} calls={RUNS.view} row="view" folded />
                  <AgentMessage paragraphs={[NOTES.findings]} />
                  <QuestionToolRow
                    prompt={QUESTION.question}
                    answer={QUESTION.answer}
                    duration={QUESTION_CALL.duration}
                    time={QUESTION_CALL.time}
                    row="question"
                  />
                  <AgentMessage paragraphs={[REPLY]} row="reply" />
                  <ToolRun tools={TOOLS} calls={RUNS.store} row="store" running="store" />
                </>
              }
              pending={
                <QuestionCard
                  question={QUESTION}
                  state="submitting"
                  chosen={QUESTION.answer}
                  hidden
                />
              }
            />
          </PhoneFrame>
        }
      />
    </SceneFrame>
  );
}
