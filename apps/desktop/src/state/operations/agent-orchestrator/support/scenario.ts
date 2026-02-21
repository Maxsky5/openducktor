import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";

export const inferScenario = (
  role: AgentRole,
  task: TaskCard,
  docs: {
    specMarkdown: string;
    planMarkdown: string;
    qaMarkdown: string;
  },
): AgentScenario => {
  if (role === "spec") {
    return docs.specMarkdown.trim().length > 0 || task.status === "spec_ready"
      ? "spec_revision"
      : "spec_initial";
  }
  if (role === "planner") {
    return docs.planMarkdown.trim().length > 0 ? "planner_revision" : "planner_initial";
  }
  if (role === "qa") {
    return "qa_review";
  }

  if (docs.qaMarkdown.trim().length > 0 && task.status === "in_progress") {
    return "build_after_qa_rejected";
  }

  if (task.status === "in_progress" && docs.qaMarkdown.trim().length === 0) {
    return "build_after_human_request_changes";
  }

  return "build_implementation_start";
};

export const kickoffPrompt = (role: AgentRole, scenario: AgentScenario, taskId: string): string => {
  const taskInstruction = `Use taskId "${taskId}" for every odt_* tool call.`;
  if (role === "spec") {
    const base =
      scenario === "spec_revision"
        ? "Revise the current specification and call odt_set_spec with complete markdown when ready."
        : "Write the initial specification and call odt_set_spec with complete markdown when ready.";
    return `${base}\n${taskInstruction}`;
  }
  if (role === "planner") {
    const base =
      scenario === "planner_revision"
        ? "Revise the current implementation plan and call odt_set_plan when ready."
        : "Create the initial implementation plan and call odt_set_plan when ready.";
    return `${base}\n${taskInstruction}`;
  }
  if (role === "qa") {
    return `Perform QA review now and call exactly one of odt_qa_approved or odt_qa_rejected.\n${taskInstruction}`;
  }
  if (scenario === "build_after_qa_rejected") {
    return `Address all QA rejection findings and call odt_build_completed when done.\n${taskInstruction}`;
  }
  if (scenario === "build_after_human_request_changes") {
    return `Apply all human-requested changes and call odt_build_completed when done.\n${taskInstruction}`;
  }
  return `Start implementation now. Use odt_build_blocked/odt_build_resumed/odt_build_completed for workflow transitions.\n${taskInstruction}`;
};
