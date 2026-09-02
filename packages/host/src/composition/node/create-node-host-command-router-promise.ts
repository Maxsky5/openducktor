import { Effect } from "effect";
import {
  type HostCommandRouter,
  toPromiseHostCommandRouter,
} from "../../interface/router/host-command-router";
import { createNodeEffectHostCommandRouter } from "./create-node-effect-host-command-router";
import type { CreateNodeHostCommandRouterInput } from "./node-host-command-router-types";

export const createNodeHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
): Promise<HostCommandRouter> =>
  Effect.runPromise(
    createNodeEffectHostCommandRouter(input).pipe(Effect.map(toPromiseHostCommandRouter)),
  );
