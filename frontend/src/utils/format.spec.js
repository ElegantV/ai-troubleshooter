import { describe, expect, it } from 'vitest';
import { fmtTime } from './format';

describe('fmtTime（ISO → 展示）', () => {
  it('截取到秒并替换 T', () => {
    expect(fmtTime('2026-09-08T10:20:30.123Z')).toBe('2026-09-08 10:20:30');
  });

  it('空值安全', () => {
    expect(fmtTime('')).toBe('');
    expect(fmtTime(null)).toBe('');
    expect(fmtTime(undefined)).toBe('');
  });
});