export type SetSpecInput = {
  taskId: string;
  markdown: string;
};

export type SetSpecOutput = {
  updatedAt: string;
};

export type SetPlanInput = {
  taskId: string;
  markdown: string;
  subtasks?: Array<{
    title: string;
    issueType?: "task" | "feature" | "bug";
    priority?: number;
    description?: string;
  }>;
};

export type SetPlanOutput = {
  updatedAt: string;
};

export interface PlannerTools {
  setSpec(input: SetSpecInput): Promise<SetSpecOutput>;
  setPlan(input: SetPlanInput): Promise<SetPlanOutput>;
}
