'use server';

import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { adminAuditLogs, providerBalances } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { assertAdmin } from '@/server/services/auth/adminGuard';

export async function updateProviderBalance(providerId: string, balanceUsd: number) {
  // PHO-238 A1.1: HOTFIX — verify admin first; this action mutates provider USD balances.
  await assertAdmin();

  const db = await getServerDB();

  const existing = await db.query.providerBalances.findFirst({
    where: eq(providerBalances.providerId, providerId),
  });

  if (existing) {
    await db
      .update(providerBalances)
      .set({
        prepaidBalanceUsd: balanceUsd,
        updatedAt: new Date(),
      })
      .where(eq(providerBalances.providerId, providerId));
  } else {
    await db.insert(providerBalances).values({
      prepaidBalanceUsd: balanceUsd,
      providerId,
    });
  }

  const { userId: adminId } = await auth();
  if (adminId) {
    await db.insert(adminAuditLogs).values({
      action: 'UPDATE_PROVIDER_BALANCE',
      adminId,
      details: { newValue: balanceUsd, previousValue: existing?.prepaidBalanceUsd || 0 },
      targetId: providerId,
      targetType: 'provider',
    });
  }

  revalidatePath('/admin/providers');
}
