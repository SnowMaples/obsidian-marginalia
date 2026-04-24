import {readFileSync} from 'node:fs';

const targets = [
	{
		path: 'src/i18n.ts',
		mustInclude: [
			'\u6570\u636e\u8def\u5f84',
			'\u8bc4\u8bba\u6392\u5e8f\u65b9\u5f0f',
			'\u8fc1\u79fb\u5931\u8d25\uff1a',
		],
	},
];

for (const target of targets) {
	const raw = readFileSync(target.path);
	let text;
	try {
		text = new TextDecoder('utf-8', {fatal: true}).decode(raw);
	} catch (error) {
		throw new Error(`${target.path} is not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (text.includes('\uFFFD')) {
		throw new Error(`${target.path} contains replacement characters; source text is already corrupted.`);
	}

	for (const sample of target.mustInclude) {
		if (!text.includes(sample)) {
			throw new Error(`${target.path} is missing expected text: ${sample}`);
		}
	}
}

console.log('UTF-8 encoding check passed.');