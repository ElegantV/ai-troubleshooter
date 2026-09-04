/**
 * 知识/存储层查询服务：血缘图谱 + 作业链路的多跳关系遍历
 * 原型将图加载进内存（数据量小）；真实环境替换为图数据库（Neo4j）查询
 */
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('../config');

function loadGraph() {
  const db = new DatabaseSync(DB_PATH); // 读写连接：图谱查询为只读，query_log 审计需要写入
  // 团队并发读写下避免写锁阻塞：WAL 允许读写并行，busy_timeout 遇锁等待而非立刻报错
  db.prepare('PRAGMA journal_mode=WAL').get();
  db.prepare('PRAGMA busy_timeout=5000').run();
  const g = {
    db,
    tables: db.prepare('SELECT * FROM meta_tables').all(),
    columns: db.prepare('SELECT * FROM meta_columns').all(),
    jobs: db.prepare('SELECT * FROM jobs').all(),
    deps: db.prepare('SELECT * FROM job_deps').all(),
    lineage: db.prepare('SELECT * FROM table_lineage').all(),
  };
  // 作业依赖邻接表（双向）
  g.depUp = new Map();   // job -> 上游作业[]
  g.depDown = new Map(); // job -> 下游作业[]
  for (const d of g.deps) {
    if (!g.depUp.has(d.job_name)) g.depUp.set(d.job_name, []);
    if (!g.depDown.has(d.depends_on)) g.depDown.set(d.depends_on, []);
    g.depUp.get(d.job_name).push(d.depends_on);
    g.depDown.get(d.depends_on).push(d.job_name);
  }
  // 表血缘邻接表（双向）+ 表↔作业映射
  g.srcOf = new Map();  // tgt -> [{src, proc, job}]
  g.tgtOf = new Map();  // src -> [{tgt, proc, job}]
  g.producerOf = new Map();  // table -> 产出作业[]
  g.consumerOf = new Map();  // table -> 消费作业[]
  for (const e of g.lineage) {
    if (!g.srcOf.has(e.tgt_table)) g.srcOf.set(e.tgt_table, []);
    if (!g.tgtOf.has(e.src_table)) g.tgtOf.set(e.src_table, []);
    g.srcOf.get(e.tgt_table).push(e);
    g.tgtOf.get(e.src_table).push(e);
    if (e.via_job) {
      if (!g.producerOf.has(e.tgt_table)) g.producerOf.set(e.tgt_table, new Set());
      if (!g.consumerOf.has(e.src_table)) g.consumerOf.set(e.src_table, new Set());
      g.producerOf.get(e.tgt_table).add(e.via_job);
      g.consumerOf.get(e.src_table).add(e.via_job);
    }
  }
  // 表级上下游邻接表（按表名字符串，供多跳遍历；边详情存于 srcOf/tgtOf）
  g.tblUp = new Map();   // tgt -> 上游表[]
  g.tblDown = new Map(); // src -> 下游表[]
  for (const e of g.lineage) {
    if (!g.tblUp.has(e.tgt_table)) g.tblUp.set(e.tgt_table, []);
    if (!g.tblDown.has(e.src_table)) g.tblDown.set(e.src_table, []);
    if (!g.tblUp.get(e.tgt_table).includes(e.src_table)) g.tblUp.get(e.tgt_table).push(e.src_table);
    if (!g.tblDown.get(e.src_table).includes(e.tgt_table)) g.tblDown.get(e.src_table).push(e.tgt_table);
  }
  return g;
}

function bfs(adj, start, maxDepth = 4) {
  const seen = new Map([[start, 0]]);
  const order = [];
  let frontier = [start];
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next = [];
    for (const node of frontier) {
      for (const n of adj.get(node) || []) {
        if (!seen.has(n)) { seen.set(n, d); order.push({ node: n, depth: d }); next.push(n); }
      }
    }
    frontier = next;
  }
  return order;
}

module.exports = {
  loadGraph,
  jobUpstream: (g, job, d) => bfs(g.depUp, job, d),
  jobDownstream: (g, job, d) => bfs(g.depDown, job, d),
  tableUpstream: (g, t, d) => bfs(g.tblUp, t, d).map(x => ({ table: x.node, depth: x.depth })),
  tableDownstream: (g, t, d) => bfs(g.tblDown, t, d).map(x => ({ table: x.node, depth: x.depth })),
  producersOf: (g, t) => [...(g.producerOf.get(t) || [])],
  consumersOf: (g, t) => [...(g.consumerOf.get(t) || [])],
};
