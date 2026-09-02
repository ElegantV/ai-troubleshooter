/** 离线加工管线总入口：node src/pipeline/build.js */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('../config');
const { collect } = require('../collectors/collect');
const { parseAllProcedures } = require('./parseLineage');

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
collect(db);
parseAllProcedures(db);

const stats = {};
for (const t of ['meta_tables', 'meta_columns', 'jobs', 'job_deps', 'proc_lineage', 'table_lineage', 'batch_logs', 'job_runs', 'error_codes', 'tickets']) {
  stats[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
}
console.log('知识库构建完成:', JSON.stringify(stats, null, 2));
db.close();
