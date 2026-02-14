export type SetSpecMarkdownInput = {
  taskId: string;
  markdown: string;
};

export type SetSpecMarkdownOutput = {
  updatedAt: string;
};

export interface PlannerTools {
  setSpecMarkdown(input: SetSpecMarkdownInput): Promise<SetSpecMarkdownOutput>;
}
