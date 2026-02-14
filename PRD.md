# Product Requirements Document (PRD): OpenBlueprint

## 1. Product Vision & Overview
**OpenBlueprint** is a cross-platform desktop application (prioritizing macOS) designed for software developers. It acts as an advanced orchestrator for specialized AI development agents (like Opencode).
The goal is to shift the developer-AI interaction from a simple "Chat" to a rigorous, asynchronous, and parallel engineering workflow:
1. **Plan First:** Co-author a detailed Markdown feature specification with an AI Architect agent before writing any code.
2. **Organize:** Manage and visualize all tasks and their statuses through a central Kanban dashboard.
3. **Delegate & Scale:** Execute multiple tasks in parallel by delegating them to AI Builder agents working in complete isolation using Git Worktrees.
4. **Supervise:** Monitor agent progress via a high-level UI and seamlessly unblock them when human intervention is required.

## 2. Architecture & Tech Stack
* **Application Model:** Client (Webview) / Local Host Server (OS) architecture.
* **Frontend (UI):** React, TypeScript, TailwindCSS, Shadcn UI. (Vercel AI SDK UI can be used for chat state management).
* **Backend (Host OS):** **Tauri v2 (Rust)**. Responsible for filesystem operations, executing shell commands (`git worktree`), managing child processes (`opencode serve`), and running bundled binaries.
* **Agent Engine:** Opencode. The frontend uses the `@opencode-ai/sdk` in pure client mode to connect to local Opencode server instances spawned dynamically by the Rust backend.
* **Task & State Management:** **Beads** (`steveyegge/beads`).
  * *Crucial Implementation Detail:* The `bd` binary is bundled directly into the application using **Tauri's Sidecar** feature. It runs completely under the hood. There is no SQLite fallback; Beads is the sole source of truth for task state, metadata, and linked Markdown files. No manual installation of `bd` is required from the user.

## 3. System Requirements (Verified on Startup)
Since OpenBlueprint acts as an orchestrator, it relies on the developer's existing environment for the underlying tools. On startup, Tauri will check the host system for:
1. `git` (must support worktrees).
2. `opencode` CLI (must be installed globally, e.g., via npm, and accessible in the user's `$PATH`).

*(Note: No system check is required for `bd` / Beads, as it is bundled natively within the app as a Tauri sidecar).*

## 4. Core Features & Workflows

### 4.1. The Kanban Dashboard (Mission Control)
* **Objective:** Provide a global, real-time visual overview of all project tasks, their statuses, and active agent executions.
* **Mechanics:** Powered entirely by the local Beads sidecar instance, tracking tasks and their states via CLI commands under the hood.
* **UI/UX:**
  * A central Kanban board with columns mapping to task states (e.g., *Backlog*, *Specifying*, *Ready for Dev*, *In Progress*, *Blocked / Needs Input*, *Done*).
  * Users can create new tasks, drag and drop to update statuses, and view active agents.
  * Cards in the *In Progress* column display live mini-status indicators (e.g., "Agent reading file X").
  * Clicking a card opens its detailed context: either the Planner view (if writing the spec) or the Builder view (if executing).

### 4.2. Phase 1: Planning & Specification (The "Architect")
* **Objective:** Transform a feature idea into a structured Markdown document (the Spec) attached to a task, prior to any code generation.
* **UI/UX (Split-Screen):**
  * *Main View (Left):* Conversational chat interface with the agent.
  * *Sidebar (Right, Optional/Collapsible):* Real-time visual rendering of the Markdown specification attached to the task.
* **Mechanics:** 
  * The Opencode agent is instantiated with a "Plan" profile.
  * The frontend injects specific **Tools** (e.g., `write_markdown_spec`, `update_spec_section`).
  * As the developer discusses and refines the feature, the agent calls these tools to update the document in the background. The Markdown viewer instantly auto-refreshes to reflect changes.

### 4.3. Phase 2: Isolation & Worktree Engine
* **Objective:** Isolate the execution environment for each task to prevent Git conflicts and enable safe, massive parallelism.
* **Creation Lifecycle (Managed by Rust):**
  1. User triggers task execution ("Delegate Task").
  2. Tauri executes `git worktree add <temp-path-outside-project> -b <feature-branch-id>`.
  3. **Pre-start Hooks:** Execution of user-defined workspace setup commands configured via a `.openblueprint.json` file (e.g., `npm install`, `cp ../.env .`).
  4. Tauri spawns a new `opencode serve --port <DYNAMIC_PORT>` process **exclusively** within this isolated worktree directory.
* **Cleanup Lifecycle:**
  1. Once the task is completed and validated.
  2. **Post-complete Hooks:** Execution of teardown/validation commands (e.g., `npm run lint`, `git commit -m "..."`).
  3. Tauri executes `git worktree remove` to cleanly tear down the temporary workspace.

### 4.4. Phase 3: Execution & Supervision (The "Builder")
* **Objective:** Monitor active agents writing code and provide human-in-the-loop (HITL) interventions when necessary.
* **High-Level UI (Inspiration: OpenChamber / VibeKanban):**
  * **No raw terminal.** The UI parses Server-Sent Events (SSE) from the Opencode SDK.
  * Displays a clean, structured activity feed: "Agent Thoughts", "Tool Executions" (e.g., *Reading src/api.ts*, *Running tests*), sub-agents spawned, and real-time Todo checklists.
* **Human-in-the-Loop & Full Integration:**
  * Complete integration with Opencode's permission and prompt system.
  * If the agent encounters a critical error, gets stuck, or requires permission for a sensitive command (e.g., "Can I execute `rm -rf`?"), execution pauses.
  * The task state shifts to **"Blocked"** on the Kanban board and is visually highlighted in red.
  * The developer opens the task, reviews the block in the integrated chat UI, and provides the necessary permission or corrective instructions to resume execution.

## 5. Minimum Viable Product (MVP) Scope
For the initial release (V1), development will focus on the following milestones:

1. **Foundation & Sidecar Integration:**
   * Scaffold Tauri v2 + React/TS frontend.
   * Bundle the Beads (`bd`) CLI binary via Tauri Sidecar.
   * Implement the Kanban Board UI reading/writing task states exclusively via the Beads sidecar.
2. **The "Planner" Workflow:**
   * Implement the Split-Screen UI (Chat + Markdown Viewer).
   * Define and inject JSON schema Tools for Opencode to generate and modify the Markdown spec.
3. **The Worktree Engine:**
   * Implement Rust commands for `git worktree add/remove`.
   * Implement basic configuration parsing (`.openblueprint.json`) for user-defined Pre/Post execution hooks.
4. **The "Builder" Execution UI:**
   * Rust logic to dynamically spawn/kill `opencode serve` instances on available ports.
   * Frontend integration of `@opencode-ai/sdk` parsing SSE streams into the high-level activity UI.
   * Implement the HITL feedback loop (handling "Blocked" states and user replies via chat).
