// The static view of each scene for `PageScene`. A React server renders the view, so the page loads
// no view code. `scripts/page-styles.ts` reads the stylesheet imports of these views, so a host
// can bundle the styles of each scene. The map adds the scenes that only the
// documentation shows to the views of the website.
import { ASTRO_VIEWS } from "../astro/views";
import type { SceneViews } from "../frame/SceneFrame";
import { AgentBrowserView } from "../scenes/agent-browser/view";
import { AnnotateView } from "../scenes/annotate/view";
import { BrowserView } from "../scenes/browser/view";
import { CiChecksView } from "../scenes/ci-checks/view";
import { ComposerView } from "../scenes/composer/view";
import { ForkView } from "../scenes/fork/view";
import { GitConflictView } from "../scenes/git-conflict/view";
import { GoalCommandView } from "../scenes/goal-command/view";
import { GoalModeView } from "../scenes/goal-mode/view";
import { ImportSessionView } from "../scenes/import-session/view";
import { MobileApproveView } from "../scenes/mobile-approve/view";
import { MobileDiffCommentView } from "../scenes/mobile-diff-comment/view";
import { MobileNeedsYouView } from "../scenes/mobile-needs-you/view";
import { MobilePairView } from "../scenes/mobile-pair/view";
import { MobileStartBuilderView } from "../scenes/mobile-start-builder/view";
import { MobileSteerView } from "../scenes/mobile-steer/view";
import { NewSessionView } from "../scenes/new-session/view";
import { PrCommentsView } from "../scenes/pr-comments/view";
import { QuestionView } from "../scenes/question/view";
import { QueueView } from "../scenes/queue/view";
import { TerminalView } from "../scenes/terminal/view";

export const PAGE_VIEWS = {
  ...ASTRO_VIEWS,
  composer: ComposerView,
  queue: QueueView,
  question: QuestionView,
  terminal: TerminalView,
  browser: BrowserView,
  annotate: AnnotateView,
  "agent-browser": AgentBrowserView,
  "new-session": NewSessionView,
  fork: ForkView,
  "import-session": ImportSessionView,
  "ci-checks": CiChecksView,
  "pr-comments": PrCommentsView,
  "git-conflict": GitConflictView,
  "mobile-pair": MobilePairView,
  "mobile-needs-you": MobileNeedsYouView,
  "mobile-steer": MobileSteerView,
  "mobile-diff-comment": MobileDiffCommentView,
  "mobile-start-builder": MobileStartBuilderView,
  "mobile-approve": MobileApproveView,
  "goal-mode": GoalModeView,
  "goal-command": GoalCommandView,
} as const satisfies SceneViews;
