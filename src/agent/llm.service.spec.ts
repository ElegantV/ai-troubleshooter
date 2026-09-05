import { describe, expect, it } from 'vitest';
import { parseLlmJson } from './llm.service';

describe('LLM 结构化输出解析', () => {
  it('解析纯 JSON', () => {
    const r = parseLlmJson(
      '{"llmSummary":"根因是维表未刷新","topCause":"dim_cust 刷新失败","confidence":"高","evidenceRefs":["日志佐证"],"verifySql":["SELECT 1"],"steps":["重跑"]}',
    );
    expect(r.topCause).toBe('dim_cust 刷新失败');
    expect(r.confidence).toBe('高');
    expect(r.evidenceRefs).toEqual(['日志佐证']);
    expect(r.verifySql).toEqual(['SELECT 1']);
    expect(r.steps).toEqual(['重跑']);
  });

  it('容忍 markdown 代码块包裹', () => {
    const r = parseLlmJson('```json\n{"topCause":"A","confidence":"中"}\n```');
    expect(r.topCause).toBe('A');
    expect(r.confidence).toBe('中');
  });

  it('容忍前后多余文字并抽取首个 JSON 对象', () => {
    const r = parseLlmJson('好的，分析如下：\n{"topCause":"B","steps":["s1","s2"]}\n希望对你有帮助');
    expect(r.topCause).toBe('B');
    expect(r.steps).toEqual(['s1', 's2']);
  });

  it('解析失败降级为纯文本摘要', () => {
    const r = parseLlmJson('模型没有按格式输出的一段文字');
    expect(r.llmSummary).toContain('模型没有按格式');
    expect(r.topCause).toContain('模型没有按格式');
    expect(r.confidence).toBe('');
  });

  it('confidence 中英文归一化', () => {
    expect(parseLlmJson('{"confidence":"high"}').confidence).toBe('高');
    expect(parseLlmJson('{"confidence":"low"}').confidence).toBe('低');
    expect(parseLlmJson('{"confidence":"未知"}').confidence).toBe('');
  });

  it('字段缺失/类型异常不抛错', () => {
    const r = parseLlmJson('{"topCause":123,"evidenceRefs":"not-array","verifySql":null}');
    expect(r.topCause).toBe('123');
    expect(r.evidenceRefs).toEqual([]);
    expect(r.verifySql).toEqual([]);
  });
});