/** The count with the word, such as "1 file" or "3 files". */
export const plural = (count: number, word: string): string =>
  count === 1 ? `1 ${word}` : `${count} ${word}s`;
