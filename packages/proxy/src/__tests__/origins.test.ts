import { describe, expect, it } from "vitest";
import { getAllowedOrigins, isAllowedOrigin, resolveCorsOrigin } from "../origins.js";

describe("origin policy", () => {
  it("allows localhost origins by default", () => {
    const allowedOrigins = getAllowedOrigins({});

    expect(isAllowedOrigin("http://localhost:5173", allowedOrigins)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3100", allowedOrigins)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", allowedOrigins)).toBe(false);
  });

  it("adds trimmed custom origins from env", () => {
    const allowedOrigins = getAllowedOrigins({
      PORTA_CORS_ORIGINS: " https://porta.example , https://intranet.example ",
    });

    expect(isAllowedOrigin("https://porta.example", allowedOrigins)).toBe(true);
    expect(isAllowedOrigin("https://intranet.example", allowedOrigins)).toBe(
      true,
    );
  });

  it("allows origins for PORTA_HOST on any port", () => {
    const allowedOrigins = getAllowedOrigins({
      PORTA_HOST: "172.20.1.2",
    });

    expect(isAllowedOrigin("http://172.20.1.2:5173", allowedOrigins)).toBe(
      true,
    );
    expect(isAllowedOrigin("https://172.20.1.2", allowedOrigins)).toBe(true);
    expect(isAllowedOrigin("http://172.20.1.3:5173", allowedOrigins)).toBe(
      false,
    );
  });

  it("allows bracketed IPv6 PORTA_HOST origins", () => {
    const allowedOrigins = getAllowedOrigins({
      PORTA_HOST: "fd7a:115c:a1e0::1",
    });

    expect(isAllowedOrigin("http://[fd7a:115c:a1e0::1]:5173", allowedOrigins)).toBe(
      true,
    );
    expect(isAllowedOrigin("http://fd7a:115c:a1e0::1:5173", allowedOrigins)).toBe(
      false,
    );
  });

  it("maps rejected origins to null for CORS middleware", () => {
    const allowedOrigins = getAllowedOrigins({});

    expect(resolveCorsOrigin(undefined, allowedOrigins)).toBeUndefined();
    expect(resolveCorsOrigin("https://evil.example", allowedOrigins)).toBeNull();
    expect(resolveCorsOrigin("http://localhost:5173", allowedOrigins)).toBe(
      "http://localhost:5173",
    );
  });
});
