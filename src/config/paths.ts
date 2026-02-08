import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) {
    return join(xdg, "notion-lite");
  }
  return join(homedir(), ".config", "notion-lite");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function getAuditLogPath(): string {
  return join(getConfigDir(), "audit.log");
}

export function getIdempotencyDbPath(): string {
  return join(getConfigDir(), "idempotency.db");
}

export function ensureConfigDir(): string {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}
