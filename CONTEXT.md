# OpenDucktor Context

OpenDucktor is an agentic development environment built around repository tasks, role-specific agent work, local runtimes, and task-linked workflow evidence. This glossary defines the product workflow language used in specs, plans, QA reports, reviews, and agent discussions.

## Language

### Product Shape

**OpenDucktor**:
An agentic development environment that coordinates task work inside a local repository. It keeps the task, agent-authored documents, review state, implementation work, **Pull Request** data, and **Direct Merge** state connected around the same unit of work.
_Avoid_: generic chat app, IDE, task tracker

**Repository**:
The local codebase where OpenDucktor reads tasks and coordinates agent work. A **Repository** has many **Tasks** and may have one or more running **Runtime Instances**.
_Avoid_: workspace, project, folder when the user-facing codebase is meant

**Workspace**:
A boundary term for external or technical identity where OpenDucktor must name a scoped execution context, such as MCP workspace identity or runtime workflow scope. Do not use **Workspace** as the user-facing word for a local codebase; use **Repository** for that.
_Avoid_: repository, project, folder when the local codebase is meant

**Beads**:
The task system that owns OpenDucktor's V1 task records and persisted lifecycle state. OpenDucktor treats Beads as the current source of truth for **Tasks**, **Task Statuses**, and **Task Metadata**, while keeping the product language broader than Beads itself.
_Avoid_: local task cache, issue mirror, permanent domain model

**Task Store**:
The replaceable boundary through which OpenDucktor reads and writes **Tasks**, **Task Statuses**, and **Task Metadata**. The current **Task Store** is Beads-backed; use **Task Store** in developer/agent discussions about building OpenDucktor, not as UI wording.
_Avoid_: Beads when the replaceable boundary is meant, task cache, user-facing label

**Agent Studio**:
The OpenDucktor surface for starting, resuming, and inspecting **Agent Sessions**. For now, **Agent Studio** includes **Task-bound Sessions** and is expected to include **Repository Sessions**, though this product boundary may split later.
_Avoid_: chat page, assistant UI, **Task Workflow** only

**Kanban**:
The OpenDucktor page that presents **Tasks** as a kanban board.
_Avoid_: task list, lifecycle engine

### Task Workflow

**Task**:
The unit of work OpenDucktor coordinates through specification, planning, building, QA, and **Human Review**. A **Task** has one **Task Status**, one **Issue Type**, optional **Task Documents**, and may have linked **Agent Sessions**, a **Build Worktree**, **Pull Request** data, and **Direct Merge** state.
_Avoid_: ticket, card, issue

**Issue Type**:
The category of a **Task** that determines workflow expectations and hierarchy rules. OpenDucktor **Issue Types** are `epic`, `feature`, `task`, and `bug`.
_Avoid_: task type, label, kind, category

**Epic**:
A **Task** that can contain direct child tasks. An **Epic** has at most one child level; its child tasks cannot have children.
_Avoid_: project, milestone, parent story

**Subtask**:
A direct child of an **Epic**. A **Subtask** is still a **Task**, but it cannot have children.
_Avoid_: checklist item, nested issue

**Task Status**:
The SQLite-backed lifecycle status of a **Task**. OpenDucktor **Task Statuses** are `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review`, and `closed`. `ai_review` and `human_review` are statuses, not review activities.
_Avoid_: phase, lane, label

**Task Workflow**:
The path OpenDucktor uses to bring a **Task** from `open` to `closed`. The **Task Workflow** is expressed through **Task Statuses**, **Workflow Actions**, **Workflow Roles**, **Task Documents**, reviews, and the selected **Task Completion Path**.
_Avoid_: workflow engine, kanban flow, agent run

**Build Worktree**:
A task-owned Git worktree used for implementation work. A **Build Worktree** keeps implementation changes isolated from the main repository checkout while staying linked to the **Task**; it is a task-level concept, not a Builder-agent-owned concept.
_Avoid_: builder worktree, workspace, clone, branch

**Task Metadata**:
Supporting data stored with a **Task** that is not the primary user-authored task fields. Today, **Task Metadata** includes **Task Documents** such as **Spec Document**, **Implementation Plan**, and **QA Report**, plus linked **Agent Sessions**, **Pull Request** data, and **Direct Merge** state. Do not generalize future stored information beyond named concepts when the storage shape is not yet known.
_Avoid_: task field, user-authored field, transcript

**Workflow Action**:
An operation currently allowed for a **Task**, such as setting a **Spec Document**, starting Builder work, generating a **Pull Request**, requesting QA, approving, deferring, or resetting. A **Workflow Action** may change the **Task Status**, update **Task Documents**, or only open an existing work context.
_Avoid_: task action, button, command, transition

**Autopilot**:
OpenDucktor behavior that starts the next **Workflow Action** automatically when **Task Status** and workflow conditions match configured rules. A **Workflow Action** may start an **Agent Session**, call an API, run a command, or perform another workflow step. For example, Autopilot can start **Pull Request** generation when a **Task** enters `human_review`.
_Avoid_: scheduler, automation engine

**Agent Role**:
The role assigned to an **Agent Session**. Current **Agent Roles** are **Spec Agent**, **Planner Agent**, **Builder Agent**, and **QA Agent**; all current **Agent Roles** are **Workflow Roles**. Future **Agent Roles** may work outside the **Task Workflow**.
_Avoid_: persona, assistant mode, runtime role

