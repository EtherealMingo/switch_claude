export function isValidProfileName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name) && name !== "settings" && name.length >= 1 && name.length <= 30;
}

export function isValidUrl(url: string): boolean {
  return url.startsWith("https://") && url.length > 8;
}

export function getNameError(name: string): string | undefined {
  if (!name || name.trim() === "") return "配置名称不能为空";
  if (name === "settings") return "名称不能为 settings";
  if (name.length > 30) return "名称最多 30 个字符";
  if (!/^[a-z0-9-]+$/.test(name)) return "只允许小写字母、数字和连字符";
  return undefined;
}

export function getUrlError(url: string): string | undefined {
  if (!url || url.trim() === "") return "代理地址不能为空";
  if (!url.startsWith("https://")) return "代理地址必须以 https:// 开头";
  return undefined;
}
