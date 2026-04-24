// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const onRequest: any = async (context: any) => {
  const { request, env } = context;

  // Determine the target API base URL from the environment.
  let apiBase = env.PORTA_API_BASE || env.VITE_API_BASE;
  if (!apiBase) {
    return new Response(
      JSON.stringify({ error: "Missing PORTA_API_BASE or VITE_API_BASE environment variable" }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (typeof apiBase === "string" && !apiBase.startsWith("http")) {
    apiBase = "https://" + apiBase;
  }

  const url = new URL(request.url);
  const targetUrl = new URL(url.pathname + url.search, apiBase);

  const headers = new Headers(request.headers);
  
  // Optionally inject Cloudflare Access credentials if provided in the environment.
  // This allows secure server-to-server communication without exposing secrets to the browser.
  if (env.CF_ACCESS_CLIENT_ID) {
    headers.set("CF-Access-Client-Id", env.CF_ACCESS_CLIENT_ID);
  }
  if (env.CF_ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Secret", env.CF_ACCESS_CLIENT_SECRET);
  }
  
  // Strip origin headers to avoid triggering CORS preflight issues on the target server.
  headers.delete("Origin");
  headers.delete("Referer");

  const newRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
    redirect: "manual",
  });

  return fetch(newRequest);
};