**Workflow Role**:
An **Agent Role** that participates in the **Task Workflow**. The current **Workflow Roles** are **Spec Agent**, **Planner Agent**, **Builder Agent**, and **QA Agent**.
_Avoid_: persona, agent type, assistant mode, Specification, Planner, Builder, QA when naming the role itself

**Spec Agent**:
The **Workflow Role** that clarifies what a **Task** means and produces or revises the **Spec Document**.
_Avoid_: specification role, spec role, requirements agent

**Planner Agent**:
The **Workflow Role** that turns an understood **Task** and **Spec Document** into an **Implementation Plan**.
_Avoid_: planning role, planner

**Builder Agent**:
The **Workflow Role** that implements a **Task**, usually using the task's **Build Worktree**.
_Avoid_: build role, developer agent, builder

**QA Agent**:
The **Workflow Role** that performs **QA Review** and produces a **QA Report**.
_Avoid_: QA role, reviewer agent, tester agent

**Spec Document**:
One of the **Task Documents** that states what should be true for the **Task** to be considered understood and ready for planning. A **Spec Document** belongs to one **Task**.
_Avoid_: Specification, requirements doc, spec chat

**Implementation Plan**:
One of the **Task Documents** that describes how a **Task** should be built. An **Implementation Plan** belongs to one **Task** and moves eligible work toward `ready_for_dev`.
_Avoid_: plan chat, build notes

**QA Report**:
One of the **Task Documents** that records the **QA Verdict** and evidence for the current implementation state. A **QA Report** belongs to one **Task** and carries either an approved or rejected verdict.
_Avoid_: test summary, review note

**QA Review**:
The review activity performed by the **QA Agent** against the current implementation state. A **QA Review** produces a **QA Report** and **QA Verdict**.
_Avoid_: AI Review when the activity is meant, test run

**Task Documents**:
Agent-authored documents attached to a **Task** as workflow evidence. Current **Task Documents** are **Spec Document**, **Implementation Plan**, and **QA Report**.
_Avoid_: comment, description, transcript

**QA Verdict**:
The current QA outcome for a **Task** based on the latest **QA Report**. A **QA Verdict** can approve the implementation for **Human Review** or reject it back into rework.
_Avoid_: test result, approval

**QA Approval**:
The approved **QA Verdict** recorded by a **QA Report**. **QA Approval** means the **QA Agent** accepts the current implementation state for **Human Review**.
_Avoid_: Human Approval, final approval, plain approval

**QA Rejection**:
The rejected **QA Verdict** recorded by a **QA Report**. **QA Rejection** means the **QA Agent** found the current implementation state insufficient and sends the task back into implementation work.
_Avoid_: Change Request, Human Approval, plain rejection

**Blocked**:
The **Task Status** for a **Task** whose **Builder Agent** is stuck because implementation cannot proceed without a changed condition, clarification, or external action. The **Builder Agent** marks the **Task** **Blocked** when it cannot continue implementation. Examples include impossible requirements in the **Spec Document** or a **QA Review** request that depends on an unavailable platform.
_Avoid_: **Waiting for Input**, paused agent, **Permission Prompt**

**Human Review**:
The **Task Status** where a human decides whether the current **Task** outcome is acceptable. **Human Review** is still active workflow work until the human records **Human Approval** or a **Change Request**.
_Avoid_: done, approved, human action

**Human Approval**:
The human action taken when the human is satisfied with the current **Task** outcome. **Human Approval** usually happens from **Human Review**, but a human can also approve from `ai_review` to bypass QA validation. **Human Approval** starts the selected **Task Completion Path**; it does not necessarily close the **Task** immediately.
_Avoid_: Human Review, QA approval, done

**Change Request**:
The human action that rejects the current **Task** outcome and asks for rework. A **Change Request** can happen from `human_review` or `ai_review`, and moves the **Task** back into implementation work.
_Avoid_: rejection, QA rejection, feedback

**AI Review**:
The **Task Status** where **QA Review** is expected before the **Task** can proceed to **Human Review**. **AI Review** can be exited by a **QA Verdict** or by a human action such as **Human Approval** or **Change Request**. **AI Review** is not the review activity and is not final approval.
_Avoid_: QA Review when the state is meant, automated done, completed by agent

### Agent Work

**Agent Session**:
A runtime conversation bound to a **Repository** and run by a **Runtime Instance**. An **Agent Session** may be a **Task-bound Session** or a **Repository Session**, and it is distinct from the **Runtime Instance** that runs it.
_Avoid_: runtime, chat, thread

**Task-bound Session**:
An **Agent Session** attached to exactly one **Task** and, when it participates in the **Task Workflow**, one **Workflow Role**. Current **Spec Agent**, **Planner Agent**, **Builder Agent**, and **QA Agent** sessions are **Task-bound Sessions**.
_Avoid_: task session, workflow run

**Repository Session**:
An **Agent Session** scoped to a **Repository** rather than a specific **Task**. **Repository Sessions** support, or are planned to support, work such as research, brainstorming, and exploration that may later inform tasks.
_Avoid_: global chat, loose session, untracked session

**Transcript**:
The visible ordered history of an **Agent Session** in OpenDucktor. A **Transcript** is runtime-neutral presentation of session messages, **Tool Calls**, questions, permissions, and status events.
_Avoid_: thread, turn, raw history

**Runtime**:
An agent system OpenDucktor can use to run **Agent Sessions**, such as OpenCode or Codex. A **Runtime** is product language for the agent system and its capabilities, not the technical adapter that connects to it.
_Avoid_: model, adapter, runtime adapter, engine

