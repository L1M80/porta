import { proxyApiRequest } from "../../apiProxy";

export const onRequest = (context: Parameters<typeof proxyApiRequest>[0]) =>
  proxyApiRequest(context, { stripPathPrefix: "/porta" });
