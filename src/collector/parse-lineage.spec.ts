import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseProcedure } from './parse-lineage';

describe('parseProcedure 血缘解析', () => {
  it('提取 INSERT...SELECT 的源/目标表', () => {
    const sql = `CREATE PROCEDURE p_cust_load AS
      INSERT INTO dws_cust_asset_d (cust_id, amt)
      SELECT c.cust_id, SUM(a.bal) FROM ods_acct_bal a JOIN dim_cust c ON a.cust_id=c.cust_id
      WHERE a.etl_dt='20260101' GROUP BY c.cust_id;`;
    const edges = parseProcedure(sql, 'p_cust_load');
    const tgt = [...new Set(edges.map((e) => e.tgt_table))];
    const srcs = edges.map((e) => e.src_table).sort();
    expect(tgt).toEqual(['dws_cust_asset_d']);
    expect(srcs).toEqual(['dim_cust', 'ods_acct_bal']);
  });

  it('忽略参数表（p_ 前缀）与 select/on 关键词', () => {
    const sql = `INSERT INTO tgt SELECT * FROM p_src_tbl SELECT, ON;`;
    const edges = parseProcedure(sql, 'p_test');
    expect(edges).toEqual([]);
  });

  it('支持多段 INSERT 的血缘边', () => {
    const sql = `INSERT INTO a SELECT * FROM s1;
      INSERT INTO b SELECT * FROM s2 JOIN s1 ON s2.k=s1.k;`;
    const edges = parseProcedure(sql, 'p_multi');
    const keys = edges.map((e) => `${e.src_table}->${e.tgt_table}`).sort();
    expect(keys).toContain('s1->a');
    expect(keys).toContain('s2->b');
    expect(keys).toContain('s1->b');
  });

  it('SQL 注释不影响解析', () => {
    const sql = `-- 注释 INSERT INTO fake SELECT * FROM ghost
      INSERT INTO real_tgt SELECT * FROM real_src;`;
    const edges = parseProcedure(sql, 'p_comment');
    expect(edges).toEqual([{ proc_name: 'p_comment', src_table: 'real_src', tgt_table: 'real_tgt' }]);
  });
});