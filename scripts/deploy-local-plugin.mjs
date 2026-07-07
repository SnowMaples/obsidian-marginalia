import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const manifestPath = join(repoRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pluginId = manifest.id;

const configuredVaultPath = process.env.MARGINALIA_TEST_VAULT;
if (!configuredVaultPath) {
	throw new Error('MARGINALIA_TEST_VAULT must point to a disposable local Obsidian Vault.');
}
const vaultPath = resolve(configuredVaultPath);
const pluginDir = resolve(process.env.MARGINALIA_TEST_PLUGIN_DIR ?? join(vaultPath, '.obsidian', 'plugins', pluginId));

await mkdir(pluginDir, {recursive: true});

for (const fileName of ['main.js', 'manifest.json', 'styles.css']) {
	await copyFile(join(repoRoot, fileName), join(pluginDir, fileName));
}

const enabledPluginsPath = join(vaultPath, '.obsidian', 'community-plugins.json');
let enabledPlugins = [];
try {
	enabledPlugins = JSON.parse(await readFile(enabledPluginsPath, 'utf8'));
	if (!Array.isArray(enabledPlugins)) enabledPlugins = [];
} catch {
	enabledPlugins = [];
}

if (!enabledPlugins.includes(pluginId)) {
	enabledPlugins.push(pluginId);
	await mkdir(join(vaultPath, '.obsidian'), {recursive: true});
	await writeFile(enabledPluginsPath, JSON.stringify(enabledPlugins, null, '\t'), 'utf8');
}

console.log(`Deployed ${pluginId} to ${pluginDir}`);