**Runtime Instance**:
A live instance of a **Runtime** for a **Repository**. A **Runtime** can have multiple **Runtime Instances** when OpenDucktor is working across multiple repositories, and each **Runtime Instance** can support one or more **Agent Sessions** depending on runtime capabilities and workflow needs.
_Avoid_: running runtime, session, model, endpoint

**Runtime Descriptor**:
The OpenDucktor description of a **Runtime**, including its kind, display metadata, **Runtime Capabilities**, workflow tool aliases, and transport expectations. Use **Runtime Descriptor** when discussing what OpenDucktor knows a runtime can do.
_Avoid_: Runtime Instance, runtime config, adapter

**Runtime Capabilities**:
The feature contract exposed by a **Runtime Descriptor**. **Runtime Capabilities** cover workflow support, session lifecycle, history, approvals, structured input, prompt input, and optional surfaces such as todos, diff, file status, MCP status, profiles, variants, and subagents.
_Avoid_: UI feature flags, permissions, model capabilities only

**Runtime Route**:
The live route OpenDucktor uses to reach a **Runtime Instance**, such as local HTTP or stdio identity. A **Runtime Route** is live routing data and must not be persisted into task/session documents as durable task or session state.
_Avoid_: Runtime Instance, endpoint as durable metadata, Repository path

**Runtime Health**:
The current readiness result for a **Runtime** or **Runtime Instance**. **Runtime Health** is used for diagnostics and readiness checks; it is not the same thing as **Session Status**.
_Avoid_: Session Status, Task Status, Runtime Capabilities

**Model**:
The selected AI model used by a **Runtime** for an **Agent Session**. A **Model** is not the same thing as a **Runtime**.
_Avoid_: runtime, provider

**Start Mode**:
The way an **Agent Session** begins: fresh, reused, or forked. A **Start Mode** describes session continuity, not **Workflow Role**.
_Avoid_: launch type, session kind

**Session Fork**:
A new **Agent Session** started from an existing **Agent Session**, when the **Runtime** supports forking. A **Session Fork** is not a **Subagent** and not a Git branch.
_Avoid_: Subagent, branch, copied Transcript

**External Session ID**:
The runtime-owned identifier for an **Agent Session**. OpenDucktor uses **External Session ID** as the durable session identifier when referring to a specific session.
_Avoid_: Task id, local UI tab id, Runtime Instance id

**Builder Iteration**:
One bounded round of **Builder Agent** work on a **Task**. A **Builder Iteration** ends when the **Builder Agent** reports **Build Completion**.
_Avoid_: implementation pass, implementation turn, attempt

**Build Completion**:
The workflow event where the **Builder Agent** reports that the current **Builder Iteration** is complete and ready for review. **Build Completion** can happen after the first implementation, after addressing **QA Rejection**, or after a human **Change Request**.
_Avoid_: build, software build, compile result

**Permission Prompt**:
A runtime request asking whether a proposed operation may proceed. A pending **Permission Prompt** means the **Agent Session** is **Waiting for Input**; it does not make the **Task** **Blocked**. If permission is denied, the related **Tool Call** may be denied.
_Avoid_: confirmation, modal

**Structured Question**:
A runtime-originated request for user input during an **Agent Session**. A pending **Structured Question** means the **Agent Session** is **Waiting for Input**; it pauses session progress until answered, but it does not make the **Task** **Blocked** and it is not a task document.
_Avoid_: comment, feedback, prompt

**Waiting for Input**:
The state of an **Agent Session** when it needs a user answer to a **Structured Question** or a user decision on a **Permission Prompt** before the current session interaction can continue. **Waiting for Input** is session state, not a **Task Status**.
_Avoid_: Blocked, task blocked, paused task

### Agent Studio And Chat

**Session Status**:
The OpenDucktor interaction state of an **Agent Session**. **Session Status** is separate from **Task Status** and should not be treated as runtime liveness by itself.
_Avoid_: Task Status, phase, lane

**Starting Session**:
An **Agent Session** that OpenDucktor is preparing before it can begin normal agent work. A **Starting Session** may include repository or task preparation work that the user can monitor before the session becomes a **Running Session** or **Idle Session**.
_Avoid_: Running Session, Idle Session, booting runtime, loading spinner

**Running Session**:
An **Agent Session** whose **Runtime** is actively processing work or streaming output. A **Running Session** can still have visible **Tool Calls**, assistant deltas, todo updates, or subagent activity in progress.
_Avoid_: in_progress Task, live runtime instance, busy task

**Idle Session**:
An **Agent Session** that is not currently running. **Idle Session** is the umbrella product term for sessions that are available only as readable or resumable history, including sessions with more specific non-running outcomes.
_Avoid_: closed task, inactive task

**Stopped Session**:
An **Idle Session** that became idle because the user manually interrupted it with the stop button. Use **Stopped Session** only for the user-interrupted case, not as the general term for every non-running session.
_Avoid_: Idle Session, closed task, deleted session

**Errored Session**:
An **Idle Session** whose last interaction failed. An **Errored Session** is session state; it does not automatically make the **Task** **Blocked**.
_Avoid_: Blocked, failed Task, QA Rejection

**Task Session History**:
The history of **Agent Sessions** attached to a specific **Task**, used to inspect or resume prior task-bound work. **Task Session History** is not the same thing as the **Transcript**.
_Avoid_: Transcript, runtime history, browser history

**Task Session Records Query**:
The frontend read boundary for **Task Session History**. Agent Studio, Kanban, task details, and autopilot should use this query instead of reading session history from task-card summaries.
_Avoid_: TaskCard session source, duplicated session history state

