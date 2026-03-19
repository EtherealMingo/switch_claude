import type { ConnectivityStatus } from "../types";

export async function testConnectivity(baseURL: string, apiKey: string): Promise<ConnectivityStatus> {
  const start = Date.now();
  try {
    const url = `${baseURL.replace(/\/$/, "")}/v1/models`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    if (response.ok) {
      return { ok: true, latency, checkedAt: new Date() };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, checkedAt: new Date(), errorMessage: "API Key 无效或已过期" };
    }
    // 404 可能是端点不存在但连接成功（部分代理）
    if (response.status === 404) {
      return { ok: true, latency, checkedAt: new Date() };
    }
    return {
      ok: false,
      checkedAt: new Date(),
      errorMessage: `连接失败（HTTP ${response.status}）`,
    };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return { ok: false, checkedAt: new Date(), errorMessage: "连接超时，请检查代理地址是否正确" };
    }
    return { ok: false, checkedAt: new Date(), errorMessage: "网络错误，无法连接到代理地址" };
  }
}
