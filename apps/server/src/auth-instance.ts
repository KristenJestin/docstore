import type { createAuth } from "@docstore/auth";

/** Better Auth instance, injected so that `createApp` stays testable. */
export type AuthInstance = ReturnType<typeof createAuth>;