**Repo Session Read Model**:
The startup projection that combines persisted **Task Session History** records with one runtime-owned **Session Runtime Snapshot** per runtime kind and working directory. The **Repo Session Read Model** owns the session list shown after reload; it is not a second session store.
_Avoid_: session hydration, reconciliation, presence store, reattach

**Session Observer**:
The frontend boundary that observes a live **Agent Session** by subscribing to its runtime event stream. A **Session Observer** is created from a runtime kind, working directory, repository path, and external session id; runtime adapters own any internal state preparation needed to make that subscription work.
_Avoid_: attach session, restore session, listener hydration

**Session History Load**:
The runtime-owned read that loads the visible **Transcript** for a selected **Agent Session**. **Session History Load** has ordinary loading, loaded, and failed states; it should not invent missing runtime session data.
_Avoid_: transcript hydration, runtime recovery, fallback loading

**Selected Session Runtime Data**:
The query-owned selected-session data for runtime-scoped UI surfaces such as **Session Todos** and model catalog. **Selected Session Runtime Data** is also the live owner for **Session Todos** updated by runtime events. It may be composed into an **Agent Chat** view model, but it does not own **Agent Session** identity, status, **Transcript**, or history loading.
_Avoid_: session state overlay, runtime data hydration, transcript store

**Runtime Session Reference**:
The durable reference used to ask a **Runtime** about one **Agent Session**: runtime kind, repository path, working directory, and external session id, plus task or role context when a user sends or replies. A **Runtime Session Reference** is not a live route.
_Avoid_: runtime attachment, runtime endpoint, runtime route

**Runtime Route Resolution**:
The low-level registry step that resolves a **Runtime Session Reference** to the live **Runtime Route** only when an adapter call needs to reach the **Runtime Instance**. **Runtime Route Resolution** must fail fast when the matching runtime is unavailable.
_Avoid_: runtime recovery, repo default fallback, persisted endpoint

**Session Runtime Snapshot**:
The runtime-backed startup snapshot for **Agent Sessions** known by a runtime kind and working directory. A **Session Runtime Snapshot** can mark sessions as running, idle, stopped, errored, or waiting for input, but ongoing updates come from the runtime event stream.
_Avoid_: Session Status source, polling, reconciliation store

**Agent Chat**:
The OpenDucktor surface that displays a **Transcript** and, when interaction is allowed, a **Chat Composer**. **Agent Chat** can appear inside or outside Agent Studio; it is not a separate **Agent Session**.
_Avoid_: Agent Session, Runtime, Transcript only, Agent Studio only

**Read-only Session View**:
An Agent Studio view that displays an **Agent Session** transcript without a **Chat Composer**. A **Read-only Session View** is used anywhere OpenDucktor needs transcript inspection without interaction.
_Avoid_: Transcript Session, Primary Session, read-only Agent Session

**Chat Composer**:
The input surface used to send a user message to an **Agent Session**. The **Chat Composer** can include text, **Slash Commands**, **File References**, **Skill References**, and **Attachments**, depending on **Runtime** capabilities.
_Avoid_: Transcript, prompt template, task document editor

**User Message Draft**:
The unsent state of a **User Message** in the **Chat Composer**, including text, structured references, and staged **Attachments**.
_Avoid_: Composer Draft, Prompt Template, Task Document

**User Message**:
A message sent by the human through the **Chat Composer**. A **User Message** may be queued or read by the **Runtime**, and may include structured message parts.
_Avoid_: Structured Question, Task Document, comment

**Assistant Message**:
A message produced by the **Runtime** during an **Agent Session**. An **Assistant Message** may include text, reasoning, **Tool Calls**, **Subagent** activity, or session notices in the **Transcript**.
_Avoid_: QA Report, Task Document, Tool Call

**Reasoning Message**:
A **Transcript** message or message part that displays model reasoning or thinking content when the **Runtime** exposes it. Users can choose whether **Reasoning Messages** are shown or hidden in Agent Studio.
_Avoid_: Assistant Message, Tool Call, QA Report

**System Prompt**:
The system-level instruction content used to start or guide an **Agent Session**. A **System Prompt** is not a **Spec Document**, **Implementation Plan**, or **QA Report**.
_Avoid_: Task Document, reusable prompt, chat message

**Prompt Template**:
A configurable template for system, kickoff, message, or permission prompts used by OpenDucktor when starting or guiding **Agent Sessions**. **Prompt Templates** may have placeholders such as task and git context.
_Avoid_: User Message Draft, User Message, Spec Document

**Prompt Override**:
A repository-level replacement or customization for a **Prompt Template**. **Prompt Overrides** change how OpenDucktor prompts agents; they are not user chat messages.
_Avoid_: User Message, Reusable Prompt, Task Document

**Kickoff Prompt**:
The initial prompt generated for a **Workflow Action** when OpenDucktor starts an **Agent Session**, such as initial implementation, QA Review, or **Pull Request Generation**.
_Avoid_: User Message, System Prompt, Reusable Prompt

**Reusable Prompt**:
A user-configured prompt snippet that can be inserted through a **Slash Command** in the **Chat Composer**. A **Reusable Prompt** is a composer convenience, not a **Prompt Template**.
_Avoid_: Prompt Template, System Prompt, Skill

**Slash Command**:
A command-like **Chat Composer** part selected with a slash trigger. **Slash Commands** can come from the **Runtime**, MCP, **Skills**, custom definitions, or **Reusable Prompts**.
_Avoid_: shell command, Workflow MCP Tool, Tool Call

