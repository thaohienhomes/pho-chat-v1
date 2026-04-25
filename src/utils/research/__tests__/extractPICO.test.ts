import { describe, expect, it, vi } from 'vitest';

import { extractPICO } from '../extractPICO';

const VALID_PICO = JSON.stringify({
    comparison: 'Placebo',
    intervention: 'Liraglutide 3 mg subcutaneous',
    outcome: 'Body weight reduction at 56 weeks',
    population: 'Adults with obesity (BMI ≥ 30)',
});

describe('extractPICO', () => {
    const model = 'test-model';

    it('parses a clean JSON response into PICO fields', async () => {
        const callAI = vi.fn().mockResolvedValue(VALID_PICO);
        const result = await extractPICO('liraglutide 3 mg for obesity', callAI, model);

        expect(result.fellBack).toBe(false);
        expect(result.pico.population).toBe('Adults with obesity (BMI ≥ 30)');
        expect(result.pico.intervention).toBe('Liraglutide 3 mg subcutaneous');
        expect(result.pico.comparison).toBe('Placebo');
        expect(result.pico.outcome).toBe('Body weight reduction at 56 weeks');
    });

    it('strips ```json ... ``` fences before parsing', async () => {
        const callAI = vi.fn().mockResolvedValue('```json\n' + VALID_PICO + '\n```');
        const result = await extractPICO('any query', callAI, model);

        expect(result.fellBack).toBe(false);
        expect(result.pico.population).toBe('Adults with obesity (BMI ≥ 30)');
    });

    it('strips bare ``` fences before parsing', async () => {
        const callAI = vi.fn().mockResolvedValue('```\n' + VALID_PICO + '\n```');
        const result = await extractPICO('any query', callAI, model);

        expect(result.fellBack).toBe(false);
        expect(result.pico.intervention).toBe('Liraglutide 3 mg subcutaneous');
    });

    it('falls back gracefully when JSON is malformed', async () => {
        const callAI = vi.fn().mockResolvedValue('this is not json at all');
        const result = await extractPICO('semaglutide for T2DM', callAI, model);

        expect(result.fellBack).toBe(true);
        expect(result.pico.population).toBe('Study population');
        expect(result.pico.intervention).toBe('semaglutide for T2DM');
        expect(result.pico.comparison).toBe('Placebo / Standard care');
        expect(result.pico.outcome).toBe('Clinical outcomes');
    });

    it('falls back when JSON shape is missing required fields', async () => {
        const callAI = vi.fn().mockResolvedValue('{"population": "kids", "intervention": "vaccine"}');
        const result = await extractPICO('q', callAI, model);

        expect(result.fellBack).toBe(true);
    });

    it('falls back when callAI throws', async () => {
        const callAI = vi.fn().mockRejectedValue(new Error('network down'));
        const result = await extractPICO('any query', callAI, model);

        expect(result.fellBack).toBe(true);
        expect(result.pico.population).toBe('Study population');
    });

    it('truncates over-long fields to the field cap', async () => {
        const long = 'x'.repeat(500);
        const overLong = JSON.stringify({
            comparison: long,
            intervention: long,
            outcome: long,
            population: long,
        });
        const callAI = vi.fn().mockResolvedValue(overLong);
        const result = await extractPICO('q', callAI, model);

        expect(result.fellBack).toBe(false);
        expect(result.pico.population.length).toBeLessThanOrEqual(200);
        expect(result.pico.intervention.length).toBeLessThanOrEqual(200);
        expect(result.pico.comparison.length).toBeLessThanOrEqual(200);
        expect(result.pico.outcome.length).toBeLessThanOrEqual(200);
    });
});
