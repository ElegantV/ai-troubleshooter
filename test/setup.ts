// 测试统一使用独立的 PostgreSQL 库，避免污染开发库
process.env.DB_NAME = 'assistant_test';
process.env.JWT_SECRET = 'test-secret';