/** Reports each wake of the computer from sleep and each screen unlock. Only the desktop shell has it. */
export type SystemWake = { subscribe(onWake: () => void): () => void };
