export const DEFAULT_PROXY_HOST = "127.0.0.1";

function trimValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b, c, d] = parts;
  if ([a, b, c, d].some((part) => part < 0 || part > 255)) {
    return false;
  }

  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

export function resolveProxyHost(env: NodeJS.ProcessEnv = process.env): string {
  return trimValue(env.PORTA_HOST) ?? DEFAULT_PROXY_HOST;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function isPrivateLanHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return isPrivateIpv4(normalized) || isPrivateIpv6(normalized);
}

export function formatListenAddress(host: string, port: number): string {
  const printableHost = host.includes(":") ? `[${host}]` : host;
  return `http://${printableHost}:${port}`;
}

function isTailscaleIp(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  // Tailscale CGNAT range: 100.64.0.0/10
  return a === 100 && b >= 64 && b <= 127;
}

export function assertSupportedListenHost(
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const normalized = host.trim().toLowerCase();

  if (isLoopbackHost(normalized) || isPrivateLanHost(normalized)) {
    return;
  }

  // Allow Tailscale IPs only if explicitly enabled via PORTA_TAILSCALE=1
  // This avoids permanently relaxing the exposure guard for CGNAT IPs.
  if (env.PORTA_TAILSCALE === "1" && isTailscaleIp(normalized)) {
    return;
  }

  if (
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]"
  ) {
    if (env.PORTA_ALLOW_WILDCARD === "1") {
      return;
    }
    throw new Error(
      "Wildcard bind addresses are not supported. Set PORTA_HOST to 127.0.0.1 for local/Zero Trust use, or to an explicit private LAN IP.",
    );
  }

  throw new Error(
    "Public internet exposure is unsupported. Set PORTA_HOST to a loopback address or an explicit private LAN IP.",
  );
}
