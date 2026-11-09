import { describe, expect, it } from 'vitest';
import { decodeArchiveContract } from './archiveContract.mjs';
import contract from './generated/archive_contract.json';

const archives = decodeArchiveContract(contract);
const locales = import.meta.glob<{ default: Record<string, unknown> }>('../locale/data/game/*.json', { eager: true });

describe('archive acquisition data', () => {
    it('routes Ancestral Spring through its side mission without inventing a grant stage', () => {
        expect(archives.find((archive) => archive.id === 'nar_document_v1d2_8_1')?.acquisition)
            .toEqual({ method: 'mission', missionId: 'sm2l3m3' });
    });

    it('retains the explicit clock-log collection objective', () => {
        expect(archives.find((archive) => archive.id === 'nar_digital_map02_research11_12_1')?.acquisition)
            .toEqual({ method: 'mission', missionId: 'gm02m27d5', questId: 'gm02m27d5_q#4' });
    });

    it('keeps an untraced central archive unconfirmed', () => {
        expect(archives.find((archive) => archive.id === 'nar_document_v0d8_1_1')?.acquisition)
            .toEqual({ method: 'unknown' });
    });

    it('ships the new mission and objective labels in every game locale', () => {
        for (const { default: values } of Object.values(locales)) {
            for (const key of ['sm2l3m3', 'gm02m27d5', 'gm02m27d5_q#4']) {
                expect(values[key]).toBeTypeOf('string');
                expect(values[key]).not.toBe('');
            }
        }
    });
});
