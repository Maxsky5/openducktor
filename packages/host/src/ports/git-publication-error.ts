import { HostOperationError } from "../effect/host-errors";
import type { GitPublicationProgress } from "./git-port";

/** Public progress contains safe identities. Native endpoint URLs and output stay private. */
export class GitPublicationError extends HostOperationError<{
  publication: GitPublicationProgress;
}> {
  constructor(
    message: string,
    readonly publication: GitPublicationProgress,
  ) {
    super({ operation: "git.publication", message, details: { publication } });
  }
}
