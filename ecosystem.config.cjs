// pm2 进程守护配置
// 常用命令：
//   npx pm2 start ecosystem.config.cjs   # 启动（首次）
//   npx pm2 restart ai-troubleshooter    # 重启（改代码 npm run build 后）
//   npx pm2 logs ai-troubleshooter       # 看日志
//   npx pm2 save && npx pm2 startup      # 开机自启（按提示执行输出命令）
module.exports = {
  apps: [
    {
      name: 'ai-troubleshooter',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      // 本机开发默认 development；生产部署时用 --env production，
      // 并确保环境中已注入 JWT_SECRET（见 src/config/configuration.ts 的启动校验）
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      time: true,
    },
  ],
};
