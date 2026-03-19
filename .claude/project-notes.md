# switch_claude 项目笔记

> **约定**：本文档随每次讨论持续更新，记录所有设计决策和变更。

---

## 项目目标
为 Claude Code 代理切换工具开发一个 Mac GUI（Raycast Extension），替代现有命令行操作，支持普通用户可视化管理配置。

---

## 现有架构（已确认）

**切换机制：符号链接（symlink），不是 JSON merge**

| 关键路径 | 说明 |
|---------|------|
| `~/.claude/settings.json` | symlink，指向当前激活的 profile |
| `~/.claude/settings-{name}.json` | 各 profile 真实配置文件 |
| `~/shell/claude-switch.sh` | 现有 Shell 脚本（保留兼容） |

**配置文件结构：**
```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "xxx",
    "ANTHROPIC_BASE_URL": "https://xxx",
    "ANTHROPIC_MODEL": "model-name",
    "ANTHROPIC_SMALL_FAST_MODEL": "model-name",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "model-name",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "model-name"
  },
  "permissions": { "allow": [], "deny": [] }
}
```

**我的 5 个已有 Profile：**
- `longcat` → LongCat Flash-Chat
- `thinking` → LongCat Thinking-2601
- `anthropic` → Anthropic 官方 API
- `iwhale` → 浩鲸 API（支持 jq 修改模型）
- `kimicode` → Kimi Code API

**检测当前激活：**
```bash
readlink ~/.claude/settings.json  # 返回目标文件路径
```

**切换命令：**
```bash
ln -sf ~/.claude/settings-{name}.json ~/.claude/settings.json
```

---

## 方案选型结论

**选 Raycast Extension（方案 A）**，原因：
1. 切换操作是 symlink，不需要复杂 GUI
2. Raycast List 天然适合"从 N 个选项选 1 个"
3. TypeScript/React 技术栈完全匹配
4. 零菜单栏污染，⌘+Space 呼出即用

---

## 功能设计（当前版本）

### 用户初始状态分类

| 用户类型 | settings.json 状态 | 工具行为 |
|---------|-------------------|---------|
| **普通用户（99%）** | 普通文件，零个 settings-*.json | 触发初始化向导，引导转换为 symlink 体系 |
| **已有多配置用户** | symlink，有多个 settings-*.json | 直接展示配置列表 |
| **全新用户** | 不存在 | 空状态引导，⌘+N 新建 |

初始化向导是普通用户的**主入口**，执行后用户拥有第 1 个 profile，可继续通过 ⌘+N 新增代理配置。

### 主列表（List 视图）

| 操作 | 快捷键 | 说明 |
|------|--------|------|
| 切换到此配置 | Enter | 执行 symlink，HUD 提示 |
| 测试连通性 | ⌘+T | 请求 /v1/models 验证 Key 可用性 |
| 新建配置 | ⌘+N | 打开新建 Form |
| 编辑配置 | ⌘+E | 打开编辑 Form（预填当前值） |
| 重命名 | ⌘+Shift+R | 修改 profile 名称（文件名） |
| 删除配置 | ⌘+D | 自动备份后删除 |
| 修改模型 | ⌘+M | 所有 profile 均支持，弹出单字段 Form |
| 导出配置 | ⌘+Shift+E | 脱敏后写入 ~/Desktop |
| 导入配置 | ⌘+Shift+I | 粘贴 JSON 文本或输入文件路径 |
| 刷新列表 | ⌘+R | 重新扫描文件 |

### 新建 / 编辑 Form（面向普通用户）

字段使用中文 label，屏蔽技术细节：

| 表单字段 | 对应 JSON 字段 | 类型 | 说明 |
|---------|--------------|------|------|
| 从模板填充 | - | dropdown | 选后自动填入 baseURL |
| 配置名称 | 文件名后缀 | text | 只允许 `/^[a-z0-9-]+$/`，不能为 `settings`，长度 ≤ 30 |
| API Key | ANTHROPIC_AUTH_TOKEN | password | 显示/隐藏切换 |
| 代理地址 | ANTHROPIC_BASE_URL | text | URL 格式校验，https:// 开头 |
| 模型名称 | 4 个模型字段统一写入 | text | 一个输入填写所有 4 个模型字段 |
| 创建后立即激活 | - | checkbox | 默认勾选 |

