# Marginalia

Marginalia 是一个 Obsidian 桌面端批注插件，用于在不修改原文 Markdown 文件的前提下，为笔记添加原文批注、文档批注和回复讨论。

![Obsidian minimum version](https://img.shields.io/badge/Obsidian-≥0.15.0-blueviolet)
![Desktop only](https://img.shields.io/badge/Desktop-only-informational)
![License](https://img.shields.io/badge/License-0--BSD-green)

![Screenshot](assets/screenshot-overview.png)

## 核心能力

- **不改动原文**：批注数据保存为独立 JSON 文件，原始 `.md` 文件不会被写入批注内容。
- **原文批注**：选中文本后添加批注，插件会记录原文、上下文和行号线索，用于后续重新定位。
- **文档批注**：无需选择文本，也可以为整篇笔记添加批注。
- **回复线程**：可对原文批注继续添加回复，形成讨论串。
- **解决状态**：批注支持标记为已解决，也可以重新打开。
- **编辑器行号图标**：有批注的行会显示图标；悬停图标可以预览批注内容。
- **阅读模式支持**：阅读视图中同样会显示批注行号提示。
- **批注侧栏**：右侧批注面板展示当前笔记的批注，支持全部、未解决、已解决、已定位、孤立等筛选。
- **浏览器批注预览**：在默认浏览器中打开只读总览，查看所有已记录批注的文章，支持搜索、筛选和排序。
- **索引修复**：当 `_index.json` 缺失或损坏时，可从现有批注文件恢复索引。
- **中文界面**：命令、设置、侧栏、弹窗、预览页等用户界面默认使用中文。

## 安装

### 手动安装

1. 下载或构建以下文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在目标库中创建插件目录：
   `VaultFolder/.obsidian/plugins/marginalia/`
3. 将上述三个文件复制到该目录。
4. 重启 Obsidian，进入 **设置 → 第三方插件** 启用 **Marginalia**。

### 从源码构建

```bash
npm install
npm run build
```

构建产物会生成在项目根目录：

- `main.js`
- `manifest.json`
- `styles.css`

## 使用方式

### 添加原文批注

1. 在编辑模式中选中一段文本。
2. 右键选择 **添加批注**，或从命令面板执行 **添加选中文本批注**。
3. 输入批注内容并保存。

插件会把选中文本作为锚点，记录目标文本、前后文和行号线索。后续即使原文周围发生编辑，也会尝试重新定位批注。

### 添加文档批注

文档批注不依附于具体文本，适合记录整篇文章的阅读想法。

可通过以下方式添加：

- 命令面板执行 **添加文档批注**。
- 打开批注面板后，点击顶部的加号按钮。
- 在编辑器右键菜单中选择 **添加文档批注**。

### 查看当前文章批注

通过以下方式打开右侧批注面板：

- 点击左侧 ribbon 中的批注图标。
- 命令面板执行 **打开批注面板**。

批注面板会随当前 Markdown 文件切换而刷新。面板顶部提供筛选：

| 筛选 | 含义 |
| --- | --- |
| 全部 | 显示当前文章的所有批注 |
| 未解决 | 只显示尚未解决的批注 |
| 已解决 | 只显示已解决的批注 |
| 已定位 | 只显示仍能定位到原文的原文批注 |
| 孤立 | 只显示无法重新定位到原文的批注 |

### 回复、编辑、删除和解决

批注卡片右下角提供常用操作：

- **标记为已解决 / 重新打开**：切换批注解决状态。
- **回复**：为原文批注添加回复。
- **编辑**：修改批注或回复内容。
- **删除**：删除批注；删除根批注时会同时删除其回复。

批注内容支持 Markdown 渲染，包括 Obsidian 内部链接。

### 在批注之间跳转

命令面板提供：

- **跳转到下一条批注**
- **跳转到上一条批注**

这两个命令会根据当前光标位置，在当前文章内跳转到相邻批注锚点。

### 浏览器批注预览

在批注面板顶部点击眼睛图标，可在默认浏览器中打开只读批注总览。

预览页会基于 `_index.json` 和批注文件生成临时 HTML，不会修改任何库内文件。预览页支持：

- 左侧文章列表切换。
- 标题、路径、原文、批注、回复全文搜索。
- 按状态筛选：全部、未解决、已解决、孤立、有回复。
- 排序：最近更新、按路径、批注最多、未解决最多。
- 移动端窄屏布局。

## 命令

| 命令 | 说明 |
| --- | --- |
| 添加选中文本批注 | 为当前选中文本添加原文批注 |
| 添加文档批注 | 为当前 Markdown 文件添加文档级批注 |
| 打开批注面板 | 打开右侧批注侧栏 |
| 跳转到下一条批注 | 跳转到当前文件中的下一条批注 |
| 跳转到上一条批注 | 跳转到当前文件中的上一条批注 |

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 批注存储位置 | 插件目录 `comments/` | 批注 JSON 数据保存位置。可选择插件目录或库根目录 `.marginalia/`，也可以手动输入路径。 |
| 修复批注索引 | 手动按钮 | 基于现有批注文件重建 `_index.json`。不会修改原文或批注内容。 |
| 批注排序方式 | 按原文位置 | 控制侧栏中的批注排序，可按原文位置或创建时间排序。 |
| 显示行号批注图标 | 开启 | 在编辑器行号区域显示批注提示。 |
| 模糊匹配阈值 | `0.3` | 控制锚点模糊匹配严格程度，数值越低越严格。 |
| 孤立批注处理 | 保留并提示 | 当批注无法重新定位到目标原文时，选择保留或自动删除。 |

## 数据存储

Marginalia 使用 sidecar JSON 文件保存批注，不会把批注写入 Markdown 原文。

默认存储位置：

```text
VaultFolder/.obsidian/plugins/marginalia/comments/
```

也可以在设置中切换到：

```text
VaultFolder/.marginalia/
```

存储目录中包含：

- `_index.json`：记录笔记路径到批注文件名的映射。
- `<encoded-note-path>.json`：每篇有批注的文章对应一个批注文件。
- `_index.corrupt.<timestamp>.json`：当索引损坏时自动生成的备份文件。

批注文件结构包含：

- `version`：数据结构版本。
- `sourceFile`：原始 Markdown 文件路径。
- `comments`：批注、文档批注和回复列表。

### 索引恢复策略

启动插件时会检查 `_index.json`：

- 如果索引正常，直接加载。
- 如果索引缺失，会扫描现有批注文件并重建。
- 如果索引损坏，会先备份损坏文件，再根据每个批注文件内的 `sourceFile` 重建索引。
- 如果同一篇文章存在多个候选批注文件，会保留更新时间最新的候选并记录冲突数量。

也可以在设置页手动点击 **修复批注索引** 执行同样的恢复流程。

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 生产构建

```bash
npm run build
```

## 测试流程

本项目使用 Vitest 做单元测试，并使用本机已安装的 Obsidian 做 E2E 测试。E2E 不下载其他 Obsidian 版本。

### 单元测试

```bash
npm run test:unit
```

### 部署到本机测试库

```bash
npm run deploy:local
```

默认会构建插件并复制到：

```text
/home/snow/github/learn.lianglianglee.com/.obsidian/plugins/marginalia/
```

复制文件包括：

- `main.js`
- `manifest.json`
- `styles.css`

脚本会确保 `community-plugins.json` 中启用 `marginalia`。

可通过环境变量覆盖测试库路径：

```bash
MARGINALIA_TEST_VAULT=/path/to/vault npm run deploy:local
```

### 本机 Obsidian E2E

```bash
npm run test:e2e
```

流程：

1. 执行生产构建。
2. 复制插件产物到本机测试库。
3. 启动本机 Obsidian 打开测试库。
4. 通过 Playwright CDP 连接 Obsidian。
5. 验证插件加载、中文命令注册和批注面板打开行为。

脚本会优先使用 Flatpak 应用 `md.obsidian.Obsidian`；也支持通过环境变量指定本机 Obsidian：

```bash
OBSIDIAN_EXECUTABLE=/path/to/obsidian npm run test:e2e
```

或指定自定义启动命令：

```bash
OBSIDIAN_E2E_COMMAND=/path/to/obsidian npm run test:e2e
```

完整测试：

```bash
npm run test:all
```

提交前应至少运行 `npm run test:all` 并确认通过。

## 兼容性

- Obsidian 最低版本：`0.15.0`
- 插件类型：桌面端专用
- 插件 ID：`marginalia`

## 许可证

[0-BSD](LICENSE)
