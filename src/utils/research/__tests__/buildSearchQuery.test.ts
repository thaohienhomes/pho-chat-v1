import { describe, expect, it, vi } from 'vitest';

import { buildSearchQuery, detectLanguage } from '../buildSearchQuery';

describe('detectLanguage', () => {
    it('returns "en" for plain ASCII English', () => {
        expect(detectLanguage('hello world')).toBe('en');
    });

    it('returns "vi" for Vietnamese with diacritics', () => {
        expect(detectLanguage('xin chào bác sĩ')).toBe('vi');
    });

    it('returns "other" for non-ASCII non-Vietnamese (e.g. Chinese)', () => {
        expect(detectLanguage('北京大学')).toBe('other');
    });

    it('returns "vi" for mixed EN/VN when any Vietnamese diacritic appears', () => {
        expect(detectLanguage('GLP-1 và semaglutide')).toBe('vi');
    });

    it('returns "en" for empty string (no non-ASCII)', () => {
        expect(detectLanguage('')).toBe('en');
    });
});

describe('buildSearchQuery', () => {
    const model = 'test-model';

    it('returns the original query unchanged for English input (no callAI call)', async () => {
        const callAI = vi.fn().mockResolvedValue('SHOULD_NOT_BE_USED');
        const result = await buildSearchQuery('metformin diabetes prevention', callAI, model);

        expect(result.translated).toBe(false);
        expect(result.searchQuery).toBe('metformin diabetes prevention');
        expect(result.detectedLanguage).toBe('en');
        expect(result.fellBackToOriginal).toBe(false);
        expect(callAI).not.toHaveBeenCalled();
    });

    it('translates Vietnamese input via callAI', async () => {
        const callAI = vi
            .fn()
            .mockResolvedValue('liraglutide cardiovascular outcomes type 2 diabetes');
        const result = await buildSearchQuery(
            'liraglutide kết cục tim mạch ở bệnh nhân đái tháo đường tuýp 2',
            callAI,
            model,
        );

        expect(result.translated).toBe(true);
        expect(result.detectedLanguage).toBe('vi');
        expect(result.searchQuery).toBe('liraglutide cardiovascular outcomes type 2 diabetes');
        expect(result.fellBackToOriginal).toBe(false);
        expect(callAI).toHaveBeenCalledTimes(1);
    });

    it('strips quotes, "Query:" prefix, and collapses whitespace from LLM output', async () => {
        const callAI = vi
            .fn()
            .mockResolvedValue('  Query: "tirzepatide   weight loss obesity"  ');
        const result = await buildSearchQuery(
            'tirzepatide giảm cân ở bệnh nhân béo phì câu test sạch hóa',
            callAI,
            model,
        );

        expect(result.searchQuery).toBe('tirzepatide weight loss obesity');
        expect(result.translated).toBe(true);
    });

    it('falls back to the original Vietnamese query when callAI throws', async () => {
        const callAI = vi.fn().mockRejectedValue(new Error('boom'));
        const original = 'sàng lọc ung thư đại tràng nội soi (test fallback throw)';
        const result = await buildSearchQuery(original, callAI, model);

        expect(result.translated).toBe(false);
        expect(result.fellBackToOriginal).toBe(true);
        expect(result.searchQuery).toBe(original);
        expect(result.detectedLanguage).toBe('vi');
    });

    it('falls back when LLM returns an empty / non-letter response', async () => {
        const callAI = vi.fn().mockResolvedValue('   ');
        const result = await buildSearchQuery(
            'điều trị tăng huyết áp ở người cao tuổi (test empty)',
            callAI,
            model,
        );

        expect(result.translated).toBe(false);
        expect(result.fellBackToOriginal).toBe(true);
    });

    it('returns input unchanged for empty string', async () => {
        const callAI = vi.fn();
        const result = await buildSearchQuery('', callAI, model);

        expect(result.translated).toBe(false);
        expect(result.searchQuery).toBe('');
        expect(callAI).not.toHaveBeenCalled();
    });
});
