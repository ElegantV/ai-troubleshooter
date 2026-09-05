import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Bm25SearchAdapter, tokenize, buildIndex, bm25, SearchDoc } from './retrieval.service';

function doc(id: string, text: string, opts: Partial<SearchDoc> = {}): SearchDoc {
  return { kind: 'ticket', id, title: id, symptom: text, root_cause: '', solution: '', error_code: '', related_jobs: [], related_tables: [], system_code: '', text, ...opts };
}

describe('检索：分词', () => {
  it('中英文混合分词（英文词 + 中文二元组）', () => {
    const t = tokenize('ORA-01400 job 客户信息为空');
    expect(t).toContain('ora');
    expect(t).toContain('job');
    expect(t).toContain('客户');
    expect(t).toContain('为空');
  });
});

describe('检索：BM25 排序', () => {
  it('相关文档得分高于不相关文档', () => {
    const docs = [
      doc('a', '源文件格式变更 客户号为空 ORA-01400'),
      doc('b', '表空间不足 数据库磁盘写满'),
      doc('c', '作业调度参数错误'),
    ];
    const index = buildIndex(docs);
    const scores = bm25(index, '客户号为空 ORA-01400');
    const byId = scores.map((s) => ({ id: index.docs[s.i].id, score: s.score })).sort((x, y) => y.score - x.score);
    expect(byId[0].id).toBe('a');
  });
});

describe('检索：实体加权（错误码+3 / 作业+2.5 / 表+2）', () => {
  const docs: SearchDoc[] = [
    doc('t1', 'ORA-01400 dwd_txnl_clean 客户号为空', { error_code: 'ORA-01400', related_jobs: ['job_dwd_txnl_clean'], related_tables: ['dwd_txnl_detail_d'] }),
    doc('t2', '维表刷新失败 客户维度数据过期', { related_jobs: ['job_dim_cust_sync'] }),
  ];

  it('错误码精确匹配加 3 分', () => {
    const adapter = new Bm25SearchAdapter();
    const hits = adapter.search(docs, 'ORA-01400', { errorCode: 'ORA-01400' }, 2);
    const top = hits[0];
    expect(top.id).toBe('t1');
    expect(top.boost).toBe(3);
    expect(top.boostReasons).toContain('错误码 ORA-01400 匹配');
  });

  it('关联作业匹配加 2.5 分', () => {
    const adapter = new Bm25SearchAdapter();
    const hits = adapter.search(docs, '维表 客户维度', { jobs: ['job_dim_cust_sync'] }, 2);
    expect(hits[0].id).toBe('t2');
    expect(hits[0].boost).toBe(2.5);
  });

  it('关联表匹配加 2 分', () => {
    const adapter = new Bm25SearchAdapter();
    const hits = adapter.search(docs, '客户号为空', { tables: ['dwd_txnl_detail_d'] }, 2);
    expect(hits[0].id).toBe('t1');
    expect(hits[0].boost).toBe(2);
  });

  it('综合得分 = bm25 + boost，且 < 阈值不返回', () => {
    const adapter = new Bm25SearchAdapter();
    const hits = adapter.search(docs, '完全不相关的内容 xyz abc', { errorCode: 'ORA-01400' }, 2);
    expect(hits.length).toBe(0);
  });
});