export interface ProcessDiscoveryCandidate {
  pid: number;
  csrfToken: string;
  workspaceId?: string;
  appDataDir?: string;
  httpsPort: number;
  httpPort: number;
  lspPort: number;
}

export interface PlatformAdapter {
  readonly id: "linux" | "darwin" | "win32";
  isPidAlive(pid: number): Promise<boolean>;
  discoverFromProcess(): Promise<ProcessDiscoveryCandidate[]>;
  discoverPortsForPid(pid: number): Promise<number[]>;
}
