import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
	},
	resolve: {
		alias: {
			obsidian: resolve(__dirname, 'tests/shims/obsidian.ts'),
		},
	},
});
