import { execSync } from "child_process";
import path from "path";
import { CLAUDE_DIR, SETTINGS_PATH } from "../constants";

export function switchProfile(name: string): void {
  const targetPath = path.join(CLAUDE_DIR, `settings-${name}.json`);
  execSync(`ln -sf "${targetPath}" "${SETTINGS_PATH}"`);
}

export function removeSymlink(): void {
  execSync(`rm -f "${SETTINGS_PATH}"`);
}
