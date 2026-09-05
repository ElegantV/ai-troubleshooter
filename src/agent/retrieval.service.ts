import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';

export interface SearchDoc {
  kind: 'ticket' | 'case';
  id: string;
  title: string;
  symptom: string;
  root_cause: string;
  solution: string;
  error_code: string;
  related_jobs: string[];
  related_tables: string[];
  system_code: string;
  text: string;
}

export interface SearchHit extends SearchDoc {
  bm25: number;
  boost: number;
  score: number;
  boostReasons: string[];
}

export interface SearchFilters {
  errorCode?: string;
  jobs?: string[];
  tables?: string[];
}

export const SEARCH_ADAPTER = Symbol('SEARCH_ADAPTER');

/** 案例检索适配器接口：当前 BM25，生产可替换为向量检索（pgvector/ES）混合检索 */
export interface ISearchAdapter {
  search(docs: SearchDoc[], query: string, filters: SearchFilters, topN: number): SearchHit[];
}

/** BM25 + 实体加权（错误码+3/作业+2.5/表+2）：原型核心资产，打分公式显式可调 */
export class Bm25SearchAdapter implements ISearchAdapter {
  search(docs: SearchDoc[], query: string, filters: SearchFilters, topN = 3): SearchHit[] {
    const index = buildIndex(docs);
    return bm25(index, query)
      .filter((r) => r.score > 0.5)
      .map((r) => {
        const doc = index.docs[r.i];
        let boost = 0;
        const boostReasons: string[] = [];
        if (filters.errorCode && doc.error_code === filters.errorCode) {
          boost += 3;
          boostReasons.push(`错误码 ${filters.errorCode} 匹配`);
        }
        if (filters.jobs?.some((j) => doc.related_jobs.includes(j))) {
          boost += 2.5;
          boostReasons.push(`关联作业 ${doc.related_jobs.filter((j) => filters.jobs!.includes(j)).join('/')}`);
        }
        if (filters.tables?.some((t) => doc.related_tables.includes(t))) {
          boost += 2;
          boostReasons.push(`关联表 ${doc.related_tables.filter((t) => filters.tables!.includes(t)).join('/')}`);
        }
        return { ...doc, bm25: +r.score.toFixed(2), boost, score: +(r.score + boost).toFixed(2), boostReasons };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const w of String(text).toLowerCase().match(/[a-z_][a-z0-9_]{1,}/g) || []) tokens.push(w);
  const cjk = String(text).match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of cjk) {
    if (seg.length === 1) {
      tokens.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
  }
  return tokens;
}

interface Bm25Index {
  docs: SearchDoc[];
  docTokens: Map<string, number>[];
  df: Map<string, number>;
  N: number;
  avgLen: number;
}

export function buildIndex(docs: SearchDoc[]): Bm25Index {
  const df = new Map<string, number>();
  const docTokens = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  return {
    docs,
    docTokens,
    df,
    N: docs.length,
    avgLen: docs.reduce((s, d) => s + tokenize(d.text).length, 0) / Math.max(docs.length, 1),
  };
}

export function bm25(index: Bm25Index, query: string, k1 = 1.5, b = 0.75): Array<{ i: number; score: number }> {
  const qTokens = tokenize(query);
  const scores: Array<{ i: number; score: number }> = [];
  for (let i = 0; i < index.docs.length; i++) {
    const tf = index.docTokens[i];
    const len = [...tf.values()].reduce((a, c) => a + c, 0);
    let score = 0;
    for (const t of qTokens) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (index.N - (index.df.get(t) || 0) + 0.5) / ((index.df.get(t) || 0) + 0.5));
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * len) / index.avgLen));
    }
    scores.push({ i, score });
  }
  return scores;
}

/** 案例检索服务：工单+已沉淀案例（入库时 count 变化自动重建索引） */
@Injectable()
export class RetrievalService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    @Inject(SEARCH_ADAPTER) private readonly adapter: ISearchAdapter,
  ) {}

  private cacheKey = '';
  private cache: SearchDoc[] = [];

  async loadDocs(): Promise<SearchDoc[]> {
    const tickets = await this.db('tickets').select('*');
    const cases = await this.db('cases').select('*');
    return [
      ...tickets.map((t) => this.toDoc(t, 'ticket')),
      ...cases.map((c) => this.toDoc(c, 'case')),
    ];
  }

  private toDoc(row: Record<string, any>, kind: 'ticket' | 'case'): SearchDoc {
    const related_jobs: string[] = JSON.parse(row.related_jobs || '[]');
    const related_tables: string[] = JSON.parse(row.related_tables || '[]');
    const text =
      kind === 'ticket'
        ? `${row.title} ${row.symptom} ${row.root_cause} ${row.error_code} ${related_jobs.join(' ')} ${related_tables.join(' ')}`
        : `${row.symptom} ${row.root_cause} ${row.error_code || ''} ${related_jobs.join(' ')} ${related_tables.join(' ')}`;
    return {
      kind,
      id: kind === 'ticket' ? row.ticket_id : row.case_id,
      title: kind === 'ticket' ? row.title : String(row.symptom || '').slice(0, 40),
      symptom: row.symptom,
      root_cause: row.root_cause,
      solution: row.solution,
      error_code: row.error_code || '',
      related_jobs,
      related_tables,
      system_code: row.system_code || '',
      text,
    };
  }

  async getDocs(): Promise<SearchDoc[]> {
    const key = await this.countKey();
    if (key !== this.cacheKey) {
      this.cache = await this.loadDocs();
      this.cacheKey = key;
    }
    return this.cache;
  }

  private async countKey(): Promise<string> {
    const t = await this.db('tickets').count<{ c: string }>('* as c').first();
    const c = await this.db('cases').count<{ c: string }>('* as c').first();
    return `${t?.c ?? 0}|${c?.c ?? 0}`;
  }

  /** 检索：默认限定用户所属系统（共享'' + 本系统），缩小候选集提升命中精度与效率 */
  async search(query: string, filters: SearchFilters = {}, topN = 3, systemCode = ''): Promise<SearchHit[]> {
    const all = await this.getDocs();
    const docs = systemCode ? all.filter((d) => !d.system_code || d.system_code === systemCode) : all;
    return this.adapter.search(docs, query.length > 400 ? query.slice(0, 400) : query, filters, topN);
  }
}