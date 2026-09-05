export interface ColumnMeta {
  column_name: string;
  data_type: string;
  nullable: string;
  comment: string;
}

export interface TableMeta {
  name: string;
  comment: string;
  cols: ColumnMeta[];
}

/** 解析 DDL 文件：CREATE TABLE 块 → 元数据表/列 */
export function parseDdl(sql: string): TableMeta[] {
  const tables: TableMeta[] = [];
  const blockRe = /CREATE\s+TABLE\s+([a-zA-Z_][\w]*)\s*\(([\s\S]*?)\)\s*COMMENT='([^']*)'/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(sql))) {
    const name = m[1].toLowerCase();
    const comment = m[3];
    const cols: ColumnMeta[] = [];
    const body = m[2];
    const colRe = /([a-zA-Z_][\w]*)\s+([A-Z]+(?:\(\d+(?:,\d+)?\))?)\s*(NOT NULL)?\s*(?:COMMENT\s+'([^']*)')?/gi;
    const lines = body.split(/,\s*\n/);
    for (const line of lines) {
      const l = line.trim();
      if (!l || /^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN)/i.test(l)) continue;
      const cm = /^([a-zA-Z_][\w]*)\s+([A-Z]+(?:\(\d+(?:,\d+)?\))?)[^']*?(?:COMMENT\s+'([^']*)')?\s*(NOT NULL)?\s*$/i.exec(l);
      if (cm) {
        cols.push({
          column_name: cm[1].toLowerCase(),
          data_type: cm[2].toUpperCase(),
          nullable: cm[4] ? 'N' : 'Y',
          comment: (cm[3] || '').replace(/；.*$/, ''),
        });
      }
    }
    // 主键列视为非空（供静态风险分析使用）
    const pk = /primary\s+key\s*\(([^)]*)\)/i.exec(body);
    if (pk) {
      for (const c of pk[1].split(',')) {
        const col = cols.find((x) => x.column_name === c.trim().toLowerCase());
        if (col) col.nullable = 'N';
      }
    }
    tables.push({ name, comment, cols });
  }
  return tables;
}