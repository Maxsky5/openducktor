import { rm } from "node:fs/promises";

export const removeTestDirectory = async (path: string): Promise<void> => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
};
