/** 离线加工管线总入口：node src/pipeline/build.js */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('../config');
const { collect } = require('../collectors/collect');
const { parseAllProcedures } = require('./parseLineage');

// 重建只刷新知识数据；已有库中的案例库/审计记录/用户会话全部保留（数据飞轮不因重建丢失）
if (fs.existsSync(DB_PATH)) console.log('检测到已有知识库：仅刷新知识表，保留案例库 / 审计记录 / 用户');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
collect(db);
parseAllProcedures(db);

const stats = {};
for (const t of ['meta_tables', 'meta_columns', 'jobs', 'job_deps', 'proc_lineage', 'table_lineage', 'batch_logs', 'job_runs', 'error_codes', 'tickets']) {
  stats[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
}
stats['cases(保留)'] = db.prepare('SELECT COUNT(*) AS c FROM cases').get().c;
stats['query_log(保留)'] = db.prepare('SELECT COUNT(*) AS c FROM query_log').get().c;
console.log('知识库构建完成:', JSON.stringify(stats, null, 2));
db.close();
