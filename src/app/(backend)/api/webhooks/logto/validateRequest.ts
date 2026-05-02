import { headers } from 'next/headers';
import { createHmac } from 'node:crypto';

import { authEnv } from '@/envs/auth';
import { timingSafeCompareHex } from '@/utils/timingSafeCompare';

export type LogtToUserEntity = {
  applicationId?: string;
  avatar?: string;
  createdAt?: string;
  customData?: object;
  id: string;
  identities?: object;
  isSuspended?: boolean;
  lastSignInAt?: string;
  name?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  username?: string;
};

interface LogtoWebhookPayload {
  // Only support user event currently
  data: LogtToUserEntity;
  event: string;
}

export const validateRequest = async (request: Request, signingKey: string) => {
  const payloadString = await request.text();
  const headerPayload = await headers();
  const logtoHeaderSignature = headerPayload.get('logto-signature-sha-256')!;
  try {
    const hmac = createHmac('sha256', signingKey);
    hmac.update(payloadString);
    const signature = hmac.digest('hex');
    // PHO-245 / A1.12: constant-time compare on the HMAC-SHA256 hex digest
    // prevents byte-by-byte timing attacks on the signature.
    if (logtoHeaderSignature && timingSafeCompareHex(signature, logtoHeaderSignature)) {
      return JSON.parse(payloadString) as LogtoWebhookPayload;
    } else {
      console.warn(
        '[logto]: signature verify failed, please check your logto signature in `LOGTO_WEBHOOK_SIGNING_KEY`',
      );
      return;
    }
  } catch (e) {
    if (!authEnv.LOGTO_WEBHOOK_SIGNING_KEY) {
      throw new Error('`LOGTO_WEBHOOK_SIGNING_KEY` environment variable is missing.');
    }
    console.error('[logto]: incoming webhook failed in verification.\n', e);
    return;
  }
};
