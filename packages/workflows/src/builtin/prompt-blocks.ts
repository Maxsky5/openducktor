/** Text helpers of the built-in prompt templates. */
export function joinBlocks(...blocks: string[]): string {
  return blocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .join("\n\n");
}

export function bulletSection(title: string, items: string[]): string {
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

export function lineSection(title: string, lines: string[]): string {
  return `${title}:\n${lines.join("\n")}`;
}
