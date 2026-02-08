import { readFile, writeFile } from "node:fs/promises";
import { CliError } from "../errors/cli-error.js";
import { ensureConfigDir, getConfigPath } from "./paths.js";
import { AppConfig, AppConfigSchema, InitAuthConfigInput } from "./types.js";

const SETUP_HINT = "Run `notion-lite auth` to configure the CLI.";

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();
  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new CliError("auth_or_config", `Config not found at ${configPath}. ${SETUP_HINT}`, {
      details: error,
    });
  }

  return parseConfig(raw);
}

export async function loadConfigOrNull(): Promise<AppConfig | null> {
  const configPath = getConfigPath();
  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return null;
  }

  return parseConfig(raw);
}

function parseConfig(raw: string): AppConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError("auth_or_config", "Config file is not valid JSON.", { details: error });
  }

  const result = AppConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError("auth_or_config", "Config file is invalid.", {
      details: result.error.flatten(),
    });
  }

  return result.data;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  ensureConfigDir();
  const configPath = getConfigPath();

  const result = AppConfigSchema.safeParse(config);
  if (!result.success) {
    throw new CliError("invalid_input", "Refused to save invalid config.", {
      details: result.error.flatten(),
    });
  }

  await writeFile(configPath, `${JSON.stringify(result.data, null, 2)}\n`, "utf8");
}

export function buildInitialAuthConfig(input: InitAuthConfigInput): AppConfig {
  return AppConfigSchema.parse({
    notion_api_key_env: input.notionApiKeyEnv,
    defaults: {
      limit: 25,
      view: "compact",
      max_blocks: 200,
      timeout_ms: 30000,
      schema_ttl_hours: 24,
    },
    schema_cache: {},
  });
}
