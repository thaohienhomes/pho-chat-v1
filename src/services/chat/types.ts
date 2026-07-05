import { TracePayload } from '@lobechat/types';

import { FetchSSEOptions } from '@/utils/fetch';

export interface FetchOptions extends FetchSSEOptions {
  /**
   * Cost-attribution label sent to the server as `x-pho-feature` so background
   * AI calls (title-gen and other preset chains) can be split from interactive
   * chat in usage logs and PostHog.
   */
  feature?: string;
  historySummary?: string;
  isWelcomeQuestion?: boolean;
  signal?: AbortSignal | undefined;
  trace?: TracePayload;
}
