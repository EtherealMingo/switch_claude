export interface ProfileEnv {
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_SMALL_FAST_MODEL: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL: string;
}

export interface ProfileConfig {
  env: ProfileEnv;
  permissions: { allow: string[]; deny: string[] };
}

export interface ConnectivityStatus {
  ok: boolean;
  latency?: number;
  checkedAt: Date;
  errorMessage?: string;
}

export interface Profile {
  name: string;
  config: ProfileConfig;
  isActive: boolean;
  filePath: string;
  lastModified: Date;
  connectivityStatus?: ConnectivityStatus;
}

export type SettingsStatus = "symlink" | "regular-file" | "not-exists";
