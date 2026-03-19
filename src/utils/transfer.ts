import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { DESKTOP_DIR } from "../constants";
import type { ProfileConfig } from "../types";

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return "***";
  return key.slice(0, 8) + "***...***";
}

export function isMaskedKey(key: string): boolean {
  return key.includes("***");
}

export function exportProfile(name: string, config: ProfileConfig): string {
  const exported = {
    env: {
      ...config.env,
      ANTHROPIC_AUTH_TOKEN: maskApiKey(config.env.ANTHROPIC_AUTH_TOKEN),
    },
    permissions: config.permissions,
    _exportedAt: new Date().toISOString(),
    _profileName: name,
  };
  const destPath = path.join(DESKTOP_DIR, `claude-profile-${name}.json`);
  fs.writeFileSync(destPath, JSON.stringify(exported, null, 2), "utf-8");
  execSync(`open "${DESKTOP_DIR}"`);
  return destPath;
}

export function parseImportJson(jsonText: string): { config: ProfileConfig; hasMaskedKey: boolean } {
  const parsed = JSON.parse(jsonText);
  if (!parsed.env) throw new Error("缺少 env 字段");
  if (!parsed.env.ANTHROPIC_AUTH_TOKEN) throw new Error("缺少 ANTHROPIC_AUTH_TOKEN 字段");
  if (!parsed.env.ANTHROPIC_BASE_URL) throw new Error("缺少 ANTHROPIC_BASE_URL 字段");
  if (!parsed.env.ANTHROPIC_MODEL) throw new Error("缺少 ANTHROPIC_MODEL 字段");

  const hasMaskedKey = isMaskedKey(parsed.env.ANTHROPIC_AUTH_TOKEN);

  // 删除导出专属字段
  delete parsed._exportedAt;
  delete parsed._profileName;

  // 补全缺失的模型字段
  if (!parsed.permissions) parsed.permissions = { allow: [], deny: [] };
  const model = parsed.env.ANTHROPIC_MODEL;
  parsed.env.ANTHROPIC_SMALL_FAST_MODEL = parsed.env.ANTHROPIC_SMALL_FAST_MODEL || model;
  parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL = parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL || model;
  parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL = parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL || model;

  return { config: parsed as ProfileConfig, hasMaskedKey };
}

export function readFileAsText(filePath: string): string {
  const expanded = filePath.startsWith("~") ? path.join(os.homedir(), filePath.slice(1)) : filePath;
  return fs.readFileSync(expanded, "utf-8");
}
