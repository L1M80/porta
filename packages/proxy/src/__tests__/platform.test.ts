import { describe, expect, it } from "vitest";
import { getPlatformAdapter } from "../platform/index.js";
import {
  parseLsofPorts,
  parseNetstatPorts,
  parsePsCandidates,
  parseSsPorts,
  parseWin32ProcessCandidates,
} from "../platform/shared.js";

describe("platform adapter selection", () => {
  it("selects linux adapter", () => {
    expect(getPlatformAdapter("linux").id).toBe("linux");
  });

  it("selects darwin adapter", () => {
    expect(getPlatformAdapter("darwin").id).toBe("darwin");
  });

  it("selects win32 adapter", () => {
    expect(getPlatformAdapter("win32").id).toBe("win32");
  });

  it("throws on unsupported platforms", () => {
    expect(() => getPlatformAdapter("freebsd" as NodeJS.Platform)).toThrow(
      "Unsupported platform: freebsd",
    );
  });
});

describe("platform parsing helpers", () => {
  it("parses language server processes without hard-coding architecture", () => {
    const output = `
  123 /Applications/Antigravity/language_server_macos_arm64 --csrf_token abc --workspace_id file_C:_Users_test_project --extension_server_port 1919 --lsp_port 2020
  456 /opt/antigravity/language_server_linux_x64 --csrf_token def --server_port 3030
  457 "C:\\Program Files\\Antigravity\\language_server_windows_x64.exe" --csrf_token "ghi" --server_port 4040 --workspace_id "file_C:_Users_test_project"
  789 /usr/bin/something_else --csrf_token nope
  790 /usr/bin/node helper.js --label language_server_linux_x64 --csrf_token no-match
`;

    expect(parsePsCandidates(output)).toEqual([
      {
        pid: 123,
        csrfToken: "abc",
        workspaceId: "file_C:_Users_test_project",
        httpsPort: 0,
        httpPort: 1919,
        lspPort: 2020,
      },
      {
        pid: 456,
        csrfToken: "def",
        workspaceId: undefined,
        httpsPort: 3030,
        httpPort: 0,
        lspPort: 0,
      },
      {
        pid: 457,
        csrfToken: "ghi",
        workspaceId: "file_C:_Users_test_project",
        httpsPort: 4040,
        httpPort: 0,
        lspPort: 0,
      },
    ]);
  });

  it("parses ss output for a pid", () => {
    const output = `
LISTEN 0 4096 127.0.0.1:19222 0.0.0.0:* users:(("language_server",pid=123,fd=9))
LISTEN 0 4096 127.0.0.1:19223 0.0.0.0:* users:(("language_server",pid=123,fd=10))
LISTEN 0 4096 127.0.0.1:9999 0.0.0.0:* users:(("other",pid=555,fd=9))
`;

    expect(parseSsPorts(output, 123)).toEqual([19222, 19223]);
  });

  it("parses lsof output for listening ports", () => {
    const output = `
COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
language  123 user   17u  IPv4 0x123456789      0t0  TCP 127.0.0.1:19222 (LISTEN)
language  123 user   18u  IPv4 0x123456780      0t0  TCP 127.0.0.1:19223 (LISTEN)
`;

    expect(parseLsofPorts(output)).toEqual([19222, 19223]);
  });

  it("parses Win32 process JSON from PowerShell", () => {
    const output = JSON.stringify([
      {
        ProcessId: 123,
        Name: "language_server_windows_x64.exe",
        CommandLine:
          '"C:\\Program Files\\Antigravity\\language_server_windows_x64.exe" --csrf_token "abc" --extension_server_port 1919 --lsp_port 2020',
      },
      {
        ProcessId: 456,
        Name: "language_server_windows_x64.exe",
        CommandLine:
          'C:\\Antigravity\\language_server_windows_x64.exe --csrf_token def --server_port 3030',
      },
      {
        ProcessId: 789,
        Name: "not_language_server.exe",
        CommandLine: 'C:\\not_language_server.exe --csrf_token nope',
      },
    ]);

    expect(parseWin32ProcessCandidates(output)).toEqual([
      {
        pid: 123,
        csrfToken: "abc",
        workspaceId: undefined,
        httpsPort: 0,
        httpPort: 1919,
        lspPort: 2020,
      },
      {
        pid: 456,
        csrfToken: "def",
        workspaceId: undefined,
        httpsPort: 3030,
        httpPort: 0,
        lspPort: 0,
      },
    ]);
  });

  it("parses netstat output for a pid", () => {
    const output = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:19222        0.0.0.0:0              LISTENING       123
  TCP    127.0.0.1:19223        0.0.0.0:0              LISTENING       123
  TCP    127.0.0.1:19222        0.0.0.0:0              LISTENING       123
  TCP    127.0.0.1:9999         127.0.0.1:53210        ESTABLISHED     123
  TCP    [::]:135               [::]:0                 LISTENING       908
`;

    expect(parseNetstatPorts(output, 123)).toEqual([19222, 19223]);
  });

  it("parses localized netstat listening rows for a pid", () => {
    const output = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:19222        0.0.0.0:0              ABHREN          123
  TCP    127.0.0.1:19223        *:*                    ESCUCHANDO      123
  TCP    127.0.0.1:9999         127.0.0.1:53210        ESTABLISHED     123
  TCP    [::]:135               [::]:0                 ABHREN          908
`;

    expect(parseNetstatPorts(output, 123)).toEqual([19222, 19223]);
  });
});