**Slash Command Catalog**:
The list of **Slash Commands** available for the current repo/runtime or active **Agent Session**. **Slash Command Catalog** availability depends on **Runtime** prompt-input support and session context.
_Avoid_: Skill Catalog, command history

**Skill**:
A reusable instruction package exposed by a **Runtime** or local agent environment for use in the **Chat Composer** or session setup. A **Skill** is referenced by metadata such as id, name, path, title, and description.
_Avoid_: Workflow Role, Slash Command, Prompt Template

**Skill Catalog**:
The list of **Skills** available for the current repo/runtime or active **Agent Session**.
_Avoid_: Slash Command Catalog, plugin list

**Skill Reference**:
A **Chat Composer** message part that points to a selected **Skill**. A **Skill Reference** tells the **Runtime** to use that skill as part of the user message.
_Avoid_: Skill, Slash Command, attachment

**File Reference**:
A **Chat Composer** message part that points to a repository file or directory. A **File Reference** is prompt input, not an uploaded **Attachment**.
_Avoid_: Attachment, file diff, affected path

**Attachment**:
A file sent with a **User Message**, currently classified as image, audio, video, or PDF. **Attachments** depend on selected **Model** support and may be staged locally before sending to the **Runtime**.
_Avoid_: File Reference, Task Document, Pull Request file

**Attachment Support**:
The **Model** or **Runtime** capability that determines which **Attachment** kinds can be sent in the current **Agent Session**.
_Avoid_: File Search, File Reference, model selection only

**Model Catalog**:
The list of **Models**, variants, profiles, and attachment support exposed by a **Runtime** for a **Repository** or **Agent Session**.
_Avoid_: Runtime, Model Selection, provider list only

**Model Selection**:
The selected **Model** details for an **Agent Session**, including provider, model id, and optional variant or profile. **Model Selection** is not the same thing as **Runtime**.
_Avoid_: Runtime, Model Catalog, Agent Role

**Session Context Usage**:
The token and context-window information reported for an **Agent Session** or assistant message. **Session Context Usage** may include total tokens, context window, output limit, provider, model, variant, or profile.
_Avoid_: Task estimate, cost only, Transcript length

**Session Todo**:
A runtime-owned todo item for an **Agent Session**. **Session Todos** can have `pending`, `in_progress`, `completed`, or `cancelled` status and `high`, `medium`, or `low` priority. **Session Todos** are not **Tasks**, and they are not part of canonical **Agent Session** state.
_Avoid_: Task, Subtask, checklist item

**Pending Input**:
Any unresolved **Permission Prompt** or **Structured Question** for an **Agent Session**. **Pending Input** can also be surfaced for **Subagents** through the parent session.
_Avoid_: Blocked, Task Status, QA Rejection

**Subagent**:
A runtime-supported child agent activity launched inside a parent **Agent Session**. A **Subagent** can run in `foreground` or `background` mode when the **Runtime** supports those execution modes.
_Avoid_: Workflow Role, Agent Role, Task-bound Session

**Subagent Session**:
An **Agent Session** created or used by a **Subagent** inside a parent **Agent Session**. A **Subagent Session** is inspected through a **Read-only Session View** when interaction stays anchored in the parent session.
_Avoid_: Subagent Transcript, Workflow Role, Task-bound Session

**Subagent Execution Mode**:
How a **Subagent** runs relative to its parent **Agent Session**. Current modes are `foreground` and `background`.
_Avoid_: Start Mode, Workflow Role, Session Status

**Subagent Message**:
The **Transcript** entry that summarizes **Subagent** activity, status, prompt, description, and optional child session id.
_Avoid_: Assistant Message, Tool Call

**Subagent Pending Input**:
**Pending Input** that belongs to a child **Subagent** session but is surfaced on the parent **Agent Session** so the user can answer it from the main Agent Studio context.
_Avoid_: parent Pending Input, Blocked, Task Status

**Compaction**:
A runtime/session event where conversation history is compressed or summarized to manage context. **Compaction** may appear in the **Transcript**, but it is runtime/session behavior, not **Task Metadata**.
_Avoid_: Transcript deletion, Task reset, Session Context Usage

### Task Completion

**Task Completion Path**:
Everything that can happen after **Human Approval** when the human is satisfied with the task outcome. A **Task Completion Path** usually starts from `human_review`, but it can also start from `ai_review` when the human explicitly bypasses QA validation. Current **Task Completion Paths** are **Pull Request** and **Direct Merge**; today the human selects the path during **Human Approval**.
_Avoid_: delivery, merge route, merge strategy

**Direct Merge**:
The **Task Completion Path** where Builder work is merged directly instead of going through a **Pull Request**. OpenDucktor records **Direct Merge** state as **Task Metadata** while that path is in progress or being completed. A **Direct Merge** can use one of three Git merge methods: `merge_commit`, `squash`, or `rebase`.
_Avoid_: **Pull Request**, manual merge note, delivery metadata

**Git Merge Method**:
The Git operation style used by **Direct Merge**. OpenDucktor supports three **Git Merge Methods** for **Direct Merge**: `merge_commit`, `squash`, and `rebase`.
_Avoid_: Task Completion Path, delivery, merge route

