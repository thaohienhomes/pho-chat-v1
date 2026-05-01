/**
 * Admin authorization guard for Next.js Server Actions.
 *
 * Use `assertAdmin()` at the top of every `'use server'` function that
 * mutates privileged state (points, plan, subscription, provider balance).
 *
 * Why this exists: server actions in Next.js are exposed as POST endpoints
 * keyed by an action ID embedded in the client bundle. Without an explicit
 * caller check, any authenticated user who discovers the action ID can
 * invoke the action with arbitrary args. The audit-1 finding A1.1
 * (PHO-238) documented four such functions in (admin)/admin/.../actions.ts
 * that lacked an admin check entirely.
 *
 * Sibling helper for API routes lives at `src/app/api/admin/_shared/auth.ts`
 * (`requireAdmin()` → returns `NextResponse`). This file is the throwing
 * variant for server actions, where there is no Response to return.
 */
import { auth, clerkClient } from '@clerk/nextjs/server';

/**
 * Build the admin allowlist from env. Supports two env vars for migration:
 * - ADMIN_USER_IDS — comma-separated list (new, preferred)
 * - ADMIN_USER_ID  — single id (legacy, kept for backward compat with
 *   existing requireAdmin() in src/app/api/admin/_shared/auth.ts)
 */
const buildAdminUserIds = (): Set<string> => {
  const ids = new Set<string>();
  const plural = process.env.ADMIN_USER_IDS;
  if (plural) {
    for (const id of plural.split(',')) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  const singular = process.env.ADMIN_USER_ID;
  if (singular) ids.add(singular.trim());
  return ids;
};

/**
 * Check whether a Clerk userId is an admin.
 *
 * Two layers, in order:
 * 1. Env-pinned allowlist (ADMIN_USER_IDS or ADMIN_USER_ID). Most secure —
 *    requires Vercel env access to grant admin.
 * 2. Clerk metadata `role === 'admin'` on privateMetadata (preferred) or
 *    publicMetadata (fallback). Less secure — anyone with Clerk Dashboard
 *    access can grant — but kept as a soft fallback so support staff can
 *    promote without a redeploy.
 */
export const isAdmin = async (userId: string): Promise<boolean> => {
  if (!userId) return false;

  if (buildAdminUserIds().has(userId)) return true;

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const privateRole = (user.privateMetadata as Record<string, unknown> | null)?.role;
    const publicRole = (user.publicMetadata as Record<string, unknown> | null)?.role;
    return privateRole === 'admin' || publicRole === 'admin';
  } catch {
    return false;
  }
};

/**
 * Throws when the current request is not from an authenticated admin.
 * Intended for use as the first line of every privileged server action:
 *
 * ```ts
 * 'use server';
 * import { assertAdmin } from '@/server/services/auth/adminGuard';
 *
 * export async function changeUserPlan(userId: string, formData: FormData) {
 *   await assertAdmin();
 *   // …
 * }
 * ```
 *
 * The thrown errors are caught by Next.js's server-action error boundary
 * and surfaced to the client as generic `Error` objects, which is the
 * desired behavior — non-admins should not learn anything about the
 * shape of the action.
 */
export const assertAdmin = async (): Promise<string> => {
  const { userId } = await auth();
  if (!userId) throw new Error('UNAUTHORIZED');
  if (!(await isAdmin(userId))) throw new Error('FORBIDDEN: admin access required');
  return userId;
};
