/** True when a file path names a Markdown file, which clients show as a formatted document. */
export function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}