**Pull Request**:
The provider-hosted review or merge artifact for Builder work. As a **Task Completion Path**, **Pull Request** means completion proceeds through that provider artifact instead of **Direct Merge**. A **Pull Request** may be generated or updated before **Human Approval**, including by **Autopilot** when the **Task** enters `human_review`; that preparation does not itself mean the task has been approved. A **Pull Request** is identified by provider and number, not by text mentioned in chat.
_Avoid_: PR text, chat link, **Direct Merge**

**Pull Request Generation**:
The **Workflow Action** where the **Builder Agent** creates or updates a **Pull Request** for a **Task**. **Pull Request Generation** can be started manually or by **Autopilot** when the **Task** enters `human_review`; it prepares the provider artifact but is not **Human Approval** and does not by itself close the **Task**.
_Avoid_: Human Approval, Task Completion Path, PR text

### Build Tools And Git

**Build Tools**:
The Agent Studio area for inspecting and operating on implementation context, including **Git Panel**, **Dev Server**, and **Open In**. **Build Tools** are usually tied to a **Build Worktree**.
_Avoid_: Builder Agent, Workflow MCP Tool, Runtime

**Git Panel**:
The Agent Studio build-tools surface for branch, diff, file status, conflict, reset, commit, rebase, pull, push, and **Open In** actions. **Git Panel** can operate in repository context or worktree context.
_Avoid_: Git provider, Pull Request, Task Completion Path

**Current Branch**:
The Git branch currently checked out in the selected repository or **Build Worktree** context.
_Avoid_: Target Branch, Pull Request branch, Task Status

**Target Branch**:
The Git branch that current work is compared against or eventually merged into. **Target Branch** is used by **Target Diff**, rebase actions, **Pull Request**, and **Direct Merge** flows.
_Avoid_: Current Branch, target task, target runtime

**Upstream Ahead/Behind**:
The Git Panel information showing how many commits the **Current Branch** is ahead of or behind its upstream branch.
_Avoid_: Target Diff, Pull Request state, Task Status

**Diff Scope**:
The **Git Panel** mode that chooses which diff is displayed. Current **Diff Scopes** are `target` and `uncommitted`.
_Avoid_: diff style, branch

**Target Diff**:
The **Diff Scope** that compares the current branch or worktree against the target branch.
_Avoid_: Uncommitted Diff, Pull Request diff

**Uncommitted Diff**:
The **Diff Scope** that shows local uncommitted changes in the repository or **Build Worktree**.
_Avoid_: Target Diff, file status only

**File Diff**:
A per-file diff displayed in **Git Panel**, including changed file path and patch content. A **File Diff** is different from a **File Reference** in the **Chat Composer**.
_Avoid_: File Reference, Attachment, File Status

**File Status**:
The git status entry for a file in the repository or **Build Worktree**. **File Status** is related to but distinct from **File Diff**.
_Avoid_: Task Status, File Reference

**Diff Refresh**:
The **Git Panel** operation that reloads git state and diffs. Refresh modes may be hard, soft, or scheduled.
_Avoid_: session history loading, runtime route resolution, browser refresh

**Git Conflict**:
A git operation conflict detected for rebase, pull rebase, or **Direct Merge**. A **Git Conflict** includes the operation, target branch, conflicted files, output, and working directory.
_Avoid_: QA Rejection, Change Request, Blocked

**Git Conflict Action**:
The selected user or workflow response to a **Git Conflict**, such as aborting the conflict operation or asking the **Builder Agent** to resolve it.
_Avoid_: Change Request, QA Rejection, Permission Prompt

**Rebase Onto Target**:
The **Git Panel** action that rebases the current branch or **Build Worktree** branch onto the target branch.
_Avoid_: Git Merge Method, Direct Merge rebase, pull rebase

**Pull Rebase**:
A git pull operation that rebases local work on top of upstream changes. **Pull Rebase** is a git operation, not **Pull Request** work.
_Avoid_: Pull Request, Rebase Onto Target, Direct Merge

**Push Branch**:
The **Git Panel** action that publishes local commits to the remote branch without overwriting remote history.
_Avoid_: Force Push, Pull Request, Task Completion Path

**Force Push**:
A **Git Panel** push option used only when **Push Branch** is not possible and the remote branch must be overwritten. **Force Push** must remain explicit.
_Avoid_: Push Branch, Pull Request, Task Completion Path

**Commit Changes**:
The **Git Panel** action that creates a Git commit from local changes with a commit message.
_Avoid_: Commit Composer, Pull Request description, QA Report

**Inline Diff Comment**:
A user comment attached directly to a **File Diff** in the **Git Panel**. **Inline Diff Comments** are automatically included in the next **User Message** to the **Builder Agent** as implementation feedback; they are not **Task Documents**.
_Avoid_: Change Request, QA Report, Chat Composer message

**Open In**:
The Agent Studio action that opens the current repository or **Build Worktree** in an external tool such as a terminal, editor, or file manager.
_Avoid_: Runtime, Tool Call, File Reference

**Dev Server**:
A development server process used during implementation work. **Dev Server** scripts are configured at the **Repository** level, but **Dev Server** execution happens at task/worktree level inside the task's **Build Worktree**.
_Avoid_: Runtime, Agent Session

**Dev Server Script**:
One configured command inside a **Dev Server** group, such as a frontend or backend development command. A **Dev Server Script** has its own status and terminal output.
_Avoid_: Slash Command, Tool Call, Workflow Action

### Tools And Boundaries

**OpenDucktor MCP Tool**:
A tool exposed by the OpenDucktor MCP server as part of its `odt_`-prefixed tool set. **OpenDucktor MCP Tools** include both **Workflow MCP Tools** and **Public Task MCP Tools**.
_Avoid_: runtime tool, native tool, shell command

