import fs from "fs";
import path from "path";
import { CLAUDE_DIR, SETTINGS_PATH } from "../constants";
import type { Profile, ProfileConfig, SettingsStatus } from "../types";

export function getSettingsStatus(): SettingsStatus {
  try {
    const stat = fs.lstatSync(SETTINGS_PATH);
    return stat.isSymbolicLink() ? "symlink" : "regular-file";
  } catch {
    return "not-exists";
  }
}

export function readCurrentConfig(): ProfileConfig | null {
  try {
    const content = fs.readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(content) as ProfileConfig;
  } catch {
    return null;
  }
}

export function getActiveName(): string | null {
  try {
    const target = fs.readlinkSync(SETTINGS_PATH);
    const basename = path.basename(target);
    const match = basename.match(/^settings-(.+)\.json$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function scanProfiles(): Profile[] {
  try {
    if (!fs.existsSync(CLAUDE_DIR)) return [];
    const activeName = getActiveName();
    const files = fs.readdirSync(CLAUDE_DIR);
    const profiles: Profile[] = [];

    for (const file of files) {
      const match = file.match(/^settings-(.+)\.json$/);
      if (!match) continue;
      const name = match[1];
      const filePath = path.join(CLAUDE_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, "utf-8");
        const config = JSON.parse(content) as ProfileConfig;
        profiles.push({
          name,
          config,
          isActive: name === activeName,
          filePath,
          lastModified: stat.mtime,
        });
      } catch {
        // 跳过格式损坏的文件
      }
    }

    // 激活的排在最前，其余按字母排
    profiles.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return profiles;
  } catch {
    return [];
  }
}

export function profileExists(name: string): boolean {
  return fs.existsSync(path.join(CLAUDE_DIR, `settings-${name}.json`));
}
