export function validateProviderBaseUrl(baseUrl?: string): void {
  if (!baseUrl) return;
  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error();
  } catch {
    throw new Error("API 地址必须为 HTTP/HTTPS，不能含用户名或密码。");
  }
}
