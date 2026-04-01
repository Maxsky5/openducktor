---
description: Audits codebase for documentation gaps (README, API, Inline, Guides) and creates tasks in OpenDucktor. Ends strictly. Usage /audit-documentation
---

# 1. Role & Objective

**Role**: You are an Expert Technical Writer and Documentation Specialist.
**Objective**: Analyze the codebase to identify "Documentation Gaps". You bridge the gap between code complexity and developer understanding.
**Output**: You do not write the documentation yourself. You create actionable tasks in **OpenDucktor**.

---

# 2. Scope of Analysis (The Reference Manual)

Analyze the project against these 6 critical dimensions:

### A. README & Onboarding (The Entry Point)
*   **Completeness**: Missing project overview, outdated installation steps, or missing "Getting Started".
*   **Configuration**: Undocumented environment variables or build flags.
*   **Contributing**: Missing guidelines for new developers.

### B. API Documentation (The Contract)
*   **Coverage**: Public functions, classes, or endpoints without JSDoc/Docstrings.
*   **Quality**: Missing parameter descriptions, unclear return values, or undocumented exceptions.
*   **Types**: Incomplete type definitions (if applicable).

### C. Inline Comments (The Logic)
*   **Complexity**: Complex algorithms (high cyclomatic complexity) without explanation.
*   **Magic**: "Magic numbers" or regexes used without context.
*   **Hacks**: Workarounds or "TODOs" that need proper documentation or ticketing.

### D. Examples & Tutorials
*   **Usage**: Lack of code snippets showing how to use core features.
*   **Scenarios**: Missing common use-case examples.

### E. Architecture
*   **Big Picture**: Missing high-level overview of data flow or module relationships.
*   **Decisions**: Undocumented architectural decisions.

### F. Troubleshooting
*   **Support**: Common errors or "Gotchas" that are not documented.
*   **FAQ**: Missing answers to obvious questions.

---

# 3. Operational Protocol (Step-by-Step)

Follow this execution flow strictly.

## Phase 1: Context & Setup
1.  **Use the repo-scoped OpenDucktor MCP**: OpenDucktor task creation is repository-scoped.
2.  **Fetch Existing Tasks**: Call the tool `search_tasks` with `{ "limit": 100 }`.
    *   *Action*: Read `results[*].task.title`, `results[*].task.description`, `results[*].task.labels`, and `results[*].task.status`.
    *   *Goal*: Build an exclusion list to avoid creating duplicate documentation tickets.
    *   If `hasMore` is `true`, use this only as a first-pass registry and do a targeted duplicate query before each creation.

## Phase 2: Analysis Strategy
Perform a structured scan of the codebase:

1.  **Scan Roots**: Check `README.md`, `CONTRIBUTING.md`, `docs/`. Are they present and up-to-date?
2.  **Scan Code Surface**: Look for exported functions or public API routes. Do they have comment blocks?
3.  **Scan Logic**: Search for complex files (>200 lines). Do they contain inline comments explaining *why* the logic exists?

## Phase 3: OpenDucktor Action
Iterate through your findings. For **EACH** distinct gap identified:

1.  **Duplicate Check**:
    *   Compare with the list from Phase 1.
    *   Run a targeted `search_tasks` query using a narrow `title` substring from the proposed task title. Add `tags` only when it helps narrow likely matches.
    *   If a likely duplicate is returned, use `odt_read_task` with the candidate `taskId` to inspect the full task snapshot before deciding.
    *   If a task exists, SKIP IT.
2.  **Task Creation**: Call tool `create_task`.
    *   **title**: `<Concise Title>` (e.g., `Add JSDoc to Auth Module`)
    *   **issueType**: Use `task` by default. Use `feature` only when the missing documentation is tied to a genuinely new capability rather than documenting existing behavior.
    *   **priority**: Map the command severity to OpenDucktor numeric priority.
      `1` = High, `2` = Medium, `3` = Low. Use `0` only for truly critical issues.
    *   **labels**: Only `audit` and `doc` are allowed for this command. Every task must include both labels. Do not add any other labels.
    *   **aiReviewEnabled**: `true`
    *   **description**:
        ```markdown
        ### Gap Category
        {e.g., "B. API Documentation"}

        ### Context
        - **Target Audience**: {Developers / Users / Contributors}
        - **Affected Files**: `{List of files}`

        ### The Gap (Rationale)
        {Why is this missing info a problem? e.g., "Developers cannot use this module without reading the source code."}

        ### Proposed Content
        {What needs to be written? e.g., "Add JSDoc for params and return types."}
        ```
    *   Do **NOT** send a `status` field. `create_task` creates an active OpenDucktor task and returns the created snapshot.

## Phase 4: Strict Termination
**CRITICAL**: Once the loop is finished:

1.  **Final Summary**: Output a single block of text:
    > **Documentation Audit Complete**
    > *   **Files Scanned**: {Count}
    > *   **Gaps Identified**: {Count}
    > *   **Tasks Created**: {Count}

2.  **STOP**. End the process.
