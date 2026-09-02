/**
 * 规则归因引擎（原型核心：可解释的确定性规则；接入 LLM 后作为 LLM 归因的候选生成器）
 * 输出候选原因：{title, score(0-10), evidence[], type}
 */

/** 当日各作业状态 Map */
function jobStatusMap(db, date) {
  const m = new Map();
  for (const r of db.prepare('SELECT * FROM job_runs WHERE run_date=?').all(date)) m.set(r.job_name, r);
  return m;
}
function prevRunDate(db, date) {
  return db.prepare('SELECT MAX(run_date) AS d FROM job_runs WHERE run_date < ?').get(date)?.d || null;
}
function jobErrorLogs(db, date, job) {
  return db.prepare("SELECT * FROM batch_logs WHERE run_date=? AND job_name=? AND (level='ERROR' OR message LIKE '%SKIPPED%') ORDER BY line_no").all(date, job);
}
function jobWarnLogs(db, date, job) {
  return db.prepare("SELECT * FROM batch_logs WHERE run_date=? AND job_name=? AND level='WARN' ORDER BY line_no").all(date, job);
}
function errorCodeInfo(db, code) {
  return db.prepare('SELECT * FROM error_codes WHERE code=?').get(code);
}
function tablesOfJobs(graph, jobs) {
  const set = new Set();
  for (const e of graph.lineage) {
    if (e.via_job && jobs.includes(e.via_job)) { set.add(e.tgt_table); set.add(e.src_table); }
  }
  return [...set];
}

