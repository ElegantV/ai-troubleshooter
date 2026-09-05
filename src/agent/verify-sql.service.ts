import { Injectable } from '@nestjs/common';
import { GraphQueryService } from './graph-query.service';

export interface VerifySqlItem {
  purpose: string;
  sql: string;
}

export interface VerifySqlParams {
  focusTables?: string[];
  date?: string | null;
  prevDate?: string | null;
  columns?: string[];
}

/** 验证 SQL 生成（模板化只读 SELECT；生产经只读账号沙箱预执行校验） */
@Injectable()
export class VerifySqlService {
  private partitionCol(table: string): string | null {
    const cols = this.graph.columns.filter((c) => c.table_name === table).map((c) => c.column_name);
    return cols.find((c) => /data_dt|etl_dt/.test(c)) || null;
  }

  constructor(private readonly graph: GraphQueryService) {}

  build(params: VerifySqlParams = {}): VerifySqlItem[] {
    const { focusTables = [], date, prevDate, columns = [] } = params;
    const sqls: VerifySqlItem[] = [];
    for (const t of focusTables.slice(0, 3)) {
      const pc = this.partitionCol(t);
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
      const nullCols = columns.filter((c) => this.graph.columns.some((col) => col.table_name === t && col.column_name === c));
      if (nullCols.length) {
        sqls.push({
          purpose: `${t} 字段空值检查（${nullCols.join('/')}）`,
          sql: `SELECT COUNT(*) AS null_cnt FROM ${t} WHERE ${pc || '1=1'}${pc ? `='${date}' AND` : ''} ${nullCols.map((c) => `${c} IS NULL`).join(' OR ')};`,
        });
      }
    }
    return sqls.slice(0, 4);
  }
}