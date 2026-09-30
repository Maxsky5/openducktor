import { readLatestRelease } from "../../config/release";
import { REPOSITORY } from "./site";

/** The latest published release, read once for each build or dev server start. */
export const release = await readLatestRelease(REPOSITORY, process.env.GITHUB_TOKEN);
