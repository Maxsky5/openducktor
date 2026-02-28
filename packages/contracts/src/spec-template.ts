export const specTemplateSections = [
  {
    heading: "Purpose",
    purpose: "Why this feature exists and the expected user/developer outcome.",
  },
  {
    heading: "Problem",
    purpose: "The current pain, risk, or failure that the feature resolves.",
  },
  {
    heading: "Goals",
    purpose: "The measurable outcomes the feature must achieve.",
  },
  {
    heading: "Non-goals",
    purpose: "What is intentionally out of scope for this iteration.",
  },
  {
    heading: "Scope",
    purpose: "The functional boundaries and affected systems/components.",
  },
  {
    heading: "API / Interfaces",
    purpose: "Contracts, data shapes, and integration boundaries.",
  },
  {
    heading: "Risks",
    purpose: "Technical/product risks plus mitigation strategy.",
  },
  {
    heading: "Test Plan",
    purpose: "Verification scenarios, checks, and pass criteria.",
  },
] as const;

export const defaultSpecTemplateMarkdown = specTemplateSections
  .map((section) => `# ${section.heading}\n\n> Purpose: ${section.purpose}\n\n`)
  .join("\n");

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");

export const missingSpecSections = (markdown: string): string[] => {
  return specTemplateSections
    .map((section) => section.heading)
    .filter((heading) => {
      const pattern = new RegExp(`(^|\\n)#{1,6}\\s+${escapeRegExp(heading)}\\s*(\\n|$)`, "i");
      return !pattern.test(markdown);
    });
};

export const validateSpecMarkdown = (markdown: string): { valid: boolean; missing: string[] } => {
  const missing = missingSpecSections(markdown);
  return { valid: missing.length === 0, missing };
};