**首次新建时**用 `LocalStorage.getItem('hasCreatedProfile')` 判断是否首次，在 Form 底部显示安全提示，保存后写入标志位。

### Detail 面板
- 代理地址（完整显示）
- 模型名称
- API Key（前 8 位 + `...`）
- 连通性状态（⌘+T 测试后显示：✅ 可用 · {n}ms 或 ❌ 失败）
- 最后修改时间（`fs.statSync` 读取 mtime）

---

## 技术规范

- 使用 `@raycast/api` 最新版
- 文件操作：Node.js `fs` 模块（readdirSync / readlinkSync / readFileSync / renameSync / lstatSync）
- symlink 操作：`child_process.execSync('ln -sf ...')`
- 模型修改：直接读写 JSON（不依赖 jq，零外部依赖）
- 连通性测试：`fetch` + `AbortSignal.timeout(5000)`，请求 `/v1/models` 不消耗 token
- 不引入 execa 等额外依赖，仅使用 Node.js 内置模块

**代码结构：**
```
src/
  switch-claude.tsx      # 主命令（List 视图 + 启动初始化检测）
  utils/
    config.ts            # 动态扫描 profile、检测激活状态、读取详情
    switch.ts            # symlink 切换
    file.ts              # 原子写入、CRUD、重命名、备份（~/.claude/backups/）
    validate.ts          # 名称格式（/^[a-z0-9-]+$/）、URL 格式校验
    connectivity.ts      # API 连通性测试，结果缓存在内存
    transfer.ts          # 导入/导出（导出时 API Key 脱敏）
  constants.ts           # Provider 模板列表、CLAUDE_DIR 路径常量
  types.ts               # TypeScript 类型定义
package.json
```

**类型定义：**
```typescript
interface ProfileEnv {
  ANTHROPIC_AUTH_TOKEN: string
  ANTHROPIC_BASE_URL: string
  ANTHROPIC_MODEL: string
  ANTHROPIC_SMALL_FAST_MODEL: string
  ANTHROPIC_DEFAULT_SONNET_MODEL: string
  ANTHROPIC_DEFAULT_OPUS_MODEL: string
}

interface ProfileConfig {
  env: ProfileEnv
  permissions: { allow: string[]; deny: string[] }
}

interface Profile {
  name: string           // 文件名后缀
  config: ProfileConfig
  isActive: boolean
  filePath: string
  lastModified: Date
  connectivityStatus?: { ok: boolean; latency?: number; checkedAt: Date }
}
```

---

## Cursor/Trae 完整 Prompt（最新版）

```markdown
角色：你是 Raycast Extension 开发专家，精通 TypeScript 和 Node.js 文件系统操作。

任务：创建一个 Raycast Extension，用于可视化管理 Claude Code 的代理配置，目标用户包括非技术的普通用户。

## 现有架构（必须理解，不要偏离）
切换机制：**符号链接**，不是 JSON 合并。
- 配置文件目录：`~/.claude/`
- 当前激活配置：`~/.claude/settings.json`（应为 symlink）
- 各 profile 文件：`~/.claude/settings-{name}.json`（真实文件）
- 切换命令：`ln -sf ~/.claude/settings-{name}.json ~/.claude/settings.json`
- 检测当前激活：`fs.readlinkSync('~/.claude/settings.json')` 解析出 name

## 配置文件结构
```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "xxx",
    "ANTHROPIC_BASE_URL": "https://xxx",
    "ANTHROPIC_MODEL": "model-name",
    "ANTHROPIC_SMALL_FAST_MODEL": "model-name",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "model-name",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "model-name"
  },
  "permissions": { "allow": [], "deny": [] }
}
```

## Profile 发现机制（动态扫描，禁止硬编码）
启动时扫描 `~/.claude/settings-*.json`，自动提取 name（去掉前缀和后缀）。
每个 List.Item 的 subtitle 显示 env.ANTHROPIC_BASE_URL 字段值。

---

## 功能需求

### 1. 启动初始化（首次使用核心流程）

**关键认知**：本工具服务于已安装 Claude Code 的用户，99% 的普通用户初始状态是：
- `~/.claude/settings.json` 存在且是**普通文件**（非 symlink）
- 零个 `settings-*.json` 文件
- 工具扫描结果为空，无法使用

因此**初始化向导是普通用户的主入口，不是边缘 case**。

**启动检测逻辑：**
```
settings.json 是 symlink？
  ├── 是 → 正常运行，扫描 settings-*.json 展示列表
  └── 否（普通文件）→ 触发初始化向导（见下）

