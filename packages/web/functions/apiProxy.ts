type PagesFunctionContext = {
  request: Request;
  env: {
    PORTA_API_BASE?: string;
    CF_ACCESS_CLIENT_ID?: string;
    CF_ACCESS_CLIENT_SECRET?: string;
  };
};

type ProxyOptions = {
  stripPathPrefix?: string;
};

function normalizePrefix(value: string): string {
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function stripPathPrefix(pathname: string, prefix: string): string {
  const normalized = normalizePrefix(prefix);
  if (!normalized) return pathname;
  if (pathname === normalized) return "/";
  if (pathname.startsWith(`${normalized}/`)) {
    return pathname.slice(normalized.length);
  }
  return pathname;
}

export async function proxyApiRequest(
  context: PagesFunctionContext,
  options: ProxyOptions = {},
) {
  const { request, env } = context;

  let apiBase = env.PORTA_API_BASE;
  if (!apiBase) {
    return new Response(
      JSON.stringify({ error: "Missing PORTA_API_BASE environment variable" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (typeof apiBase === "string" && !apiBase.startsWith("http")) {
    apiBase = `https://${apiBase}`;
  }

  const url = new URL(request.url);
  const pathname = options.stripPathPrefix
    ? stripPathPrefix(url.pathname, options.stripPathPrefix)
    : url.pathname;
  const targetUrl = new URL(pathname + url.search, apiBase);

  const headers = new Headers(request.headers);

  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Id", env.CF_ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.CF_ACCESS_CLIENT_SECRET);
  }

  headers.delete("Origin");
  headers.delete("Referer");

  const newRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD"
      ? request.body
      : null,
    redirect: "manual",
  });

  const response = await fetch(newRequest);
  const finalResponse = new Response(response.body, response);

  finalResponse.headers.delete("Set-Cookie");

  return finalResponse;
}
