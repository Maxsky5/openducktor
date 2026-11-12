import { PageScene, type PageSceneProps } from "@openducktor/product-scenes/react/page";
import { sceneStylesheet } from "@/lib/scene-styles";

/**
 * The caption of each demonstration that the MDX pages can place, by the name of its scene in
 * `@openducktor/product-scenes`.
 */
const CAPTIONS = {
  hero: "Agents move tasks across the board.",
  workflow: "One feature from the spec to your review. Select a step to see it.",
  runtimes: "Choose a model of another harness for a role.",
  autopilot: "Autopilot starts the next agent. You answer questions and approve the task.",
  chat: "A workspace session creates the missing tasks, then starts a Builder in the background.",
  "new-session": "Start a session in a new worktree, then send the first message to the agent.",
  fork: "Fork a session from an earlier reply into a new worktree, then send another follow-up.",
  "import-session":
    "Import a Claude Code conversation of the repository, then continue it in OpenDucktor.",
  palette: "Find a task, start its next step, and answer an agent from the palette.",
  prompts: "Open QA Kickoff in Spec, Plan, Build, add append instructions, and save.",
  terminal:
    "Open a terminal, run a command and the default action, then drag a terminal to the right panel.",
  browser:
    "Open a browser tab, type the address of your dev server, then share the tab with the agents.",
  annotate: "Annotate the page, then send the annotations to the agent with a message.",
  "agent-browser":
    "An agent opens its own tab, types and clicks on the page, and takes a screenshot.",
  mcp: "Another agent creates a task through MCP.",
  local: "Refresh runs each check again, and each row shows its result.",
  queue: "Enter queues a message while the agent works, and Steer now sends it at once.",
  composer: "Add a command, a file, and a skill to a message, then send it.",
  "ci-checks":
    "Refresh reads the checks again, and the Builder fixes a failed check and pushes the fix.",
  "pr-comments": "Filter the comments, read a suggested change, and ask the Builder to apply it.",
  "git-conflict":
    "A rebase stops on a conflict, and the Builder resolves it and finishes the rebase.",
  question: "Open a session in Needs you, answer each question, then confirm the answers.",
  "mobile-pair":
    "Scan the QR code of Add device with the phone. The app connects and shows your sessions.",
  "mobile-needs-you":
    "Open the session in Needs you, approve the request, and the agent continues.",
  "mobile-steer": "Queue a message while the agent works, then steer it into the running turn.",
  "mobile-diff-comment":
    "Comment on two diff lines, then send the comment to the Builder with your next message.",
  "mobile-start-builder": "Swipe to Ready for dev, tap Start Builder, and start the session.",
  "mobile-approve":
    "Approve the task with a squash merge, then push main and move the task to Done.",
  "goal-mode": "Start the Builder in Goal mode. It works turn after turn until the goal is met.",
  "goal-command": "Set a goal with /goal, then pause it with /goal pause while the agent works.",
} as const satisfies { [Name in PageSceneProps["name"]]?: string };

type DemoScene = keyof typeof CAPTIONS;

const isDemoScene = (id: string): id is DemoScene => Object.hasOwn(CAPTIONS, id);

/**
 * The props of the scene of a demonstration. The docs know no release, so a window with the app
 * sidebar shows no version, as the app does. A short window keeps the chat at the height of the
 * other demonstrations of the docs.
 */
function sceneProps(name: DemoScene): PageSceneProps {
  if (name === "hero" || name === "palette") return { name, options: { version: null } };
  if (name === "chat") return { name, options: { compact: true } };
  return { name };
}

/**
 * Places a product demonstration in an MDX page, for example `<ProductDemo id="workflow" />`. The
 * export holds the still frame of the scene. The scene follows the appearance of the page through
 * `data-theme` on the page root, and it shows the macOS keys, as the website does. When the
 * animation does not load, the still frame stays and a line under it tells the reader.
 */
export function ProductDemo({ id }: { id: string }) {
  // MDX passes the id without a type check, so an unknown id stops the build here.
  if (!isDemoScene(id)) throw new Error(`No product demonstration shows the scene "${id}".`);
  const caption = CAPTIONS[id];
  return (
    <figure className="docs-demo not-prose">
      <PageScene
        {...sceneProps(id)}
        stylesheet={sceneStylesheet}
        failure={
          <p className="docs-demo-error">
            The animation did not load. Reload the page to try again.
          </p>
        }
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
