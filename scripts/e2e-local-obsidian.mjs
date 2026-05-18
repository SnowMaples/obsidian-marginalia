import {access, readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import process from 'node:process';
import {chromium} from 'playwright-core';

const repoRoot = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(repoRoot, 'manifest.json'), 'utf8'));
const pluginId = manifest.id;
const vaultPath = resolve(process.env.MARGINALIA_TEST_VAULT ?? '/home/snow/github/learn.lianglianglee.com');
const debugPort = Number(process.env.MARGINALIA_E2E_DEBUG_PORT ?? 9229);
const launch = getLaunchCommand(debugPort, vaultPath);

await assertExists(vaultPath, `测试 vault 不存在：${vaultPath}`);
await assertExists(
	join(vaultPath, '.obsidian', 'plugins', pluginId, 'main.js'),
	`插件尚未部署，请先运行 npm run deploy:local`,
);

console.log(`Launching Obsidian: ${launch.command} ${launch.args.join(' ')}`);
const child = spawn(launch.command, launch.args, {
	env: {
		...process.env,
		ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '0',
	},
	detached: process.platform !== 'win32',
	stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', chunk => {
	stderr += chunk.toString();
});

let browser;
try {
	await waitForCdp(debugPort, Number(process.env.MARGINALIA_E2E_LAUNCH_TIMEOUT ?? 60000));
	browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
	const context = browser.contexts()[0] ?? await browser.newContext();
	const page = context.pages()[0] ?? await context.waitForEvent('page', {timeout: 30000});

	await page.waitForFunction(() => {
		const obsidianApp = window.app;
		return Boolean(obsidianApp?.workspace && obsidianApp?.plugins && obsidianApp?.commands);
	}, null, {timeout: 60000});

	await page.evaluate(async (id) => {
		const obsidianApp = window.app;
		if (!obsidianApp) {
			throw new Error('window.app 不存在');
		}

		if (!obsidianApp.plugins.plugins[id]) {
			await obsidianApp.plugins.enablePlugin(id);
		}
	}, pluginId);

	await page.waitForFunction((id) => {
		const obsidianApp = window.app;
		return Boolean(obsidianApp?.plugins?.plugins?.[id] && obsidianApp?.commands?.commands?.[`${id}:open-comment-panel`]);
	}, pluginId, {timeout: 30000});

	const result = await page.evaluate(async (id) => {
		const obsidianApp = window.app;
		if (!obsidianApp) {
			throw new Error('window.app 不存在');
		}

		const commandId = `${id}:open-comment-panel`;
		const command = obsidianApp.commands.commands[commandId];
		if (!command) {
			throw new Error(`命令未注册：${commandId}`);
		}

		await obsidianApp.commands.executeCommandById(commandId);
		await new Promise(resolve => setTimeout(resolve, 500));

		return {
			pluginLoaded: Boolean(obsidianApp.plugins.plugins[id]),
			commandName: command.name,
			panelLeaves: obsidianApp.workspace.getLeavesOfType('marginalia-panel').length,
		};
	}, pluginId);

	if (!result.pluginLoaded) {
		throw new Error(`插件未加载：${pluginId}`);
	}
	if (!result.commandName.includes('打开批注面板')) {
		throw new Error(`命令文案不符合预期：${result.commandName}`);
	}
	if (result.panelLeaves < 1) {
		throw new Error('执行命令后未打开批注面板');
	}

	console.log(`E2E passed: ${pluginId} loaded, command="${result.commandName}", panelLeaves=${result.panelLeaves}`);
} catch (error) {
	if (stderr.trim()) {
		console.error(stderr.trim());
	}
	throw error;
} finally {
	await withTimeout(browser?.close(), 2000).catch(() => undefined);
	await terminateProcessGroup(child);
}

function getLaunchCommand(port, vault) {
	if (process.env.OBSIDIAN_E2E_COMMAND) {
		return {
			command: process.env.OBSIDIAN_E2E_COMMAND,
			args: [
				`--remote-debugging-port=${port}`,
				'--remote-allow-origins=*',
				vault,
			],
		};
	}

	if (spawnSync('flatpak', ['info', 'md.obsidian.Obsidian'], {stdio: 'ignore'}).status === 0) {
		return {
			command: 'flatpak',
			args: [
				'run',
				'md.obsidian.Obsidian',
				`--remote-debugging-port=${port}`,
				'--remote-allow-origins=*',
				vault,
			],
		};
	}

	const executable = process.env.OBSIDIAN_EXECUTABLE ?? findObsidianExecutable();
	if (!executable) {
		throw new Error('未找到本机 Obsidian 程序。请设置 OBSIDIAN_EXECUTABLE=/path/to/obsidian 或 OBSIDIAN_E2E_COMMAND。');
	}

	return {
		command: executable,
		args: [
			`--remote-debugging-port=${port}`,
			'--remote-allow-origins=*',
			vault,
		],
	};
}

function findObsidianExecutable() {
	const fromPath = spawnSync('which', ['obsidian'], {
		encoding: 'utf8',
	});
	const candidate = fromPath.stdout?.trim();
	if (candidate) return candidate;

	for (const fallback of [
		'/usr/bin/obsidian',
		'/usr/local/bin/obsidian',
		'/opt/Obsidian/obsidian',
	]) {
		if (spawnSync('test', ['-x', fallback]).status === 0) return fallback;
	}

	return null;
}

async function waitForCdp(port, timeoutMs) {
	const started = Date.now();
	let lastError;

	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (response.ok) return;
			lastError = new Error(`CDP returned HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		await new Promise(resolve => setTimeout(resolve, 500));
	}

	throw new Error(`Obsidian remote debugging port ${port} did not open: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function assertExists(path, message) {
	try {
		await access(path, constants.F_OK);
	} catch {
		throw new Error(message);
	}
}

async function terminateProcessGroup(childProcess) {
	if (childProcess.exitCode != null || childProcess.signalCode != null) return;

	try {
		if (process.platform === 'win32') {
			childProcess.kill('SIGTERM');
		} else {
			process.kill(-childProcess.pid, 'SIGTERM');
		}
	} catch {
		childProcess.kill('SIGTERM');
	}

	const exited = await waitForProcessExit(childProcess, 3000);
	if (exited) return;

	try {
		if (process.platform === 'win32') {
			childProcess.kill('SIGKILL');
		} else {
			process.kill(-childProcess.pid, 'SIGKILL');
		}
	} catch {
		childProcess.kill('SIGKILL');
	}
}

function waitForProcessExit(childProcess, timeoutMs) {
	return new Promise(resolve => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		childProcess.once('exit', () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

function withTimeout(promise, timeoutMs) {
	if (!promise) return Promise.resolve();
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error('operation timed out')), timeoutMs)),
	]);
}
