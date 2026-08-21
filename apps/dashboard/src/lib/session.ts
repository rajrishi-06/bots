import { cache } from "react";

/**
 * Auth boundary.
 *
 * The plan calls for Clerk, and this is the seam it drops into: one function
 * returning an org id. It is a development stub today — every page goes through
 * it, so swapping in Clerk's `auth()` is a change to this file and nothing else.
 *
 * It deliberately does NOT fall back to "any org" in production: an auth stub
 * that silently authorises is worse than no auth, because it looks finished.
 */
export interface Session {
  orgId: string;
  userId: string;
  email: string;
}

export const getSession = cache(async (): Promise<Session> => {
  if (process.env.NODE_ENV === "production" && !process.env.DEV_ORG_ID) {
    throw new Error(
      "No auth provider configured. Wire Clerk into src/lib/session.ts before deploying — " +
        "the development stub must not run in production.",
    );
  }
  const orgId = process.env.DEV_ORG_ID;
  if (!orgId) throw new Error("Set DEV_ORG_ID to an organizations.id row for local development.");
  return { orgId, userId: process.env.DEV_USER_ID ?? orgId, email: "dev@localhost" };
});