settings.json 不存在？
  └── 极少见（未配置过 Claude Code），直接进入空状态引导
```

**初始化向导 UI（settings.json 为普通文件时）：**

弹出 Form，标题"初始化配置管理"，内容：
- 说明文字（Form.Description）："检测到你已有 Claude 配置，将其保存为第一个 Profile，之后可随时新增更多代理。"
- 当前配置预览（只读）：显示现有 settings.json 中的 baseURL 和 model，让用户确认
- 字段：「当前配置名称」（默认填 `default`，可修改）

提交后执行：
1. `fs.copyFileSync(settingsPath, claudeDir/settings-{name}.json)` 保存为第一个 profile
2. `fs.renameSync(settingsPath, settingsPath + '.bak.' + timestamp)` 备份原文件
3. `execSync('ln -sf ...')` 建立 symlink
4. 跳转回主列表，显示刚创建的 profile，Toast 提示"初始化完成，可通过 ⌘+N 新增更多代理配置"

### 2. 空状态（settings.json 不存在的极少见情况）
`List.EmptyView`，title："还没有配置"，description："按 ⌘+N 新建你的第一个代理配置"

### 3. 主列表（switch-claude.tsx）
- 动态列出所有 profile，当前激活的 accessory 显示绿色 ✅ + "当前使用"
- 右侧 Detail 面板：baseURL（完整）、model、apiKey（前8位+...）、连通性状态、文件最后修改时间
- ActionPanel 操作：

| 操作 | 快捷键 |
|------|--------|
| 切换到此配置 | Enter |
| 测试连通性 | ⌘+T |
| 新建配置 | ⌘+N |
| 编辑配置 | ⌘+E |
| 重命名 | ⌘+Shift+R |
| 删除配置 | ⌘+D |
| 修改模型 | ⌘+M |
| 导出配置 | ⌘+Shift+E |
| 导入配置 | ⌘+Shift+I |
| 刷新列表 | ⌘+R |

### 4. 新建 / 编辑 Form（面向普通用户）
使用中文 label，不暴露技术字段名。

**新建 Form 顶部**：下拉选择"从模板快速填充"（选后自动填入 baseURL）：
| 模板名 | baseURL |
|--------|---------|
| Anthropic 官方 | https://api.anthropic.com |
| LongCat | https://api.longcat.chat/anthropic |
| 自定义 | 手动输入 |

**表单字段**：
- 配置名称（→ 文件名后缀，校验：`/^[a-z0-9-]+$/`，不能为 "settings"，长度 ≤ 30）
- API Key（→ ANTHROPIC_AUTH_TOKEN，password 类型）
- 代理地址（→ ANTHROPIC_BASE_URL，URL 格式校验，以 https:// 开头）
- 模型名称（→ 同时写入所有 4 个模型字段）
- 创建后立即激活（checkbox，默认 true）

**首次新建时**，在 Form 底部显示一次性安全提示（用 Form.Description）：
"API Key 以明文存储在 ~/.claude 目录，请勿将配置文件提交到 Git 仓库"
判断首次：`await LocalStorage.getItem('hasCreatedProfile')`，保存成功后写入 `await LocalStorage.setItem('hasCreatedProfile', 'true')`。

**写入逻辑**：原子写入（先写 .tmp，再 fs.renameSync）。

**编辑时**：预填已有值，配置名称字段**可修改**（支持重命名）。
重命名逻辑：写入新文件 → 若原来是激活状态则更新 symlink → 删除旧文件（三步原子化）。

### 5. 删除确认（含自动备份）
- `confirmAlert` 弹出确认，message 中注明"删除前将自动备份"
- 删除前备份到 `~/.claude/backups/settings-{name}.{timestamp}.json`
- 备份目录超过 10 个文件时，自动清理最旧的
- 若删除的是激活配置：symlink 指向第一个剩余 profile；无其他 profile 则删除 symlink

### 6. 修改模型（⌘+M，所有 profile 均支持）
弹出单字段 Form，输入新模型名，直接用 Node.js fs 读取 JSON、修改 4 个模型字段、原子写入（不依赖 jq）。

### 7. 连通性测试（⌘+T）
请求 `{baseURL}/v1/models`（GET + Authorization header），不消耗 token：
- 5 秒超时（AbortSignal.timeout(5000)）
- 成功：Detail 面板显示 "✅ 可用 · {latency}ms"，Toast 提示延迟
- 失败：显示 HTTP 状态码或网络错误，提示检查 Key 和地址
- 测试结果缓存在组件 state，仅本次会话有效

### 8. 导出配置（⌘+Shift+E）
将选中 profile 导出为 JSON 文件，API Key 自动脱敏（替换为 `sk-***...***`）：
- 直接写入 `~/Desktop/claude-profile-{name}.json`（Raycast 无原生 Save As 对话框）
- 写入后用 `showToast` 提示文件路径，用 `open ~/Desktop` 打开 Finder 定位

### 9. 导入配置（⌘+Shift+I）
Raycast 无原生文件选择对话框，提供两种导入方式：
- **方式一（推荐）**：弹出 Form，包含一个大文本框，用户粘贴 JSON 文本内容
- **方式二**：弹出 Form，用户输入文件绝对路径，读取后解析
- 检测到脱敏 Key（含 `***`）时，额外显示 API Key 输入框要求填写真实值
- 导入前校验 JSON 结构（必须含 env.ANTHROPIC_AUTH_TOKEN / BASE_URL / MODEL 字段）

---

## 错误信息规范（所有 showFailureToast 必须用中文）
| 技术错误 | 展示文案 |
|---------|---------|
| ENOENT | 配置文件不存在，请重新创建 |
| EACCES | 没有权限修改文件，请检查 ~/.claude 目录权限 |
| symlink 失败 | 切换失败，请确认 ~/.claude 目录可写 |
| JSON parse error | 配置文件格式损坏，请删除后重新创建 |
| fetch timeout | 连接超时，请检查代理地址是否正确 |
| fetch 401/403 | API Key 无效或已过期 |

---

## 技术规范
- 使用 @raycast/api 最新版
- 文件操作：Node.js fs 模块（readdirSync / readlinkSync / readFileSync / renameSync / lstatSync）
- symlink 操作：child_process.execSync 执行 ln -sf
- 模型修改：直接读写 JSON（不依赖 jq）
- 完整 TypeScript 类型定义（见下方）
- 所有文件操作包裹 try/catch，失败时 showFailureToast

## TypeScript 类型定义
```typescript
interface ProfileEnv {
  ANTHROPIC_AUTH_TOKEN: string
  ANTHROPIC_BASE_URL: string
  ANTHROPIC_MODEL: string
  ANTHROPIC_SMALL_FAST_MODEL: string
  ANTHROPIC_DEFAULT_SONNET_MODEL: string
  ANTHROPIC_DEFAULT_OPUS_MODEL: string
}
interface ProfileConfig {
  env: ProfileEnv
  permissions: { allow: string[]; deny: string[] }
}
interface Profile {
  name: string
  config: ProfileConfig
  isActive: boolean
  filePath: string
  lastModified: Date
  connectivityStatus?: { ok: boolean; latency?: number; checkedAt: Date }
}
```

## 代码结构
```
src/
  switch-claude.tsx      # 主命令（List 视图 + 初始化检测）
  utils/
    config.ts            # 动态扫描、检测激活、读取详情
    switch.ts            # symlink 切换
    file.ts              # 原子写入、CRUD、备份、重命名
    validate.ts          # 名称格式、URL 格式校验
    connectivity.ts      # API 连通性测试
    transfer.ts          # 导入/导出（含脱敏逻辑）
  constants.ts           # Provider 模板列表、CLAUDE_DIR 路径
  types.ts               # TypeScript 类型定义
