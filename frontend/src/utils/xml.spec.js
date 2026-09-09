import { describe, expect, it } from 'vitest';
import { escapeXml } from './xml';

describe('escapeXml（SVG v-html 注入点转义）', () => {
  it('转义全部 5 个关键字符', () => {
    expect(escapeXml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('null/undefined 空安全', () => {
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(undefined)).toBe('');
  });

  it('数字与正常文本原样输出', () => {
    expect(escapeXml(123)).toBe('123');
    expect(escapeXml('job_dwd_txnl_clean')).toBe('job_dwd_txnl_clean');
  });
});