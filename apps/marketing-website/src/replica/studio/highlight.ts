// Build-time token colors for the sample TypeScript. The rules cover only the sample code.
export type Token = { text: string; tone: string };

const PATTERN =
  /(\/\/.*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)|(\d+)|(\s+|.)/g;
const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "const",
  "export",
  "from",
  "function",
  "if",
  "import",
  "instanceof",
  "return",
]);
const CONSTANTS = new Set(["boolean", "false", "null", "true", "undefined", "void"]);

function identifierTone(name: string, rest: string): string {
  if (KEYWORDS.has(name)) return "tk-k";
  if (CONSTANTS.has(name) || /^[A-Z]/.test(name)) return "tk-c";
  if (rest.startsWith("(")) return "tk-f";
  return "";
}

/** Splits one line of code into colored tokens. Plain neighbors merge into one token. */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  for (const match of line.matchAll(PATTERN)) {
    const [text, comment, literal, identifier, digits] = match;
    let tone = "";
    if (comment) tone = "tk-m";
    else if (literal) tone = "tk-s";
    else if (identifier) tone = identifierTone(identifier, line.slice(match.index + text.length));
    else if (digits) tone = "tk-c";
    const last = tokens.at(-1);
    if (last && last.tone === tone) last.text += text;
    else tokens.push({ text, tone });
  }
  return tokens;
}