/** 场景A：批量作业失败排查 */
function analyzeJobFailure(db, graph, ent) {
  const date = ent.date;
  const statusMap = jobStatusMap(db, date);
  const prevDate = prevRunDate(db, date);
  const causes = [], impact = [];

  // 定位目标作业：显式提到 > 当日 FAILED > 当日 SKIPPED
  let target = ent.jobs[0];
  if (!target) {
    const failed = db.prepare("SELECT job_name FROM job_runs WHERE run_date=? AND final_status='FAILED' LIMIT 1").get(date);
    target = failed?.job_name || db.prepare("SELECT job_name FROM job_runs WHERE run_date=? AND final_status='SKIPPED' LIMIT 1").get(date)?.job_name;
  }
  if (!target) return { causes, impact, focusJobs: [], focusTables: [], note: '未识别到目标作业，当日也无失败/跳过作业记录' };

  const run = statusMap.get(target);
  const upstream = require('./graphQuery').jobUpstream(graph, target, 3);
  const badUpstream = upstream.filter(u => ['FAILED', 'SKIPPED'].includes(statusMap.get(u.node)?.final_status));

  // C1 上游依赖未就绪
  if (run?.final_status === 'SKIPPED' || badUpstream.length) {
    const ev = badUpstream.map(u => {
      const s = statusMap.get(u.node);
      const errs = jobErrorLogs(db, date, u.node).slice(0, 2).map(e => e.message);
      return `${u.node}（${u.depth}级上游）当日状态: ${s?.final_status || '无记录'}${errs.length ? '，日志: ' + errs.join(' | ') : ''}`;
    });
    if (run?.final_status === 'SKIPPED') ev.unshift(`作业 ${target} 当日被调度跳过（SKIPPED）`);
    causes.push({ type: '上游依赖', title: `上游依赖未就绪：${badUpstream.map(u => u.node).join('、') || '（上游链路中存在失败作业）'}，导致本作业失败或被跳过`, score: 9, evidence: ev });
  }

  // C2 错误码归因（本作业及其上游的 ERROR/WARN 线索）
  const focusLogs = [...jobErrorLogs(db, date, target), ...badUpstream.flatMap(u => jobErrorLogs(db, date, u.node))];
  const codes = [...new Set(focusLogs.map(l => l.error_code).filter(Boolean))];
  for (const code of codes) {
    const info = errorCodeInfo(db, code);
    if (!info) continue;
    const ev = [
      `错误码 ${code}：${info.meaning}`,
      `典型成因：${info.typical_cause}`,
      ...focusLogs.filter(l => l.error_code === code).slice(0, 2).map(l => `日志佐证 [${l.ts}] ${l.job_name}: ${l.message}`),
    ];
    // 上游加载作业的 WARN（如文件格式变更线索）
    for (const u of upstream) {
      for (const w of jobWarnLogs(db, date, u.node)) {
        if (/缺失|变更|异常|重发/.test(w.message)) ev.push(`上游告警 [${w.ts}] ${u.node}: ${w.message}`);
      }
    }
    causes.push({ type: '错误码归因', title: `按错误码 ${code} 判断：${info.typical_cause}`, score: 8, evidence: ev });
  }

  // C2b 输入中明确给出错误码但当日日志未见时，回溯近期该作业的错误记录
  if (ent.errorCode && !codes.includes(ent.errorCode)) {
    const info = errorCodeInfo(db, ent.errorCode);
    const hist = db.prepare("SELECT run_date, ts, message FROM batch_logs WHERE job_name=? AND level='ERROR' AND (error_code=? OR message LIKE ?) ORDER BY run_date DESC LIMIT 2")
      .all(target, ent.errorCode, `%${ent.errorCode}%`);
    if (hist.length) {
      causes.push({
        type: '错误码归因(历史)', score: 7.2,
        title: `错误码 ${ent.errorCode}${info ? '：' + info.typical_cause : ''}（当日日志未见该错误，最近出现于 ${hist[0].run_date}，可参考当日处置）`,
        evidence: hist.map(h => `[${h.run_date} ${h.ts}] ${h.message}`),
      });
    }
  }

  // C3 维表未刷新
  const staleDim = badUpstream.filter(u => graph.jobs.find(j => j.job_name === u.node)?.layer === 'DIM');
  if (staleDim.length) {
    causes.push({ type: '维表过期', title: `维表刷新作业异常：${staleDim.map(u => u.node).join('、')}，新数据将关联不上维表`, score: 7, evidence: staleDim.map(u => `${u.node} 当日状态 ${statusMap.get(u.node)?.final_status}`) });
  }

  // 影响范围：下游作业状态 + 未产出表
  const downstream = require('./graphQuery').jobDownstream(graph, target, 3);
  for (const d of downstream) {
    const s = statusMap.get(d.node);
    impact.push(`作业 ${d.node}（${d.depth}级下游）当日状态: ${s?.final_status || '无记录'}`);
  }
  const affectedTables = tablesOfJobs(graph, [target, ...downstream.map(d => d.node)]);
  for (const t of affectedTables) {
    const producedByFailed = graph.lineage.some(e => e.tgt_table === t && e.via_job && [target, ...downstream.map(d => d.node)].includes(e.via_job));
    if (producedByFailed) impact.push(`表 ${t} 当日分区（${date}）预计未产出，依赖该表的下游取数将失败或数据缺失`);
  }

  return { causes, impact, focusJobs: [target, ...badUpstream.map(u => u.node)], focusTables: tablesOfJobs(graph, [target]), prevDate, target };
}

