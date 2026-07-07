import {describe, expect, it} from 'vitest';
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	type MarginaliaSettings,
} from '../../src/settings';

const normalizeLegacy = normalizeSettings as unknown as (
	raw: Record<string, unknown> | null | undefined,
	manifestDir?: string,
) => MarginaliaSettings;

describe('settings compatibility', () => {
	it('maps develop vault paths into the current preset model', () => {
		expect(normalizeLegacy({storageLocation: '.marginalia'}, '.config/plugins/marginalia'))
			.toMatchObject({storagePreset: 'vault', customStoragePath: '.marginalia'});
	});

	it('maps develop plugin and custom paths without losing their location', () => {
		expect(normalizeLegacy(
			{storageLocation: '.config/plugins/marginalia/comments'},
			'.config/plugins/marginalia',
		)).toMatchObject({storagePreset: 'plugin'});

		expect(normalizeLegacy({storageLocation: 'annotations/data'}, '.config/plugins/marginalia'))
			.toMatchObject({storagePreset: 'custom', customStoragePath: 'annotations/data'});
	});

	it('preserves current settings and rejects paths outside the Vault', () => {
		expect(normalizeLegacy({
			storagePreset: 'custom',
			customStoragePath: 'comments/custom',
			commentSortOrder: 'created',
		})).toMatchObject({
			storagePreset: 'custom',
			customStoragePath: 'comments/custom',
			commentSortOrder: 'created',
		});

		expect(normalizeLegacy({storageLocation: '../outside'})).toMatchObject({
			storagePreset: DEFAULT_SETTINGS.storagePreset,
			customStoragePath: DEFAULT_SETTINGS.customStoragePath,
		});
	});
});
