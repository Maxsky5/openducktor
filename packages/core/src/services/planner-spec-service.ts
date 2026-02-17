import {
  defaultSpecTemplateMarkdown,
  missingSpecSections,
  validateSpecMarkdown,
} from "@openblueprint/contracts";
import type { PlannerTools } from "../types/planner";

export class PlannerSpecService {
  constructor(private readonly tools: PlannerTools) {}

  template(): string {
    return defaultSpecTemplateMarkdown;
  }

  validate(markdown: string): { valid: boolean; missing: string[] } {
    return validateSpecMarkdown(markdown);
  }

  missingSections(markdown: string): string[] {
    return missingSpecSections(markdown);
  }

  async save(taskId: string, markdown: string): Promise<{ updatedAt: string }> {
    const validation = this.validate(markdown);
    if (!validation.valid) {
      throw new Error(`Spec is missing required sections: ${validation.missing.join(", ")}`);
    }

    return this.tools.setSpec({ taskId, markdown });
  }
}
