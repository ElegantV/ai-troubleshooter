/**
 * 验证 SQL 生成（模板化，只读 SELECT；真实环境经只读账号沙箱预执行校验）
 */
function partitionCol(graph, table) {
  const cols = graph.columns.filter(c => c.table_name === table).map(c => c.column_name);
  return cols.find(c => /data_dt|etl_dt/.test(c)) || null;
}

/**
 * @param focusTables 关注表
 * @param date 数据日期(yyyyMMdd)，prevDate 前一数据日期
 * @param columns 疑似异常字段
 */
function buildVerifySql(graph, { focusTables = [], date, prevDate, columns = [] } = {}) {
  const sqls = [];
  for (const t of focusTables.slice(0, 3)) {
    const pc = partitionCol(graph, t);
    if (pc && prevDate) {
      sqls.push({
        purpose: `${t} 当日与前日分区行数对比（数据缺失/骤降验证）`,
        sql: `SELECT '${date}' AS dt, COUNT(*) AS cnt FROM ${t} WHERE ${pc}='${date}'\nUNION ALL\nSELECT '${prevDate}', COUNT(*) FROM ${t} WHERE ${pc}='${prevDate}';`,
      });
      sqls.push({
        purpose: `${t} 最新分区检查（新鲜度验证）`,
        sql: `SELECT MAX(${pc}) AS latest_dt FROM ${t};`,
      });
    }
    const nullCols = columns.filter(c => graph.columns.some(col => col.table_name === t && col.column_name === c));
    if (nullCols.length) {
      sqls.push({
        purpose: `${t} 字段空值检查（${nullCols.join('/')}）`,
        sql: `SELECT COUNT(*) AS null_cnt FROM ${t} WHERE ${pc || '1=1'}${pc ? `='${date}' AND` : ''} ${nullCols.map(c => `${c} IS NULL`).join(' OR ')};`,
      });
    }
  }
  return sqls.slice(0, 4);
}

module.exports = { buildVerifySql };
