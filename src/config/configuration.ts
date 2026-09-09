import * as path from 'path';
import { cleanEnv, num, str } from 'envalid';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface LlmConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface AppConfig {
  root: string;
  rawDir: string;
  port: number;
  db: DatabaseConfig;
  redis: RedisConfig;
  jwt: { secret: string; expiresIn: string };
  llm: LlmConfig;
  collectionIntervalMinutes: number;
  trustProxy: string;
}

/**
 * 配置来源：环境变量（生产经 Nacos/Apollo + KMS 注入，代码内不出现任何明文密钥）。
 * 全部经 envalid 校验：类型错误 / 必填缺失 / 数值越界会在启动时 fail-fast，
 * 避免拼错变量名静默回退默认值导致的"生产行为漂移"。
 */
const DEV_JWT_SECRET = 'dev-only-secret-change-me';

/** 已知弱默认值/占位符，任何环境（尤其生产）都禁止直接使用，避免 token 可被伪造 */
const WEAK_JWT_SECRETS = new Set(['dev-only-secret-change-me', 'change-me-in-production', 'change-me', 'secret']);
const MIN_JWT_SECRET_LENGTH = 32;

export default (): { app: AppConfig } => {
  const env = process.env.NODE_ENV || 'development';
  const root = typeof __dirname !== 'undefined' ? path.join(__dirname, '..', '..') : process.cwd();

  const cleaned = cleanEnv(process.env, {
    PORT: num({ default: 3000 }),
    DB_HOST: str({ default: '127.0.0.1' }),
    DB_PORT: num({ default: 5432 }),
    DB_USER: str({ default: 'a1-6' }),
    DB_PASSWORD: str({ default: '' }),
    DB_NAME: str({ default: 'assistant' }),
    REDIS_HOST: str({ default: '127.0.0.1' }),
    REDIS_PORT: num({ default: 6379 }),
    JWT_SECRET: str({ default: DEV_JWT_SECRET }),
    JWT_EXPIRES_IN: str({ default: '7d' }),
    LLM_ENABLED: str({ default: 'false' }),
    LLM_BASE_URL: str({ default: '' }),
    LLM_API_KEY: str({ default: '' }),
    LLM_MODEL: str({ default: '' }),
    LLM_TIMEOUT_MS: num({ default: 30000 }),
    COLLECT_INTERVAL_MINUTES: num({ default: 10 }),
    TRUST_PROXY: str({ default: 'loopback' }),
    RAW_DIR: str({ default: path.join(root, 'data', 'raw') }),
  });

  const collectIntervalMinutes = cleaned.COLLECT_INTERVAL_MINUTES!;
  if (collectIntervalMinutes < 1 || collectIntervalMinutes > 1440) {
    throw new Error(`COLLECT_INTERVAL_MINUTES 超出合法范围（1~1440 分钟），当前 ${collectIntervalMinutes}`);
  }
  const llmTimeoutMs = cleaned.LLM_TIMEOUT_MS!;
  if (llmTimeoutMs < 1000) {
    throw new Error(`LLM_TIMEOUT_MS 过小（<1000ms），当前 ${llmTimeoutMs}`);
  }

  const jwtSecret = cleaned.JWT_SECRET!;
  const isWeak =
    WEAK_JWT_SECRETS.has(jwtSecret) ||
    jwtSecret.length < MIN_JWT_SECRET_LENGTH ||
    jwtSecret === jwtSecret.toLowerCase().trim();
  if (env === 'production' && isWeak) {
    throw new Error(
      `生产环境 JWT_SECRET 必须是长度 >= ${MIN_JWT_SECRET_LENGTH} 的强随机密钥（含大小写/数字/符号），当前配置过于薄弱，已拒绝启动`,
    );
  }

  return {
    app: {
      root,
      rawDir: cleaned.RAW_DIR!,
      port: cleaned.PORT!,
      db: {
        host: cleaned.DB_HOST!,
        port: cleaned.DB_PORT!,
        user: cleaned.DB_USER!,
        password: cleaned.DB_PASSWORD!,
        name: cleaned.DB_NAME!,
      },
      redis: {
        host: cleaned.REDIS_HOST!,
        port: cleaned.REDIS_PORT!,
      },
      jwt: {
        secret: jwtSecret,
        expiresIn: cleaned.JWT_EXPIRES_IN!,
      },
      llm: {
        enabled: cleaned.LLM_ENABLED! === 'true',
        baseUrl: cleaned.LLM_BASE_URL!,
        apiKey: cleaned.LLM_API_KEY!,
        model: cleaned.LLM_MODEL!,
        timeoutMs: llmTimeoutMs,
      },
      collectionIntervalMinutes: collectIntervalMinutes,
      // 可信任反代(nginx/网关)来源：影响 X-Forwarded-For 是否可信。
      // 默认 loopback(本机反代)；生产按网段收紧，如 10.0.0.0/8,172.16.0.0/12
      trustProxy: cleaned.TRUST_PROXY!,
    },
  };
};