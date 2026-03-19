import fs from "fs";
import path from "path";
import { CLAUDE_DIR, SETTINGS_PATH, BACKUPS_DIR, MAX_BACKUPS } from "../constants";
import type { ProfileConfig } from "../types";
import { switchProfile } from "./switch";

function atomicWrite(filePath: string, data: object): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pruneBackups(): void {
  try {
    ensureDir(BACKUPS_DIR);
    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtime }))
      .sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
    while (files.length >= MAX_BACKUPS) {
      const oldest = files.shift()!;
      fs.unlinkSync(path.join(BACKUPS_DIR, oldest.name));
    }
  } catch {
    // 备份清理失败不影响主流程
  }
}

export function backupProfile(name: string): void {
  const srcPath = path.join(CLAUDE_DIR, `settings-${name}.json`);
  if (!fs.existsSync(srcPath)) return;
  ensureDir(BACKUPS_DIR);
  pruneBackups();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = path.join(BACKUPS_DIR, `settings-${name}.${timestamp}.json`);
  fs.copyFileSync(srcPath, destPath);
}

export function buildProfileConfig(apiKey: string, baseURL: string, model: string): ProfileConfig {
  return {
    env: {
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: baseURL,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    },
    permissions: { allow: [], deny: [] },
  };
}

export function writeProfile(name: string, config: ProfileConfig): void {
  ensureDir(CLAUDE_DIR);
  const filePath = path.join(CLAUDE_DIR, `settings-${name}.json`);
  atomicWrite(filePath, config);
}

export function updateModel(name: string, model: string): void {
  const filePath = path.join(CLAUDE_DIR, `settings-${name}.json`);
  const content = fs.readFileSync(filePath, "utf-8");
  const config = JSON.parse(content) as ProfileConfig;
  config.env.ANTHROPIC_MODEL = model;
  config.env.ANTHROPIC_SMALL_FAST_MODEL = model;
  config.env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
  config.env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
  atomicWrite(filePath, config);
}

// 更新 profile（含重命名）：写新文件 → 更新 symlink → 删旧文件
export function updateProfile(
  oldName: string,
  newName: string,
  config: ProfileConfig,
  wasActive: boolean
): void {
  writeProfile(newName, config);
  if (wasActive) switchProfile(newName);
  if (oldName !== newName) {
    const oldPath = path.join(CLAUDE_DIR, `settings-${oldName}.json`);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
}

export function deleteProfile(name: string, remainingNames: string[]): void {
  backupProfile(name);
  if (remainingNames.length > 0) {
    switchProfile(remainingNames[0]);
  } else {
    // 无剩余 profile，删除 symlink
    try {
      fs.unlinkSync(SETTINGS_PATH);
    } catch {
      // ignore
    }
  }
  const filePath = path.join(CLAUDE_DIR, `settings-${name}.json`);
  fs.unlinkSync(filePath);
}

// 初始化向导：把现有 settings.json 转为 symlink 体系
export function initializeFromExisting(name: string, currentConfig: ProfileConfig): void {
  // 1. 把现有 settings.json 内容写为第一个 profile
  writeProfile(name, currentConfig);
  // 2. 备份原始文件
  const timestamp = Date.now();
  fs.copyFileSync(SETTINGS_PATH, `${SETTINGS_PATH}.bak.${timestamp}`);
  // 3. ln -sf 强制替换 settings.json 为 symlink（-f 会覆盖普通文件）
  switchProfile(name);
}