package.json
```

## package.json（Raycast Extension manifest 格式）
```json
{
  "name": "claude-proxy-switcher",
  "title": "Claude Proxy Switcher",
  "description": "可视化管理 Claude Code 代理配置",
  "icon": "extension-icon.png",
  "author": "your-raycast-username",
  "categories": ["Developer Tools"],
  "license": "MIT",
  "commands": [
    {
      "name": "switch-claude",
      "title": "Switch Claude Proxy",
      "description": "切换 Claude 代理配置",
      "mode": "view"
    }
  ],
  "dependencies": {
    "@raycast/api": "^1.0.0"
  },
  "devDependencies": {
    "@raycast/utils": "^1.0.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "build": "ray build -e dist",
    "dev": "ray develop",
    "lint": "ray lint"
  }
}
```

## 约束
- 不要硬编码 profile 名，全部动态扫描
- 不要引入 execa 等额外依赖，使用 Node.js 内置模块
- 不要依赖 jq，模型修改直接读写 JSON
- 代码简洁，无过度抽象
```

---

## 分发方式

| 方式 | 适合场景 |
|------|---------|
| 发布到 Raycast Store | 公开给所有人 |
| 导出 .raycastx 文件 | 私下分享给朋友（双击安装） |
| 共享 Git 仓库 | 技术用户（clone + npm install + npm run dev） |

