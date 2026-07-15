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
const debugPort = Number(process.env.MARGINALIA_E2E_DEBUG_PORT ?? 9252);
const tabletWidth = Number(process.env.MARGINALIA_E2E_TABLET_WIDTH ?? 1728);
const tabletHeight = Number(process.env.MARGINALIA_E2E_TABLET_HEIGHT ?? 1080);
const expectedSheetWidth = Number(process.env.MARGINALIA_E2E_TABLET_SHEET_WIDTH ?? 860);
const userDataDir = resolve(
	process.env.MARGINALIA_E2E_USER_DATA_DIR ?? join(vaultPath, '.obsidian-e2e-tablet-user-data'),
);

await prepareObsidianUserData(userDataDir, vaultPath);
const launch = getLaunchCommand(debugPort, vaultPath, userDataDir);

await assertExists(vaultPath, `测试 vault 不存在：${vaultPath}`);
await assertExists(
	join(vaultPath, '.obsidian', 'plugins', pluginId, 'main.js'),
	`插件尚未部署，请先运行 npm run deploy:local`,
);

console.log(`Launching Obsidian tablet E2E: ${launch.command} ${launch.args.join(' ')}`);
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
	await resizeTabletWindow(page, tabletWidth, tabletHeight);

	await page.waitForFunction(() => {
		const obsidianApp = window.app;
		return Boolean(
			obsidianApp?.workspace?.layoutReady &&
			obsidianApp?.plugins &&
			obsidianApp?.commands
		);
	}, null, {timeout: 60000});

	await page.evaluate(async () => {
		const obsidianApp = window.app;
		if (!obsidianApp) {
			throw new Error('window.app 不存在');
		}
		if (typeof obsidianApp.emulateMobile !== 'function') {
			throw new Error('当前 Obsidian 未暴露 app.emulateMobile(true)，无法使用内置移动端模拟器。');
		}
		await obsidianApp.emulateMobile(true);
	});

	await page.waitForFunction(() => {
		return document.body.classList.contains('is-mobile') && window.app?.workspace?.layoutReady;
	}, null, {timeout: 30000});

	await page.evaluate(async (id) => {
		const obsidianApp = window.app;
		if (!obsidianApp) {
			throw new Error('window.app 不存在');
		}

		if (obsidianApp.plugins.plugins[id] && typeof obsidianApp.plugins.disablePlugin === 'function') {
			await obsidianApp.plugins.disablePlugin(id);
		}
		if (!obsidianApp.plugins.plugins[id]) {
			await obsidianApp.plugins.enablePlugin(id);
		}
	}, pluginId);

	await page.waitForFunction((id) => {
		const obsidianApp = window.app;
		return Boolean(obsidianApp?.plugins?.plugins?.[id] && obsidianApp?.commands?.commands?.[`${id}:open-comment-panel`]);
	}, pluginId, {timeout: 30000});

	const result = await page.evaluate(async ({id, expectedWidth}) => {
		const obsidianApp = window.app;
		if (!obsidianApp) {
			throw new Error('window.app 不存在');
		}

		const plugin = obsidianApp.plugins.plugins[id];
		if (!plugin) {
			throw new Error(`插件未加载：${id}`);
		}

		const testFilePath = 'marginalia-tablet-e2e.md';
		const testFileContent = [
			'# Marginalia Tablet E2E',
			'',
			'Tablet mobile emulator test note.',
		].join('\n');
		let testFile = obsidianApp.vault.getAbstractFileByPath(testFilePath);
		if (!testFile) {
			testFile = await obsidianApp.vault.create(testFilePath, testFileContent);
		} else {
			await obsidianApp.vault.modify(testFile, testFileContent);
		}
		await obsidianApp.workspace.getLeaf(false).openFile(testFile);
		await plugin.store.addNoteComment(testFilePath, 'Tablet E2E note comment');
		await plugin.store.flushAll();

		const commandId = `${id}:open-comment-panel`;
		if (!obsidianApp.commands.commands[commandId]) {
			throw new Error(`命令未注册：${commandId}`);
		}
		await obsidianApp.commands.executeCommandById(commandId);

		for (let attempt = 0; attempt < 30; attempt++) {
			if (
				document.querySelector('.marginalia-mobile-sheet') &&
				document.querySelector('.marginalia-mobile-floating-close')
			) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		const sheet = document.querySelector('.marginalia-mobile-sheet');
		const closeButton = document.querySelector('.marginalia-mobile-floating-close');
		const addButton = document.querySelector('.marginalia-mobile-sheet-add');
		const cardBody = document.querySelector('.marginalia-mobile-card-body');
		const activeView = obsidianApp.workspace.getMostRecentLeaf()?.view;
		const contentEl = activeView?.contentEl;
		if (!sheet) {
			throw new Error('移动端批注 sheet 未打开。');
		}
		if (!closeButton) {
			throw new Error('移动端 floating close 按钮未渲染。');
		}
		if (!contentEl) {
			throw new Error('未找到 active view contentEl。');
		}
		if (!addButton) {
			throw new Error('平板 all-comments sheet 未渲染新增批注按钮。');
		}
		if (!cardBody) {
			throw new Error('平板 all-comments sheet 未渲染批注卡片正文。');
		}

		cardBody.click();
		for (let attempt = 0; attempt < 30; attempt++) {
			if (document.querySelector('.marginalia-mobile-actionbar')) break;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		const actionBar = document.querySelector('.marginalia-mobile-actionbar');
		const actionButtons = [...document.querySelectorAll('.marginalia-mobile-action')];
		if (!actionBar) {
			throw new Error('点击平板批注卡片后未渲染操作栏。');
		}
		if (actionButtons.length === 0) {
			throw new Error('平板批注操作栏未渲染操作按钮。');
		}

		const renderedSheet = document.querySelector('.marginalia-mobile-sheet');
		const renderedCloseButton = document.querySelector('.marginalia-mobile-floating-close');
		const renderedAddButton = document.querySelector('.marginalia-mobile-sheet-add');
		if (!renderedSheet || !renderedCloseButton || !renderedAddButton) {
			throw new Error('点击平板批注卡片后 sheet 控件未保持渲染。');
		}

		const sheetRect = renderedSheet.getBoundingClientRect();
		const closeRect = renderedCloseButton.getBoundingClientRect();
		const addRect = renderedAddButton.getBoundingClientRect();
		const actionBarRect = actionBar.getBoundingClientRect();
		const actionButtonRects = actionButtons.map(button => button.getBoundingClientRect());
		const contentRect = contentEl.getBoundingClientRect();
		const sheetCenter = sheetRect.left + sheetRect.width / 2;
		const closeCenter = closeRect.left + closeRect.width / 2;
		const contentCenter = contentRect.left + Math.min(contentRect.width, window.innerWidth - 24) / 2;
		const sheetWidthDelta = Math.abs(sheetRect.width - expectedWidth);
		const sheetCenterDelta = Math.abs(sheetCenter - contentCenter);
		const closeCenterDelta = Math.abs(closeCenter - sheetCenter);

		return {
			bodyIsMobile: document.body.classList.contains('is-mobile'),
			bodyIsPhone: document.body.classList.contains('is-phone'),
			pluginReportsMobile: plugin.isMobile(),
			desktopPanelLeaves: obsidianApp.workspace.getLeavesOfType('marginalia-panel').length,
			sheetWidth: Math.round(sheetRect.width),
			expectedWidth,
			sheetWidthDelta,
			sheetCenter: Math.round(sheetCenter),
			contentCenter: Math.round(contentCenter),
			sheetCenterDelta,
			closeCenter: Math.round(closeCenter),
			closeCenterDelta,
			addButtonWidth: Math.round(addRect.width),
			addButtonHeight: Math.round(addRect.height),
			actionBarWidth: Math.round(actionBarRect.width),
			actionBarInsideSheet: actionBarRect.left >= sheetRect.left && actionBarRect.right <= sheetRect.right,
			minActionButtonWidth: Math.round(Math.min(...actionButtonRects.map(rect => rect.width))),
			minActionButtonHeight: Math.round(Math.min(...actionButtonRects.map(rect => rect.height))),
			viewportWidth: window.innerWidth,
			scrollWidth: document.documentElement.scrollWidth,
			cssCenterX: getComputedStyle(renderedSheet).getPropertyValue('--marginalia-sheet-center-x').trim(),
		};
	}, {id: pluginId, expectedWidth: expectedSheetWidth});

	assertTabletResult(result);
	console.log(
		`Tablet E2E passed: mobile=${result.bodyIsMobile}, phone=${result.bodyIsPhone}, sheet=${result.sheetWidth}, add=${result.addButtonWidth}x${result.addButtonHeight}, actionMin=${result.minActionButtonWidth}x${result.minActionButtonHeight}, centerDelta=${result.sheetCenterDelta.toFixed(2)}, closeDelta=${result.closeCenterDelta.toFixed(2)}`,
	);
} catch (error) {
	if (stderr.trim()) {
		console.error(stderr.trim());
	}
	throw error;
} finally {
	await withTimeout(browser?.close(), 2000).catch(() => undefined);
	await terminateProcessGroup(child);
}

function assertTabletResult(result) {
	if (!result.bodyIsMobile) {
		throw new Error(`Obsidian 内置移动端模拟器未生效：${JSON.stringify(result)}`);
	}
	if (result.bodyIsPhone) {
		throw new Error(`平板测试不应进入手机窄屏布局：${JSON.stringify(result)}`);
	}
	if (!result.pluginReportsMobile) {
		throw new Error(`插件未进入移动分支：${JSON.stringify(result)}`);
	}
	if (result.desktopPanelLeaves > 0) {
		throw new Error(`平板移动端不应打开桌面 panel：${JSON.stringify(result)}`);
	}
	if (result.sheetWidthDelta > 3) {
		throw new Error(`平板 sheet 宽度不符合预期：${JSON.stringify(result)}`);
	}
	if (result.sheetCenterDelta > 3) {
		throw new Error(`平板 sheet 未在编辑内容区居中：${JSON.stringify(result)}`);
	}
	if (result.closeCenterDelta > 3) {
		throw new Error(`floating close 未对齐 sheet 中心：${JSON.stringify(result)}`);
	}
	if (result.addButtonWidth < 44 || result.addButtonHeight < 44) {
		throw new Error(`平板新增批注按钮未达到 44px 触控目标：${JSON.stringify(result)}`);
	}
	if (!result.actionBarInsideSheet) {
		throw new Error(`平板操作栏超出 sheet 宽度：${JSON.stringify(result)}`);
	}
	if (result.minActionButtonWidth < 44 || result.minActionButtonHeight < 44) {
		throw new Error(`平板操作按钮未达到 44px 触控目标：${JSON.stringify(result)}`);
	}
	if (result.scrollWidth > result.viewportWidth + 1) {
		throw new Error(`页面出现水平溢出：${JSON.stringify(result)}`);
	}
	if (!result.cssCenterX.endsWith('px')) {
		throw new Error(`未写入 --marginalia-sheet-center-x：${JSON.stringify(result)}`);
	}
}

async function resizeTabletWindow(page, width, height) {
	await page.setViewportSize({width, height});
	try {
		const session = await page.context().newCDPSession(page);
		const {windowId} = await session.send('Browser.getWindowForTarget');
		await session.send('Browser.setWindowBounds', {
			windowId,
			bounds: {width, height, windowState: 'normal'},
		});
	} catch (error) {
		console.warn(`Unable to resize native Obsidian window through CDP; viewport emulation remains active: ${error instanceof Error ? error.message : String(error)}`);
	}
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
			marginaliaTabletE2E: {path: vaultPath, ts: Date.now(), open: true},
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
