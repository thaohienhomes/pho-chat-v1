'use server';

import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { adminAuditLogs, users } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { assertAdmin } from '@/server/services/auth/adminGuard';

export async function addPhoPoints(userId: string, amount: number) {
  // PHO-238 A1.1: HOTFIX — verify admin BEFORE try/catch so non-admin throws propagate.
  await assertAdmin();

  try {
    const db = await getServerDB();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) throw new Error('User not found');

    const currentPoints = user.phoPointsBalance || 0;
    await db
      .update(users)
      .set({ phoPointsBalance: currentPoints + amount })
      .where(eq(users.id, userId));

    const { userId: adminId } = await auth();
    if (adminId) {
      await db.insert(adminAuditLogs).values({
        action: 'TOPUP_POINTS',
        adminId,
        details: { amount, newValue: currentPoints + amount, previousValue: currentPoints },
        targetId: userId,
        targetType: 'user',
      });
    }

    revalidatePath(`/admin/users/${userId}`);
    revalidatePath('/admin/users');
  } catch (error) {
    console.error('Failed to add points:', error);
  }
}

export async function changeSubscriptionStatus(userId: string, formData: FormData) {
  // PHO-238 A1.1: HOTFIX — verify admin BEFORE try/catch so non-admin throws propagate.
  await assertAdmin();

  try {
    const status = formData.get('status') as string;
    const db = await getServerDB();
    await db.update(users).set({ subscriptionStatus: status }).where(eq(users.id, userId));

    const { userId: adminId } = await auth();
    if (adminId) {
      await db.insert(adminAuditLogs).values({
        action: 'CHANGE_STATUS',
        adminId,
        details: { newValue: status },
        targetId: userId,
        targetType: 'user',
      });
    }

    revalidatePath(`/admin/users/${userId}`);
    revalidatePath('/admin/users');
  } catch (error) {
    console.error('Failed to change status:', error);
  }
}

export async function changeUserPlan(userId: string, formData: FormData) {
  // PHO-238 A1.1: HOTFIX — verify admin BEFORE try/catch so non-admin throws propagate.
  await assertAdmin();

  try {
    const planId = formData.get('planId') as string;
    const db = await getServerDB();
    await db.update(users).set({ currentPlanId: planId }).where(eq(users.id, userId));

    const { userId: adminId } = await auth();
    if (adminId) {
      await db.insert(adminAuditLogs).values({
        action: 'CHANGE_PLAN',
        adminId,
        details: { newValue: planId },
        targetId: userId,
        targetType: 'user',
      });
    }

    revalidatePath(`/admin/users/${userId}`);
    revalidatePath('/admin/users');
  } catch (error) {
    console.error('Failed to change plan:', error);
  }
}