**普通用户唯一前置条件：安装 Raycast**（无其他依赖，已移除 jq）

---

## 发布到 Raycast Store

### 发布前准备

**必须满足的文件要求：**

| 文件 | 要求 | 状态 |
|------|------|------|
| `assets/extension-icon.png` | 512×512px，PNG，正式图标（非占位） | ⚠️ 需替换 |
| `metadata/1.png` 等截图 | 1280×800px，展示扩展实际界面，至少 1 张 | ⚠️ 需替换 |
| `README.md` | 中英文双语，介绍功能和用法 | ✅ 已完成 |
| `CHANGELOG.md` | 版本变更记录 | ✅ 已完成 |
| `package.json` `author` 字段 | 填写你的 Raycast 账号用户名 | ⚠️ 需确认 |

**截图建议内容（3 张）：**
1. 主列表页 + Detail 面板（展示多个 profile）
2. 新建配置 Form（含模板下拉）
3. 初始化向导 Form（或连通性测试结果）

截图方法：运行 `npm run dev`，在 Raycast 中打开扩展，用 `⌘+Shift+4` 截取 1280×800 区域保存到 `metadata/` 目录。

---

### 发布步骤

**第一步：准备本地扩展**
```bash
# 确保最终构建通过
cd /Users/mingo/Documents/personal_code/switch_claude
npm run build
```

