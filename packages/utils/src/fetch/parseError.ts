import { ChatMessageError, ErrorResponse, ErrorType } from '@lobechat/types';
import { t } from 'i18next';

/**
 * Pull a backend-provided user-facing message out of the error body, if any.
 *
 * Backends like the Pho daily-cap (PHO-238) or tier-block (PHO-241) paths embed
 * a localized message inside the body so the alert can show the specific reason
 * (e.g. "Bạn đã dùng hết hạn mức Tier 3 hôm nay ($26.50/$26.00)...") instead of
 * the generic translated key for the error type. We accept a few shapes that
 * have appeared in callers:
 *
 *   { body: { error: { message: "..." } } }   ← `createErrorResponse(...)` shape
 *   { body: { message: "..." } }              ← legacy / direct shape
 *   { body: { error: "..." } }                ← raw routes (artifact-ai, research)
 *
 * Falls back to undefined when nothing usable is present.
 */
const extractSpecificMessage = (body: any): string | undefined => {
  if (!body || typeof body !== 'object') return undefined;
  const candidates = [body.error?.message, body.message, body.error];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return undefined;
};

export const getMessageError = async (response: Response) => {
  let chatMessageError: ChatMessageError;

  // try to get the biz error
  try {
    const data = (await response.json()) as ErrorResponse;
    // PHO-238: prefer specific backend message (daily-cap detail, tier-block reason, ...)
    // over the generic translated key for the error type.
    const specific = extractSpecificMessage(data.body);
    chatMessageError = {
      body: data.body,
      message: specific ?? t(`response.${data.errorType}` as any, { ns: 'error' }),
      type: data.errorType,
    };
  } catch {
    // if not return, then it's a common error
    chatMessageError = {
      message: t(`response.${response.status}` as any, { ns: 'error' }),
      type: response.status as ErrorType,
    };
  }

  return chatMessageError;
};
