// The 1.2.2 release film: what changed since 1.0.0. The world holds the scenes of the package in
// one row, in the order of the film. Each set sits close to the next one, so a travel always shows
// one of them. Each set shows a feature that is new since 1.0.0.
import type { ReactElement } from "react";
import type { LoopSceneName } from "../../registry";
import { ArtifactsView } from "../../scenes/artifacts/view";
import { ForkView } from "../../scenes/fork/view";
import { GitlabView } from "../../scenes/gitlab/view";
import { GoalModeView } from "../../scenes/goal-mode/view";
import { KeyboardShortcutsView } from "../../scenes/keyboard-shortcuts/view";
import { MobilePairView } from "../../scenes/mobile-pair/view";
import { MobileQuestionView } from "../../scenes/mobile-question/view";
import { MobileStartBuilderView } from "../../scenes/mobile-start-builder/view";
import { Caption } from "../frame/Caption";
import { ChapterBar } from "../frame/ChapterBar";
import { KeyCast } from "../frame/KeyCast";
import { FilmFrame } from "../frame/FilmFrame";
import { FilmSet } from "../frame/FilmSet";
import { IntroCard, OutroCard } from "../frame/Titles";
import type { FilmViewProps } from "../views";
import { keyPlatform } from "../../replicas/keys";
import { CAPTIONS, CHAPTERS, INTRO_LINE, KEY_CHORDS, OUTRO, RELEASE } from "./captions";

export const FRAME = { width: 1920, height: 1080 } as const;

/**
 * The place of each set in the world, in world pixels: the top left corner of its scene. The sets
 * stand in one row, in the order of the film, so each travel goes to the right and the next set
 * never comes in through the caption column. The phones are 700 px apart, so the next phone comes
 * into the frame as the last one leaves it, and the windows are about 120 px apart. Each set is
 * centered on the middle of the row, at y = 430, and the keyboard-shortcuts set is 20 px lower.
 */
export const PLACES = {
  "mobile-pair": { x: 0, y: -60 },
  "mobile-start-builder": { x: 1120, y: 0 },
  "mobile-question": { x: 1820, y: 0 },
  "goal-mode": { x: 2840, y: 40 },
  fork: { x: 4400, y: 78 },
  artifacts: { x: 5480, y: 130 },
  gitlab: { x: 6320, y: 65 },
  "keyboard-shortcuts": { x: 7500, y: 98 },
} as const satisfies Partial<Record<LoopSceneName, { x: number; y: number }>>;

export const WORLD = { width: 8620, height: 900 } as const;

export type SetName = keyof typeof PLACES;

/** The product view of each set, which the wall of the opening and the closing shows. */
export const VIEWS_OF = {
  "mobile-pair": "[data-root]",
  "mobile-start-builder": "[data-phone]",
  "mobile-question": "[data-phone]",
  "goal-mode": "[data-root]",
  fork: "[data-root]",
  artifacts: "[data-root]",
  gitlab: "[data-tab]",
  "keyboard-shortcuts": "[data-root]",
} as const satisfies Record<SetName, string>;

/** The width of the repository menu of the GitLab settings, which the film crops. */
const GITLAB_MENU = 240;

export function ReleaseFilmView({ keys, theme }: FilmViewProps): ReactElement {
  // The captions and the held keys name the keys of macOS.
  if (keyPlatform(keys) !== "mac") {
    throw new Error("The release-1-2-2 film shows the keys of macOS. Render it with --keys mac.");
  }
  const scene = { keys, captioned: true } as const;
  return (
    <FilmFrame
      name="release-1-2-2"
      theme={theme}
      size={FRAME}
      world={WORLD}
      alt={`The OpenDucktor ${RELEASE.to} release film shows what changed since ${RELEASE.from}: the mobile app pairs with the computer by QR code, shows the task board, starts a Builder, and answers the question of a Spec agent; Goal mode makes an agent work toward a goal; a session forks from a reply; the Builder saves an HTML wireframe on the task; a repository connects to GitLab; and keyboard shortcuts open a session and record new keys for a command. The captions are in French.`}
      sets={
        <>
          <FilmSet name="mobile-pair" {...PLACES["mobile-pair"]}>
            <MobilePairView {...scene} />
          </FilmSet>
          <FilmSet name="mobile-start-builder" {...PLACES["mobile-start-builder"]}>
            <MobileStartBuilderView {...scene} />
          </FilmSet>
          <FilmSet name="mobile-question" {...PLACES["mobile-question"]}>
            <MobileQuestionView {...scene} />
          </FilmSet>
          <FilmSet name="goal-mode" {...PLACES["goal-mode"]}>
            <GoalModeView {...scene} />
          </FilmSet>
          <FilmSet name="fork" {...PLACES["fork"]}>
            <ForkView {...scene} />
          </FilmSet>
          <FilmSet name="artifacts" {...PLACES["artifacts"]}>
            <ArtifactsView {...scene} />
          </FilmSet>
          <FilmSet name="gitlab" {...PLACES["gitlab"]} cropLeft={GITLAB_MENU}>
            <GitlabView {...scene} />
          </FilmSet>
          <FilmSet name="keyboard-shortcuts" {...PLACES["keyboard-shortcuts"]}>
            <KeyboardShortcutsView {...scene} />
          </FilmSet>
        </>
      }
      overlay={
        <>
          {Object.values(CAPTIONS).map((caption) => (
            <Caption caption={caption} key={caption.id} />
          ))}
          <KeyCast chords={KEY_CHORDS} />
          <ChapterBar chapters={CHAPTERS} />
          <IntroCard version={RELEASE.to} line={INTRO_LINE} />
          <OutroCard version={RELEASE.to} line={OUTRO.line} links={OUTRO.links} />
        </>
      }
    />
  );
}