**第二步：Fork 官方仓库**
1. 访问 [github.com/raycast/extensions](https://github.com/raycast/extensions)
2. 点击右上角 **Fork**

**第三步：Clone 并复制扩展**
```bash
git clone https://github.com/你的用户名/extensions.git ~/raycast-extensions
cp -r /Users/mingo/Documents/personal_code/switch_claude \
  ~/raycast-extensions/extensions/claude-proxy-switcher

# 进入仓库，创建新分支
cd ~/raycast-extensions
git checkout -b add-claude-proxy-switcher
```

**第四步：清理不需要提交的文件**
```bash
cd ~/raycast-extensions/extensions/claude-proxy-switcher
rm -rf node_modules dist .claude
```

**第五步：提交并推送**
```bash
cd ~/raycast-extensions
git add extensions/claude-proxy-switcher
git commit -m "Add Claude Proxy Switcher extension"
git push origin add-claude-proxy-switcher
```

**第六步：提 Pull Request**
1. 访问你 Fork 的仓库页面
2. 点击 **Compare & pull request**
3. 填写 PR 描述（说明扩展功能）
4. 提交，等待官方 Review

---

### 审核注意事项

- **审核周期**：通常 1～2 周
- **图标和截图**：是最常被打回的原因，需符合 Raycast 设计规范
- **代码审查**：不允许有敏感操作（读写非必要目录等），本扩展操作范围仅限 `~/.claude/`，应可通过
- **README 语言**：官方要求英文，当前中英双语格式可接受

---

### 本地加载（开发 / 测试用）

不发布也可本地使用：

```bash
# 方式一：开发模式（需要 Raycast 在前台运行）
cd /Users/mingo/Documents/personal_code/switch_claude
npm run dev

# 方式二：Raycast 偏好设置导入
# Raycast → Preferences → Extensions → + → Add Script Directory
# 选择 /Users/mingo/Documents/personal_code/switch_claude
```

---

## 完整用户流程

### 底层原理

Claude Code 启动时读取 `~/.claude/settings.json`。工具的本质是控制这个 symlink 指向哪个 profile 文件。所有操作均为纯文件操作，Claude Code 无感知，重启后新配置自动生效。

```
Claude Code → 读取 ~/.claude/settings.json（symlink）
                          │
                          └──► 实际指向 ~/.claude/settings-{name}.json
```

---

### 流程一：普通用户首次启动（99% 的情况）

```
打开 Raycast，输入 "Switch Claude" 回车
          │
          ▼
    扩展加载，执行启动检测
    fs.lstatSync('~/.claude/settings.json')
          │
          ├─ 文件不存在 ──────────────────────────────► 流程三（空状态）
          │
          └─ 存在，是普通文件（非 symlink）
                    │
                    ▼
          ┌─────────────────────────────┐
          │      初始化向导 Form        │
          │                             │
          │  [说明] 检测到你已有 Claude │
          │  配置，保存为第一个 Profile │
          │                             │
          │  [只读] 代理地址: xxx       │ ← 读取现有 settings.json 内容
          │  [只读] 模型: xxx           │
          │                             │
          │  [输入] 配置名称: default   │ ← 用户可修改
          └─────────────────────────────┘
                    │ 点击确认
                    ▼
    1. copyFileSync  settings.json → settings-default.json
    2. renameSync    settings.json → settings.json.bak.时间戳
    3. ln -sf        settings-default.json → settings.json
                    │
                    ▼
       主列表（1 个 profile，✅ 激活）
       Toast: "初始化完成，⌘+N 可新增代理"
                    │
                    ▼
              ► 进入流程二，新增第一个第三方代理
```

---

### 流程二：新增代理配置

```
主列表界面，按 ⌘+N
          │
          ▼
    ┌──────────────────────────────────┐
    │         新建配置 Form            │
    │                                  │
    │  [下拉] 从模板填充               │
    │         ├─ Anthropic 官方        │ ← 选后自动填入 baseURL
    │         ├─ LongCat              │
    │         └─ 自定义                │
    │                                  │
    │  [输入] 配置名称                 │ ← 校验 /^[a-z0-9-]+$/，不能为 settings
    │  [密码] API Key                  │
    │  [输入] 代理地址                 │ ← 校验 URL 格式
    │  [输入] 模型名称                 │ ← 同时写入 4 个模型字段
    │  [勾选] 创建后立即激活  ✓        │
    │                                  │
    │  [安全提示] 首次创建时显示       │ ← LocalStorage 判断是否首次
    └──────────────────────────────────┘
          │ 点击创建
          ▼
    校验不通过 → 字段标红提示，不提交
    校验通过
          │
          ▼
    原子写入：
    writeFileSync → settings-{name}.json.tmp
    renameSync    → settings-{name}.json
          │
          │ 若勾选"立即激活"
          ▼
    ln -sf settings-{name}.json → settings.json
          │
          ▼
    主列表刷新，新 profile 显示 ✅
    Toast: "已切换到 {name}"
```

---

### 流程三：全新用户（settings.json 不存在）

```
扩展加载，检测到 settings.json 不存在
          │
          ▼
    List.EmptyView
    "还没有配置，按 ⌘+N 新建第一个代理配置"
          │
          ▼
    ► 用户按 ⌘+N，进入流程二
```

---

### 流程四：日常切换（已有多个 profile）

```
打开 Raycast → 输入 "Switch Claude"
          │
          ▼
    检测到 settings.json 是 symlink
    扫描 ~/.claude/settings-*.json
          │
          ▼
    ┌──────────────────────────────────────┐
    │  my-proxy      ✅ 当前使用           │ ← readlinkSync 识别激活项
    │  default                             │
    │  another-proxy                       │
    └──────────────────────────────────────┘
    右侧 Detail 面板：
      代理地址 / 模型 / API Key 前8位
      连通性状态 / 最后修改时间
          │
          │ 选中目标 profile，按 Enter
          ▼
    ln -sf settings-{name}.json → settings.json
          │
          ▼
    HUD: "✅ 已切换到 {name}"
    列表刷新，目标 profile 显示 ✅
          │
          ▼
    重启或新开 Claude Code 会话，新配置生效
```

---

### 支线操作

**⌘+T 测试连通性：**
```
选中 profile → ⌘+T
  → fetch({baseURL}/v1/models, Authorization: Bearer {key}, timeout: 5s)
  → 成功：Detail 面板 "✅ 可用 · {n}ms"
  → 401/403：Toast "API Key 无效或已过期"
  → 超时：Toast "连接超时，请检查代理地址"
```

**⌘+M 修改模型：**
```
选中 profile → ⌘+M → 单字段 Form 输入新模型名
  → 读取 settings-{name}.json
  → 修改 4 个模型字段（MODEL / SMALL_FAST / DEFAULT_SONNET / DEFAULT_OPUS）
  → 原子写入
  → Toast: "模型已更新为 {model}"
```

**⌘+E 编辑 / ⌘+Shift+R 重命名：**
```
编辑：预填已有值，修改后原子写入覆盖同名文件
重命名：写入新文件 → 若激活则更新 symlink → 删除旧文件（三步原子化）
```

**⌘+D 删除：**
```
选中 profile → ⌘+D → confirmAlert 确认
  → 备份至 ~/.claude/backups/settings-{name}.{时间戳}.json
  → 若是激活配置：symlink 指向第一个剩余 profile
  → 若无剩余 profile：删除 symlink
  → unlinkSync 删除文件 → 列表刷新
```

**⌘+Shift+E 导出 / ⌘+Shift+I 导入：**
```
导出：API Key 脱敏（替换为 sk-***...***）→ 写入 ~/Desktop/claude-profile-{name}.json
导入：Form 粘贴 JSON 文本 → 校验结构 → 检测到脱敏 Key 时要求补填真实值 → 写入
```

---

### 完整状态机

```
                   ┌──────────────────┐
                   │    首次打开工具   │
                   └────────┬─────────┘
                            │ 启动检测
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
     普通文件（99%）      symlink           不存在
          │                 │                 │
          ▼                 ▼                 ▼
     初始化向导         扫描 profiles      空状态引导
          │                 │                 │
          └────────┬────────┘                 │
                   ▼                          ▼
               主列表  ◄─────────────── ⌘+N 新建
                   │
       ┌───────────┼────────────┐
       ▼           ▼            ▼
  切换配置       管理配置      测试连通
  (Enter)    (⌘N/E/D/M/R)     (⌘T)
       │
       ▼
  symlink 更新
       │
       ▼
  Claude Code 重启后读取新配置
```

---



| 日期 | 变更内容 |
|------|---------|
| 2026-03-19 | 初始方案选型，确认 symlink 架构，修正原 Prompt 中 JSON merge 的错误描述 |
| 2026-03-19 | 面向他人分发：改为动态 profile 扫描，移除硬编码 profile 名 |
| 2026-03-19 | 新增普通用户 CRUD 功能：新建/编辑 Form（中文 label）、删除确认、原子写入、⌘M 修改模型扩展到所有 profile |
| 2026-03-19 | 补充面向普通用户的 9 项功能点，按 P0/P1/P2 分级：迁移向导、连通性测试、Provider 模板、自动备份、导入导出等 |
| 2026-03-19 | 将所有 P0/P1/P2 功能整合进 Cursor Prompt：迁移向导、空状态、连通性测试、重命名、模板、备份、导入导出、错误文案规范；移除 jq 依赖（改为直接读写 JSON）；更新代码结构新增 connectivity.ts / transfer.ts / constants.ts |
| 2026-03-19 | 同步更新文档技术规范：移除 jq 依赖说明、更新代码结构（移除 create-profile.tsx，新增 connectivity.ts / transfer.ts / constants.ts）、Profile 类型补充 connectivityStatus 字段 |
| 2026-03-19 | 全文一致性修复：功能设计表格补全所有快捷键、Detail 面板加连通性状态、Prompt 修复导入导出实现方式（LocalStorage 判断首次、导出写 Desktop、导入用 Form 粘贴文本）、补充 package.json manifest 示例、删除冗余的 P0/P1/P2 章节（已并入 Prompt）、分发方式移除 jq 前置条件 |
| 2026-03-19 | 重新认识普通用户场景：99% 用户只有单个 settings.json（普通文件），初始化向导升级为主入口；向导改为 Form（含当前配置预览）；文档补充用户初始状态分类表 |
| 2026-03-19 | 新增"完整用户流程"章节：底层原理说明、4 条主流程（首次启动/新增代理/全新用户/日常切换）、支线操作、完整状态机 |
| 2026-03-19 | 完成所有源码开发，修复 @raycast/tsconfig 不存在问题，创建占位图标，npm run build 通过 |
| 2026-03-19 | 新增 README.md（中英双语）、CHANGELOG.md、metadata/ 截图目录；package.json 移除 private 字段，描述改为中英双语 |
| 2026-03-19 | 新增"发布到 Raycast Store"章节：发布前准备清单、完整六步发布流程、审核注意事项、本地加载方式 |
