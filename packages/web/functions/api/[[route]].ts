// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const onRequest: any = async (context: any) => {
    const { request, env } = context;

    // Determine the target API base URL from the environment.
    let apiBase = env.PORTA_API_BASE;
    if (!apiBase) {
        return new Response(JSON.stringify({ error: "Missing PORTA_API_BASE environment variable" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (typeof apiBase === "string" && !apiBase.startsWith("http")) {
        apiBase = "https://" + apiBase;
    }

    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, apiBase);

    const headers = new Headers(request.headers);

    // 1. Inject Cloudflare Access Service Token credentials (if configured).
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
        headers.set("CF-Access-Client-Id", env.CF_ACCESS_CLIENT_ID);
        headers.set("CF-Access-Client-Secret", env.CF_ACCESS_CLIENT_SECRET);
    }

    // Strip origin headers to avoid triggering CORS preflight issues on the target server.
    headers.delete("Origin");
    headers.delete("Referer");

    const newRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
        redirect: "manual"
    });

    const response = await fetch(newRequest);

    // Clone the response so we can modify the headers
    const finalResponse = new Response(response.body, response);
    
    // CRITICAL FIX: Cloudflare Access on the API backend might return a `Set-Cookie: CF_Authorization` 
    // because it processed the request. If we forward this cookie back to the browser, it OVERWRITES 
    // the user's frontend CF_Authorization cookie, immediately corrupting their frontend session!
    // This causes all subsequent frontend requests to be rejected by Cloudflare Access with a 302/403.
    finalResponse.headers.delete("Set-Cookie");
    
    return finalResponse;
};