/** 场景B：数据异常排查 */
function analyzeDataAnomaly(db, graph, ent) {
  const date = ent.date;
  const statusMap = jobStatusMap(db, date);
  const prevDate = prevRunDate(db, date);
  const causes = [], impact = [];
  const table = ent.tables[0];
  if (!table) {
    // 未指定表但给出了字段：定位包含该字段的候选表，给出排查方向
    if (ent.columns.length) {
      const cands = [...new Set(db.prepare(`SELECT DISTINCT table_name FROM meta_columns WHERE column_name IN (${ent.columns.map(() => '?').join(',')})`).all(...ent.columns).map(r => r.table_name))];
      causes.push({
        type: '字段定位', score: 6.5,
        title: `未指定异常表；字段 ${ent.columns.join('、')} 出现在 ${cands.length} 张表中，建议按数据链路顺序逐表核查：${cands.join('、')}`,
        evidence: cands.slice(0, 4).map(t => {
          const prod = require('./graphQuery').producersOf(graph, t);
          const s = prod.map(j => statusMap.get(j)?.final_status || '无记录').join('/');
          return `表 ${t}（加工作业: ${prod.join(',') || '未知'}，当日状态: ${s || '-'}）`;
        }),
      });
      return { causes, impact: ['补充表名可获得更精确的血缘影响分析与验证 SQL'], focusJobs: [], focusTables: cands.slice(0, 2), prevDate, target: null };
    }
    return { causes, impact, focusJobs: [], focusTables: [], note: '未识别到异常表，请输入表名、字段名或粘贴报错日志' };
  }

  const producers = require('./graphQuery').producersOf(graph, table);
  const consumers = require('./graphQuery').consumersOf(graph, table);

  // C1 产出作业当日未正常产出
  for (const job of producers) {
    const s = statusMap.get(job);
    if (!s || s.final_status !== 'SUCCESS') {
      const errs = jobErrorLogs(db, date, job).slice(0, 2).map(e => `[${e.ts}] ${e.message}`);
      causes.push({
        type: '产出缺失', score: 9.5,
        title: `产出作业 ${job} 当日状态为 ${s?.final_status || '无运行记录'}，表 ${table} 的 ${date} 分区未正常生成`,
        evidence: [
          `job_runs: ${job} @ ${date} → ${s?.final_status || '无记录'}`,
          ...errs,
          ...(s && s.final_status === 'SKIPPED' ? ['被跳过通常因上游依赖失败，需沿作业链路向上追查根因'] : []),
        ],
      });
    } else {
      // C2 产出正常但上游数据量骤降
      if (prevDate && s.rows_loaded && prevDate) {
        const prev = db.prepare('SELECT rows_loaded FROM job_runs WHERE run_date=? AND job_name=?').get(prevDate, job);
        if (prev?.rows_loaded && Math.abs(s.rows_loaded - prev.rows_loaded) / prev.rows_loaded > 0.3) {
          const pct = ((s.rows_loaded - prev.rows_loaded) / prev.rows_loaded * 100).toFixed(1);
          causes.push({ type: '数据量骤降', score: 8.5, title: `产出作业 ${job} 当日加载行数较前日变化 ${pct}%（${prev.rows_loaded} → ${s.rows_loaded}），上游输入可能不完整`, evidence: [`job_runs 行数对比: ${prevDate}=${prev.rows_loaded}，${date}=${s.rows_loaded}`] });
        }
      }
      // C3 上游作业失败未逐级重跑
      const ups = require('./graphQuery').jobUpstream(graph, job, 3);
      const badUps = ups.filter(u => ['FAILED', 'SKIPPED'].includes(statusMap.get(u.node)?.final_status));
      if (badUps.length) {
        causes.push({ type: '上游失败', score: 7.5, title: `上游作业存在失败/跳过未恢复：${badUps.map(u => u.node).join('、')}，本作业虽成功但基于缺失/旧数据计算`, evidence: badUps.map(u => `${u.node}（${u.depth}级上游）当日状态: ${statusMap.get(u.node)?.final_status}`) });
      }
    }
  }
  if (!producers.length) {
    causes.push({ type: '血缘缺失', score: 6, title: `未找到表 ${table} 的加工作业（无产出血缘），可能为源系统直接提供或血缘未覆盖`, evidence: ['表级血缘视图中无该表的产出作业'] });
  }

  // 字段级线索
  if (ent.columns.length) {
    causes.push({ type: '字段级', score: 5, title: `疑似与字段 ${ent.columns.join('、')} 相关：上游文件格式变更或维表关联不上常导致单字段异常`, evidence: ['参考历史案例：客户号关联不上维表（TKT-2026-0021）'] });
  }

  // 影响范围
  const downTables = require('./graphQuery').tableDownstream(graph, table, 3);
  for (const d of downTables) {
    impact.push(`表 ${d.table}（${d.depth}级下游）依赖本表数据，异常将传导`);
    for (const j of require('./graphQuery').producersOf(graph, d.table)) {
      impact.push(`作业 ${j}（加工 ${d.table}）当日状态: ${statusMap.get(j)?.final_status || '无记录'}`);
    }
  }
  if (!downTables.length && consumers.length) impact.push(`消费方作业: ${consumers.join('、')}`);

  return { causes, impact, focusJobs: producers, focusTables: [table, ...downTables.map(d => d.table)], prevDate, target: table };
}

module.exports = { analyzeJobFailure, analyzeDataAnomaly, prevRunDate };
