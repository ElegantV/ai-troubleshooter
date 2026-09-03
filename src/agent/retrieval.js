/**
 * 案例检索（原型：BM25 + 实体/错误码加权；真实环境：知识库平台向量检索）
 * 打分 = BM25 相关性 + 实体命中加权（错误码、关联作业、关联表）
 */
function tokenize(text) {
  const tokens = [];
  for (const w of String(text).toLowerCase().match(/[a-z_][a-z0-9_]{1,}/g) || []) tokens.push(w);
  // 中文按二元组切分
  const cjk = String(text).match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of cjk) {
    if (seg.length === 1) { tokens.push(seg); continue; }
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
  }
  return tokens;
}

function buildIndex(docs) {
  const df = new Map();
  const docTokens = docs.map(d => {
    const tf = new Map();
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  return { docs, docTokens, df, N: docs.length, avgLen: docs.reduce((s, d) => s + tokenize(d.text).length, 0) / Math.max(docs.length, 1) };
}

function bm25(index, query, k1 = 1.5, b = 0.75) {
  const qTokens = tokenize(query);
  const scores = [];
  for (let i = 0; i < index.docs.length; i++) {
    const tf = index.docTokens[i];
    const len = [...tf.values()].reduce((a, c) => a + c, 0);
    let score = 0;
    for (const t of qTokens) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (index.N - (index.df.get(t) || 0) + 0.5) / ((index.df.get(t) || 0) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / index.avgLen));
    }
    scores.push({ i, score });
  }
  return scores;
}

/** 工单+案例 → 检索文档 */
function loadDocs(db) {
  const tickets = db.prepare('SELECT * FROM tickets').all()
    .map(t => ({ kind: 'ticket', id: t.ticket_id, title: t.title, symptom: t.symptom, root_cause: t.root_cause, solution: t.solution, error_code: t.error_code, related_jobs: JSON.parse(t.related_jobs || '[]'), related_tables: JSON.parse(t.related_tables || '[]'), text: `${t.title} ${t.symptom} ${t.root_cause} ${t.error_code} ${(JSON.parse(t.related_jobs || '[]')).join(' ')} ${(JSON.parse(t.related_tables || '[]')).join(' ')}` }));
  const cases = db.prepare('SELECT * FROM cases').all()
    .map(c => ({ kind: 'case', id: c.case_id, title: c.symptom.slice(0, 40), symptom: c.symptom, root_cause: c.root_cause, solution: c.solution, error_code: c.error_code || '', related_jobs: JSON.parse(c.related_jobs || '[]'), related_tables: JSON.parse(c.related_tables || '[]'), text: `${c.symptom} ${c.root_cause} ${c.error_code || ''} ${(JSON.parse(c.related_jobs || '[]')).join(' ')} ${(JSON.parse(c.related_tables || '[]')).join(' ')}` }));
  return [...tickets, ...cases];
}

/** BM25 索引缓存：案例/工单数量变化时自动重建（录入新案例后立即参与匹配） */
let _indexCache = null;
function getIndex(db) {
  const n = db.prepare('SELECT (SELECT COUNT(*) FROM tickets) + (SELECT COUNT(*) FROM cases) AS n').get().n;
  if (!_indexCache || _indexCache.n !== n) _indexCache = { n, index: buildIndex(loadDocs(db)) };
  return _indexCache.index;
}

/** 在工单+已沉淀案例中检索，附带实体加权 */
function searchCases(db, query, { errorCode = '', jobs = [], tables = [] } = {}, topN = 3) {
  const index = getIndex(db);
  const results = bm25(index, query)
    .filter(r => r.score > 0.5)
    .map(r => {
      const doc = index.docs[r.i];
      let boost = 0; const boostReasons = [];
      if (errorCode && doc.error_code === errorCode) { boost += 3; boostReasons.push(`错误码 ${errorCode} 匹配`); }
      if (jobs.some(j => doc.related_jobs.includes(j))) { boost += 2.5; boostReasons.push(`关联作业 ${doc.related_jobs.filter(j => jobs.includes(j)).join('/')}`); }
      if (tables.some(t => doc.related_tables.includes(t))) { boost += 2; boostReasons.push(`关联表 ${doc.related_tables.filter(t => tables.includes(t)).join('/')}`); }
      return { ...doc, bm25: +r.score.toFixed(2), boost, score: +(r.score + boost).toFixed(2), boostReasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  return results;
}

module.exports = { searchCases, buildIndex, tokenize };
