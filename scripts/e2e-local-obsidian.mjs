import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import process from 'node:process';
import {chromium} from 'playwright-core';

const repoRoot = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(repoRoot, 'manifest.json'), 'utf8'));
const pluginId = manifest.id;
const configuredVaultPath = process.env.MARGINALIA_TEST_VAULT;
if (!configuredVaultPath) {
	throw new Error('MARGINALIA_TEST_VAULT must point to a disposable local Obsidian Vault.');
}
const vaultPath = resolve(configuredVaultPath);
const debugPort = Number(process.env.MARGINALIA_E2E_DEBUG_PORT ?? 9229);
const userDataDir = resolve(
	process.env.MARGINALIA_E2E_USER_DATA_DIR ?? join(vaultPath, '.obsidian-e2e-user-data'),
);
await prepareObsidianUserData(userDataDir, vaultPath);
const launch = getLaunchCommand(debugPort, vaultPath, userDataDir);

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
	const page = await waitForVaultPage(context, vaultPath, 30000);

	await page.waitForFunction(() => {
		const obsidianApp = window.app;
		return Boolean(
			obsidianApp?.workspace?.layoutReady &&
			obsidianApp?.plugins &&
			obsidianApp?.commands
		);
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

	const dragResult = await runDesktopCommentModalDragTest(page, pluginId);

	const result = await page.evaluate(async (id) => {
		const obsidianApp = window.app;
		if (!obsidianApp) {
			throw new Error('window.app 不存在');
		}

		const plugin = obsidianApp.plugins.plugins[id];
		const testFilePath = 'marginalia-e2e.md';
		const testFileContent = [
			'---',
			'title: Marginalia E2E Preview Title',
			'tag: e2e',
			'tags:',
			'  - preview',
			'---',
			'# Marginalia E2E',
			'',
			'Test note.',
		].join('\n');
		let testFile = obsidianApp.vault.getAbstractFileByPath(testFilePath);
		if (!testFile) {
			testFile = await obsidianApp.vault.create(testFilePath, testFileContent);
		} else {
			await obsidianApp.vault.modify(testFile, testFileContent);
		}
		await obsidianApp.workspace.getLeaf(false).openFile(testFile);
		for (let attempt = 0; attempt < 30; attempt++) {
			if (obsidianApp.metadataCache.getCache(testFilePath)?.frontmatter?.title === 'Marginalia E2E Preview Title') break;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		await plugin.store.addNoteComment(testFilePath, 'E2E note comment');
		await plugin.store.flushAll();

		const commandId = `${id}:open-comment-panel`;
		const command = obsidianApp.commands.commands[commandId];
		if (!command) {
			throw new Error(`命令未注册：${commandId}`);
		}

		await obsidianApp.commands.executeCommandById(commandId);
		await new Promise(resolve => setTimeout(resolve, 700));
		const repair = await plugin.store.repairIndex();
		const electron = window.require?.('electron');
		const originalOpenPath = electron?.shell?.openPath;
		if (electron?.shell) electron.shell.openPath = async () => '';
		try {
			await plugin.openCommentPreviewInBrowser();
		} finally {
			if (electron?.shell && originalOpenPath) electron.shell.openPath = originalOpenPath;
		}
		const previewPath = `${plugin.manifest.dir}/.marginalia-preview/comment-preview.html`;
		const previewHtml = await obsidianApp.vault.adapter.read(previewPath);

		return {
			pluginLoaded: Boolean(plugin),
			commandName: command.name,
			panelLeaves: obsidianApp.workspace.getLeavesOfType('marginalia-panel').length,
			previewButtons: document.querySelectorAll('.marginalia-preview-btn').length,
			repairedMappings: repair.restored,
			previewUsesFrontmatterTitle: previewHtml.includes('Marginalia E2E Preview Title'),
			previewUsesTopics: previewHtml.includes('data-topic="e2e"') && previewHtml.includes('data-topic="preview"'),
			previewRemovedStatusFilters: !previewHtml.includes('data-filter="open"') && !previewHtml.includes('value="open"'),
		};
	}, pluginId);

	if (!result.pluginLoaded) {
		throw new Error(`插件未加载：${pluginId}`);
	}
	if (!result.commandName.trim()) {
		throw new Error('批注面板命令名称为空');
	}
	if (result.panelLeaves < 1) {
		throw new Error('执行命令后未打开批注面板');
	}
	if (result.previewButtons < 1) {
		throw new Error('批注面板未显示浏览器预览入口');
	}
	if (result.repairedMappings < 1) {
		throw new Error('索引修复未恢复测试批注映射');
	}
	if (!result.previewUsesFrontmatterTitle || !result.previewUsesTopics || !result.previewRemovedStatusFilters) {
		throw new Error(`批注预览 Front Matter/主题筛选不符合预期：${JSON.stringify(result)}`);
	}
	if (!dragResult.moved || !dragResult.withinViewport || dragResult.isMobileModal) {
		throw new Error(`PC 批注弹窗拖拽不符合预期：${JSON.stringify(dragResult)}`);
	}

	console.log(`E2E passed: ${pluginId} loaded, panel=${result.panelLeaves}, preview=${result.previewButtons}, topics=true, repaired=${result.repairedMappings}, modalDrag=${dragResult.deltaX}x${dragResult.deltaY}`);
} catch (error) {
	if (stderr.trim()) {
		console.error(stderr.trim());
	}
	throw error;
} finally {
	await withTimeout(browser?.close(), 2000).catch(() => undefined);
	await terminateProcessGroup(child);
}

function getLaunchCommand(port, vault, userDataDir) {
	const electronArgs = [
		`--remote-debugging-port=${port}`,
		'--remote-allow-origins=*',
		`--user-data-dir=${userDataDir}`,
		vault,
	];

	if (process.env.OBSIDIAN_E2E_COMMAND) {
		return {
			command: process.env.OBSIDIAN_E2E_COMMAND,
			args: electronArgs,
		};
	}

	if (spawnSync('flatpak', ['info', 'md.obsidian.Obsidian'], {stdio: 'ignore'}).status === 0) {
		return {
			command: 'flatpak',
			args: [
				'run',
				'md.obsidian.Obsidian',
				...electronArgs,
			],
		};
	}

	const executable = process.env.OBSIDIAN_EXECUTABLE ?? findObsidianExecutable();
	if (!executable) {
		throw new Error('未找到本机 Obsidian 程序。请设置 OBSIDIAN_EXECUTABLE=/path/to/obsidian 或 OBSIDIAN_E2E_COMMAND。');
	}

	return {
		command: executable,
		args: electronArgs,
	};
}

async function prepareObsidianUserData(userDataDir, vaultPath) {
	await mkdir(userDataDir, {recursive: true});
	await writeFile(join(userDataDir, 'obsidian.json'), JSON.stringify({
		vaults: {
			marginaliaE2E: {path: vaultPath, ts: Date.now(), open: true},
		},
		cli: true,
	}), 'utf8');
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

async function runDesktopCommentModalDragTest(page, id) {
	await page.evaluate(async (pluginId) => {
		const obsidianApp = window.app;
		if (!obsidianApp) {
			throw new Error('window.app 不存在');
		}

		const testFilePath = 'marginalia-modal-drag-e2e.md';
		let testFile = obsidianApp.vault.getAbstractFileByPath(testFilePath);
		if (!testFile) {
			testFile = await obsidianApp.vault.create(testFilePath, '# Marginalia Modal Drag E2E\n\nTest note.');
		}
		await obsidianApp.workspace.getLeaf(false).openFile(testFile);
		const commandId = `${pluginId}:add-note-comment`;
		if (!obsidianApp.commands.commands[commandId]) {
			throw new Error(`命令未注册：${commandId}`);
		}
		await obsidianApp.commands.executeCommandById(commandId);
	}, id);

	const modalLocator = page.locator('.marginalia-comment-modal:not(.marginalia-comment-modal-mobile)');
	const titleLocator = page.locator('.marginalia-comment-modal:not(.marginalia-comment-modal-mobile) .marginalia-modal-title');
	await titleLocator.waitFor({timeout: 10000});
	await page.waitForTimeout(250);
	const before = await modalLocator.boundingBox();
	const titleBox = await titleLocator.boundingBox();
	if (!before || !titleBox) {
		throw new Error('无法获取 PC 批注弹窗或标题区域位置。');
	}

	const startX = titleBox.x + titleBox.width / 2;
	const startY = titleBox.y + titleBox.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX - 120, startY + 70, {steps: 6});
	await page.mouse.up();
	await page.waitForTimeout(100);

	const after = await modalLocator.boundingBox();
	if (!after) {
		throw new Error('拖拽后 PC 批注弹窗消失。');
	}
	const isMobileModal = await modalLocator.evaluate((modal) => modal.classList.contains('marginalia-comment-modal-mobile'));
	const viewportSize = await page.evaluate(() => ({height: window.innerHeight, width: window.innerWidth}));
	await page.evaluate(() => {
		const closeButton = document.querySelector('.marginalia-comment-modal .modal-close-button');
		if (closeButton instanceof HTMLElement) {
			closeButton.click();
			return;
		}
		const cancelButton = [...document.querySelectorAll('.marginalia-comment-modal button')]
			.find((button) => button.textContent?.trim() === 'Cancel' || button.textContent?.trim() === '取消');
		if (cancelButton instanceof HTMLElement) cancelButton.click();
	});
	await page.waitForFunction(() => !document.querySelector('.marginalia-comment-modal'), null, {timeout: 10000});

	const deltaX = Math.round(after.x - before.x);
	const deltaY = Math.round(after.y - before.y);
	return {
		deltaX,
		deltaY,
		isMobileModal,
		moved: Math.abs(deltaX) >= 80 && Math.abs(deltaY) >= 40,
		withinViewport: after.x >= 0 && after.y >= 0 && after.x + after.width <= viewportSize.width && after.y + after.height <= viewportSize.height,
	};
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

async function waitForVaultPage(context, expectedVaultPath, timeoutMs) {
	const started = Date.now();
	const observedVaultPaths = new Set();
	while (Date.now() - started < timeoutMs) {
		for (const candidate of context.pages()) {
			try {
				const currentVaultPath = await candidate.evaluate(() => {
					const adapter = window.app?.vault?.adapter;
					return typeof adapter?.getBasePath === 'function' ? adapter.getBasePath() : null;
				});
				if (currentVaultPath) {
					observedVaultPaths.add(currentVaultPath);
					const normalizedCurrentPath = resolve(currentVaultPath.replace(/^\/run\/host/, ''));
					if (normalizedCurrentPath === expectedVaultPath) return candidate;
				}
			} catch {
				// The page may still be loading.
			}
		}
		await new Promise(resolveWait => setTimeout(resolveWait, 250));
	}
	throw new Error(`未找到测试 Vault 对应的 Obsidian 页面：${expectedVaultPath}；已观察到：${[...observedVaultPaths].join(', ') || '无'}`);
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
