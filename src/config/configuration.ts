import * as path from 'path';

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
}

/**
 * 配置来源：环境变量（生产经 Nacos/Apollo + KMS 注入，代码内不出现任何明文密钥）。
 * 本对象为纯函数，便于测试注入。
 */
export default (): { app: AppConfig } => {
  const root = typeof __dirname !== 'undefined' ? path.join(__dirname, '..', '..') : process.cwd();
  return {
    app: {
      root,
      rawDir: process.env.RAW_DIR || path.join(root, 'data', 'raw'),
      port: parseInt(process.env.PORT || '3000', 10),
      db: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'a1-6',
        password: process.env.DB_PASSWORD || '',
        name: process.env.DB_NAME || 'assistant',
      },
      redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
      jwt: {
        secret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      },
      llm: {
        enabled: process.env.LLM_ENABLED === 'true',
        baseUrl: process.env.LLM_BASE_URL || '',
        apiKey: process.env.LLM_API_KEY || '',
        model: process.env.LLM_MODEL || '',
        timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10),
      },
      collectionIntervalMinutes: parseInt(process.env.COLLECT_INTERVAL_MINUTES || '10', 10),
    },
  };
};