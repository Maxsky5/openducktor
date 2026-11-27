import { nodeVersion } from "./site";

/** The questions and answers of the FAQ section. */
export const FAQS = [
  {
    question: "Is OpenDucktor free?",
    answer:
      "Yes. The source is on GitHub under the Apache License 2.0. You do not need an OpenDucktor account.",
  },
  {
    question: "Does OpenDucktor include model access?",
    answer:
      "No. OpenDucktor runs the coding agent that you install: OpenCode, Codex, Claude Code, or Antigravity. The agent uses its own sign-in, and your provider charges you as usual. The Usage page shows the tokens of each agent and their estimated cost at API rates.",
  },
  {
    question: "Where do my tasks and code go?",
    answer:
      "Tasks and their documents stay in a SQLite database on your computer. Your coding agent sends prompts and code to the model provider that you set up. The mobile app connects to that computer. Its Android QR scanner uses Google ML Kit, which collects diagnostics and usage analytics. Read the mobile privacy policy for details.",
  },
  {
    question: "Can agents merge code without me?",
    answer:
      "The workflow cannot. A task goes to Done when you approve a direct merge, or when a pull request that was merged on GitHub, GitLab, or Azure DevOps closes it. Autopilot can start agents and open a pull request. It cannot approve or merge.",
  },
  {
    question: "Must every task go through every step?",
    answer:
      "No. In the built-in workflow, a feature needs a spec and a plan, and a task or a bug can go straight to the Builder. You can skip the QA review and approve the task. To change the steps, design your own workflow on the Workflows page.",
  },
  {
    question: "Which Git hosts work with pull requests?",
    answer:
      "GitHub, through the GitHub CLI, GitLab.com and self-managed GitLab 17.4 or later, and Azure DevOps. Direct merges work in any local Git repository. Bitbucket is not supported.",
  },
  {
    question: "Which operating systems are supported?",
    answer: `macOS, Windows, and Linux. The desktop app is for macOS on Apple silicon or Intel, Windows x64, and Linux x64. The browser version runs on macOS, Windows, and Linux with Node.js ${nodeVersion} or later.`,
  },
  {
    question: "Can I use it from another device?",
    answer:
      "Yes. Pair the mobile app or another computer with Remote control in Settings. You can also run the browser version: by default it accepts connections only from your computer. For remote use, bind it to a private network such as Tailscale. Do not expose it to the public internet.",
  },
];
