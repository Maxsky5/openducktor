const MARKDOWN_SYNTAX_HINT_PATTERN =
  /(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+|```|~~~|(?:-{3,}|\*{3,}|_{3,})\s*$)|`[^`\n]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|~~[^~\n]+~~|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|(?:^|\n)\|.*\||\bhttps?:\/\/[^\s<]+/m;

export const hasMarkdownSyntaxHint = (value: string): boolean => {
  return MARKDOWN_SYNTAX_HINT_PATTERN.test(value);
};
