import { describe, expect, it } from "vitest";
import {
  assertSupportedListenHost,
  formatListenAddress,
  isLoopbackHost,
  isPrivateLanHost,
  resolveProxyHost,
} from "../exposure.js";

describe("proxy exposure guard", () => {
  it("defaults PORTA_HOST to loopback", () => {
    expect(resolveProxyHost({} as NodeJS.ProcessEnv)).toBe("127.0.0.1");
  });

  it("accepts loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(() => assertSupportedListenHost("127.0.0.1")).not.toThrow();
  });

  it("accepts explicit private LAN IPs", () => {
    expect(isPrivateLanHost("192.168.1.20")).toBe(true);
    expect(isPrivateLanHost("10.0.0.5")).toBe(true);
    expect(isPrivateLanHost("172.16.0.8")).toBe(true);
    expect(() => assertSupportedListenHost("192.168.1.20")).not.toThrow();
  });

  it("rejects wildcard bind addresses", () => {
    expect(() => assertSupportedListenHost("0.0.0.0")).toThrow(/Wildcard bind/);
    expect(() => assertSupportedListenHost("::")).toThrow(/Wildcard bind/);
  });

  it("allows wildcard bind addresses only with explicit opt-in", () => {
    expect(() =>
      assertSupportedListenHost("0.0.0.0", { PORTA_ALLOW_WILDCARD: "1" } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() =>
      assertSupportedListenHost("::", { PORTA_ALLOW_WILDCARD: "1" } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() =>
      assertSupportedListenHost("[::]", { PORTA_ALLOW_WILDCARD: "1" } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("rejects public addresses and unknown hostnames", () => {
    expect(isPrivateLanHost("8.8.8.8")).toBe(false);
    expect(() => assertSupportedListenHost("8.8.8.8")).toThrow(
      /Public internet exposure is unsupported/,
    );
    expect(() => assertSupportedListenHost("porta.example.com")).toThrow(
      /Public internet exposure is unsupported/,
    );
  });

  it("formats listen addresses for logs", () => {
    expect(formatListenAddress("127.0.0.1", 3100)).toBe(
      "http://127.0.0.1:3100",
    );
    expect(formatListenAddress("::1", 3100)).toBe("http://[::1]:3100");
  });
});
