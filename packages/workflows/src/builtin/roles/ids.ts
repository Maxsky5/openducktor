/** The IDs of the built-in roles. */
export const BUILTIN_ROLE_IDS = ["spec", "planner", "build", "qa"] as const;
export type BuiltinRoleId = (typeof BUILTIN_ROLE_IDS)[number];