**Workflow MCP Tool**:
An **OpenDucktor MCP Tool** that reads or mutates **Task Workflow** state for an existing **Task**, such as setting a **Spec Document**, recording **Build Completion**, or writing a **QA Report**. **Workflow MCP Tools** are the tools used by task-bound workflow agents.
_Avoid_: Public Task MCP Tool, **Native Runtime Tool**

**Public Task MCP Tool**:
An **OpenDucktor MCP Tool** for task discovery or task creation outside a task-bound workflow, such as searching or creating tasks. A **Public Task MCP Tool** is not a **Workflow MCP Tool**.
_Avoid_: workflow tool, task action

**Native Runtime Tool**:
A tool built into a specific **Runtime**, such as read, edit, or bash. **Native Runtime Tools** exist independently from OpenDucktor and are not **OpenDucktor MCP Tools**.
_Avoid_: OpenDucktor MCP Tool, Workflow MCP Tool, odt tool

**Tool Call**:
A concrete invocation of a **Native Runtime Tool** or **OpenDucktor MCP Tool** during an **Agent Session**, surfaced in the **Transcript** with its request, progress, result, denial, interruption, or failure as available. A **Tool Call** remains a **Tool Call** whether it succeeds, fails, is denied by a user, is denied automatically by runtime configuration, or is interrupted.
_Avoid_: tool entry

## Flagged Ambiguities

**Session vs Runtime Instance**:
Use **Agent Session** for a runtime conversation. Use **Task-bound Session** when the session is attached to one **Task**, and **Repository Session** when it is scoped to the **Repository**. Use **Runtime Instance** for the live local runtime process that can run sessions.

**Agent Session vs Thread**:
Use **Agent Session** in OpenDucktor product language. **Thread** is runtime/provider-specific language and should appear only when discussing a runtime-native conversation or history object.

**Transcript vs Task Session History**:
Use **Transcript** for the ordered messages and events of one **Agent Session**. Use **Task Session History** for the history of **Agent Sessions** attached to a specific **Task**.

**Repo Session Read Model vs Session History Load**:
Use **Repo Session Read Model** for the startup session list built from persisted records plus runtime snapshots. Use **Session History Load** for loading the selected session's runtime-owned transcript and session details.

**Session Runtime Snapshot vs Session Status**:
Use **Session Runtime Snapshot** for the startup runtime signal. Use **Session Status** for OpenDucktor's interaction classification, such as **Running Session**, **Idle Session**, **Stopped Session**, or **Errored Session**.

**Runtime vs Model**:
Use **Runtime** for an integrated agent system such as OpenCode or Codex. Use **Model** for the selected AI model within that runtime.

**Runtime vs Runtime Descriptor**:
Use **Runtime** for the agent system itself. Use **Runtime Descriptor** for OpenDucktor's declared contract for that runtime.

**Runtime Instance vs Runtime Route**:
Use **Runtime Instance** for the live runtime OpenDucktor started or connected to. Use **Runtime Route** for how low-level runtime code reaches that instance.

**Runtime Session Reference vs Runtime Route**:
Use **Runtime Session Reference** in application code when carrying session identity. Use **Runtime Route** only in low-level registry/adapter code that actually contacts the runtime.

**Runtime Capabilities vs Model Capabilities**:
Use **Runtime Capabilities** for what the integrated agent system supports across sessions, history, approvals, prompt input, and optional surfaces. Use model-specific language only for selected-model behavior such as **Attachment Support**.

**Runtime vs Runtime Adapter**:
Use **Runtime** when talking about OpenCode, Codex, or another agent system OpenDucktor can run sessions on. **Runtime Adapter** is hexagonal architecture language for implementation code and does not belong in product workflow language.

**Repository vs Workspace**:
Use **Repository** for the local codebase a user opens and works on. Use **Workspace** only for technical boundary language where an external protocol or runtime scope already uses that word.

**Task vs Issue**:
Use **Task** for the unit of work. Use **Issue Type** only for the task classification and keep **issue** otherwise limited to existing technical names that already contain it. The `task` **Issue Type** value is a classification, not a different concept from **Task**.

**Task Status vs UI Label**:
Use **Task Status** for persisted lifecycle values such as `open`, `spec_ready`, or `closed`. UI labels such as Backlog or Done are not glossary terms.

**Task Metadata vs Task Field**:
Use **Task Metadata** for OpenDucktor-owned supporting data stored with a task, such as **Task Documents**, linked **Agent Sessions**, **Pull Request** data, and **Direct Merge** state. Use **Task Field** only when discussing primary user-authored task data such as title or description.

**Workflow Action vs OpenDucktor MCP Tool**:
Use **Workflow Action** for the product-level operation currently available for a **Task**. Use **Workflow MCP Tool** for the MCP mechanism a task-bound workflow agent calls to read or mutate **Task Workflow** state.

**Workflow Action vs Task Action**:
Use **Workflow Action** in product language. **Task Action** may appear in technical contract naming, but it is not the glossary term.

**Workflow MCP Tool vs Public Task MCP Tool**:
Use **Workflow MCP Tool** for task-bound workflow tools such as setting specs, recording **Build Completion**, or writing **QA Reports**. Use **Public Task MCP Tool** for external MCP task discovery or creation tools.

**Tool Call vs Tool Definition**:
Use **Tool Call** for a concrete invocation visible in a **Transcript**. Use **OpenDucktor MCP Tool** or **Native Runtime Tool** for the tool being invoked.

