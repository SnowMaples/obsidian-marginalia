import {defineConfig} from 'vitest/config';

const obsidianShimPath = decodeURIComponent(new URL('./tests/shims/obsidian.ts', import.meta.url).pathname);

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
	},
	resolve: {
		alias: {
			obsidian: obsidianShimPath,
		},
	},
});
