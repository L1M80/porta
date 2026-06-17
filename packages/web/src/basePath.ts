import { normalizeBasePath } from "./basePath.shared";

export { normalizeBasePath };

export const PORTA_BASE_PATH = normalizeBasePath(
  import.meta.env.PORTA_BASE_PATH || "/",
);
