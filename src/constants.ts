import os from "os";
import path from "path";

export const HOME_DIR = os.homedir();
export const CLAUDE_DIR = path.join(HOME_DIR, ".claude");
export const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
export const BACKUPS_DIR = path.join(CLAUDE_DIR, "backups");
export const DESKTOP_DIR = path.join(HOME_DIR, "Desktop");
export const MAX_BACKUPS = 10;

export interface ProviderTemplate {
  id: string;
  name: string;
  baseURL: string;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { id: "custom", name: "自定义", baseURL: "" },
  { id: "anthropic", name: "Anthropic 官方", baseURL: "https://api.anthropic.com" },
  { id: "longcat", name: "LongCat", baseURL: "https://api.longcat.chat/anthropic" },
];
