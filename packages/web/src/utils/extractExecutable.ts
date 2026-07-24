/**
 * Extract executable name from a raw command line string.
 */
export function extractExecutable(commandLine: string): string {
  if (!commandLine) return "";
  let trimmed = commandLine.trim();

  // Strip environment variable definitions (e.g. "FOO=bar BAR=baz command")
  while (trimmed.match(/^[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+/)) {
    trimmed = trimmed.replace(/^[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+/, "");
  }

  // Split into tokens
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0 || !tokens[0]) return "";

  let rawExe = tokens[0];

  // Strip path (handle both forward and back slashes)
  const parts = rawExe.replace(/\\/g, "/").split("/");
  const baseRaw = (parts[parts.length - 1] || "").toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh)$/i, "");

  // If token is a wrapper like "cmd", "powershell", "npx", check next token
  if (["cmd", "powershell", "pwsh", "npx", "exec", "sudo", "env"].includes(baseRaw) && tokens.length > 1) {
    let idx = 1;
    while (idx < tokens.length && (tokens[idx].startsWith("-") || tokens[idx].startsWith("/"))) {
      idx++;
    }
    if (idx < tokens.length && tokens[idx]) {
      rawExe = tokens[idx];
    }
  }

  // Remove quotes
  rawExe = rawExe.replace(/^["']|["']$/g, "");

  // Take basename
  const nameParts = rawExe.replace(/\\/g, "/").split("/");
  let name = nameParts[nameParts.length - 1] || "";

  // Strip extensions
  name = name.replace(/\.(exe|cmd|bat|ps1|sh)$/i, "");

  return name.toLowerCase();
}
