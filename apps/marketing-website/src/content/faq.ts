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
      "No. OpenDucktor runs the coding agent that you install: OpenCode, Codex, or Claude Code. The agent uses its own sign-in, and your provider charges you as usual.",
  },
  {
    question: "Where do my tasks and code go?",
    answer:
      "Tasks and their documents stay in a SQLite database on your computer. Your coding agent sends prompts and code to the model provider that you set up. OpenDucktor has no analytics or telemetry. The app loads its fonts from Google Fonts. The desktop app checks GitHub for new releases. It asks before it downloads or installs one.",
  },
  {
    question: "Can agents merge code without me?",
    answer:
      "The workflow cannot. A task goes to Done when you approve a direct merge, or when a pull request that was merged on GitHub or Azure DevOps closes it. Autopilot can start agents and open a pull request. It cannot approve or merge.",
  },
  {
    question: "Must every task go through every step?",
    answer:
      "No. A feature needs a spec and a plan. A task or a bug can go straight to the Builder. The QA review is on by default, and you can turn it off for each task.",
  },
  {
    question: "Which Git hosts work with pull requests?",
    answer:
      "GitHub, through the GitHub CLI, and Azure DevOps. Direct merges work in any local Git repository. GitLab and Bitbucket are not supported.",
  },
  {
    question: "Which operating systems are supported?",
    answer: `macOS, Windows, and Linux. The desktop app is for macOS on Apple silicon or Intel, Windows x64, and Linux x64. The browser version runs on macOS, Windows, and Linux with Node.js ${nodeVersion} or later.`,
  },
  {
    question: "Can I use it from another device?",
    answer:
      "Yes, with the browser version. By default it accepts connections only from your computer. For remote use, bind it to a private network such as Tailscale. Do not expose it to the public internet.",
  },
];