**Slash Command vs Shell Command**:
Use **Slash Command** for a structured **Chat Composer** input selected with `/`. Use shell command or bash command only for commands executed by a runtime tool or terminal.

**Slash Command vs Workflow Action**:
Use **Slash Command** for user prompt input inside **Agent Chat**. Use **Workflow Action** for a product-level operation available to a **Task**.

**Skill vs Skill Reference**:
Use **Skill** for the reusable instruction package listed in a **Skill Catalog**. Use **Skill Reference** for the structured **Chat Composer** part that points to one selected skill.

**File Reference vs Attachment**:
Use **File Reference** for repository files or directories mentioned as prompt context. Use **Attachment** for a local file sent with a **User Message**.

**File Reference vs File Diff**:
Use **File Reference** in the **Chat Composer**. Use **File Diff** in the **Git Panel**.

**Agent Role vs Workflow Role**:
Use **Agent Role** for any role an **Agent Session** can have. Use **Workflow Role** for the **Agent Roles** that participate in the **Task Workflow**.

**Subagent vs Agent Role**:
Use **Subagent** for runtime-supported child activity inside a parent **Agent Session**. Use **Agent Role** or **Workflow Role** for OpenDucktor-assigned session roles such as **Builder Agent** or **QA Agent**.

**Subagent Message vs Read-only Session View**:
Use **Subagent Message** for the parent **Transcript** entry summarizing child activity. Use **Read-only Session View** when the display surface for inspecting a child session transcript is meant.

**Workflow Role vs Task Documents**:
Use **Spec Agent**, **Planner Agent**, **Builder Agent**, and **QA Agent** for **Workflow Roles**. Use **Spec Document**, **Implementation Plan**, and **QA Report** for **Task Documents**.

**Implementation Plan vs Plan Document**:
Use **Implementation Plan** for the Builder-ready plan. Do not shorten it to **Plan Document**; the longer term is clearer and already familiar in coding-agent workflows.

**QA Report vs QA Verdict**:
Use **QA Report** for the document produced by a **QA Review**. Use **QA Verdict** for whether that report approves or rejects the current implementation state.

**Human Approval vs QA Approval**:
Use **Human Approval** for the human action that accepts the current task outcome for completion. Use **QA Approval** for the approved **QA Verdict** produced by **QA Review**.

**QA Rejection vs Change Request**:
Use **QA Rejection** for a rejected **QA Verdict** from **QA Review**. Use **Change Request** for the human action that asks for rework from `human_review` or `ai_review`.

**Build vs Build Completion**:
Avoid standalone **Build** as a domain noun because it can mean a software build command. Use **Builder Agent** for the role, **Build Worktree** for implementation isolation, and **Build Completion** for the workflow event.

**Task Completion Path vs Git Merge Method**:
Use **Task Completion Path** for the OpenDucktor route after **Human Approval**, such as **Pull Request** or **Direct Merge**. Use **Git Merge Method** for the internal Git operation used by **Direct Merge**: `merge_commit`, `squash`, or `rebase`.

**Git Panel vs Build Tools**:
Use **Build Tools** for the Agent Studio area that groups implementation inspection and operations. Use **Git Panel** for the git-specific surface inside **Build Tools**.

**Target Diff vs Uncommitted Diff**:
Use **Target Diff** for comparison against the **Target Branch**. Use **Uncommitted Diff** for local working-tree changes.

**Git Conflict vs QA Rejection**:
Use **Git Conflict** for a git operation conflict. Use **QA Rejection** for a rejected **QA Verdict** from **QA Review**.

**Open In vs Tool Call**:
Use **Open In** for the Agent Studio action that opens a repository or **Build Worktree** in an external application. Use **Tool Call** for a runtime tool invocation inside an **Agent Session**.

**AI Review vs QA Review**:
Use **AI Review** for the persisted **Task Status**. Use **QA Review** for the activity performed by the **QA Agent**.

**Blocked vs Waiting for Input**:
Use **Blocked** when the **Task** is stuck in the **Builder Agent** workflow. Use **Waiting for Input** when an **Agent Session** is pending a **Structured Question** or **Permission Prompt**.

**Permission Prompt vs Structured Question**:
Use **Permission Prompt** when the session asks whether an operation may proceed. Use **Structured Question** when the session asks the user to provide information.

**Human Review vs Human Actions**:
Use **Human Review** for the **Task Status**. Use **Human Approval** and **Change Request** for the concrete human actions taken from that state.

**Human Approval vs Approve Task**:
Use **Human Approval** in glossary, specs, plans, QA reports, and architecture discussions. "Approve Task" may appear as UI wording for users, but it is not the domain term.

## Example Dialogue

Developer: "This feature **Task** is in `spec_ready`, so the **Planner Agent** can create an **Implementation Plan**."

Domain expert: "Right. When the **Implementation Plan** is accepted through the **Workflow Action**, the **Task** moves to `ready_for_dev`."

Developer: "Then the **Builder Agent** starts an **Agent Session** in a **Build Worktree** using the selected **Runtime**."

Domain expert: "Yes. The **Agent Session** is the **Builder Agent** conversation. The **Runtime Instance** is the running local OpenCode or Codex process behind it."

Developer: "After implementation, the **Builder Agent** calls the **Workflow MCP Tool** for **Build Completion**."

Domain expert: "And if QA is required, the **Task** enters **AI Review**. The **QA Agent** writes a **QA Report** with a **QA Verdict** before **Human Review** accepts the work or requests changes."
