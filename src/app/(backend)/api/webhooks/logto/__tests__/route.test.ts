import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

interface UserDataUpdatedEvent {
  createdAt: string;
  data: {
    applicationId: string;
    avatar: string | null;
    createdAt: number;
    customData: Record<string, unknown>;
    id: string;
    identities: Record<string, unknown>;
    isSuspended: boolean;
    lastSignInAt: number;
    name: string;
    primaryEmail: string;
    primaryPhone: string | null;
    profile: Record<string, unknown>;
    updatedAt: number;
    username: string;
  };
  event: string;
  hookId: string;
  ip: string;
  matchedRoute: string;
  method: string;
  params: {
    userId: string;
  };
  path: string;
  status: number;
  userAgent: string;
}

const userDataUpdatedEvent: UserDataUpdatedEvent = {
  createdAt: '2024-09-07T08:29:09.381Z',
  data: {
    applicationId: 'appid',
    avatar: null,
    createdAt: 1_725_440_405_556,
    customData: {},
    id: 'uid',
    identities: {},
    isSuspended: false,
    lastSignInAt: 1_725_446_291_545,
    name: 'test',
    primaryEmail: 'user@example.com',
    primaryPhone: null,
    profile: {},
    updatedAt: 1_725_697_749_337,
    username: 'test',
  },
  event: 'User.Data.Updated',
  hookId: 'hookId',
  ip: '223.104.76.217',
  matchedRoute: '/users/:userId',
  method: 'PATCH',
  params: {
    userId: 'rra41h9vmpnd',
  },
  path: '/users/rra41h9vmpnd',
  status: 200,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
};

const LOGTO_WEBHOOK_SIGNING_KEY = 'logto-signing-key';

// Test Logto Webhooks in Local dev, here is some tips:
// - Replace the var `LOGTO_WEBHOOK_SIGNING_KEY` with the actual value in your `.env` file
// - Start web request: If you want to run the test, replace `describe.skip` with `describe` below

describe.skip('Test Logto Webhooks in Local dev', () => {
  // describe('Test Logto Webhooks in Local dev', () => {
  it('should send a POST request with logto headers', async () => {
    const url = 'http://localhost:3010/api/webhooks/logto'; // 替换为目标URL
    const data = userDataUpdatedEvent;
    //  Generate data signature
    const hmac = createHmac('sha256', LOGTO_WEBHOOK_SIGNING_KEY!);
    hmac.update(JSON.stringify(data));
    const signature = hmac.digest('hex');
    const response = await fetch(url, {
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
        'logto-signature-sha-256': signature,
      },
      method: 'POST',
    });
    expect(response.status).toBe(200); // 检查响应状态
  });
});
