import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';

export interface QueryLogItem {
  query_id: string;
  created_at: string;
  user: string;
  input: string;
  route: string;
  confidence: string;
  summary: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async list(limit: number, offset: number): Promise<{ total: number; items: QueryLogItem[] }> {
    const total = Number((await this.db('query_log').count<{ c: string }>('* as c').first())?.c || 0);
    const rows = await this.db('query_log')
      .select('query_id', 'created_at', 'user_name', 'input_text', 'report_json')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
    const items = rows.map((r) => {
      const rep = JSON.parse(r.report_json || '{}');
      return {
        query_id: r.query_id,
        created_at: r.created_at,
        user: r.user_name || '-',
        input: r.input_text,
        route: rep.route || 'other',
        confidence: rep.confidence || '-',
        summary: rep.summary || '',
      };
    });
    return { total, items };
  }

  async detail(id: string) {
    const row = await this.db('query_log').where({ query_id: id }).first();
    if (!row) return null;
    return {
      query_id: row.query_id,
      created_at: row.created_at,
      user: row.user_name || '-',
      helpful: row.helpful || '',
      confirmed_cause: row.confirmed_cause || '',
      report: JSON.parse(row.report_json),
    };
  }
}