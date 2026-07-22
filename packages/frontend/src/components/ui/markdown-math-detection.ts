const FENCED_CODE_PATTERN =
  /(^|\n)[ \t]{0,3}(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]{0,3}\2[ \t]*(?=\r?\n|$)/g;
const INLINE_CODE_PATTERN = /`+[^`]*`+/g;
const BLOCK_MATH_PATTERN = /(^|\n)[ \t]{0,3}\$\$[\s\S]*?\$\$[ \t]*(?=\r?\n|$)/;
const INLINE_MATH_PATTERN = /(^|[^\\$])\$([^\s$](?:[^$\n]*[^\s$])?)\$/;

export const hasMarkdownMath = (markdown: string): boolean => {
  const prose = markdown.replace(FENCED_CODE_PATTERN, "\n").replace(INLINE_CODE_PATTERN, "");
  return BLOCK_MATH_PATTERN.test(prose) || INLINE_MATH_PATTERN.test(prose);
};
