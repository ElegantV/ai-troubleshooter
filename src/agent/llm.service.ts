import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmAnalysisContext {
  input: string;
  date: string | null;
  route: string;
  entities: string;
  ruleCandidates: Array<{ title: string; score: number; confidence: string; evidence: string[] }>;
  cases: Array<{ id: string; kind: string; symptom: string; rootCause: string; solution: string }>;
  structures: Array<{ name: string; comment: string; columns: string[] }>;
  jobStatus: string[];
}

export interface LlmAnalysisResult {
  llmSummary: string;
  topCause: string;
  confidence: string;
  evidenceRefs: string[];
  verifySql: string[];
  steps: string[];
}

/** LLM 重试策略：最多 3 次尝试，退避基数 1s（1s → 2s → 4s） */
const LLM_MAX_ATTEMPTS = 3;
const LLM_RETRY_BASE_MS = 1000;
const LLM_RETRY_MAX_MS = 4000;

/** 4xx 为永久性错误（密钥无效/模型不存在/上下文超限），重试无意义 */
function isPermanentLlmError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && Number((e as { status?: unknown }).status) >= 400 && Number((e as { status?: unknown }).status) < 500;
}

const SYSTEM_PROMPT = `你是数据仓库运维专家，负责对批量作业失败与数据异常给出可解释、可审计的分析。
下面给出的【知识库上下文】全部来自真实系统数据（规则引擎候选原因、历史工单/案例、表结构、作业状态）。你必须严格基于这些事实分析，不得编造上下文之外的内容。
输出要求：只输出一个 JSON 对象（不要 markdown 代码块，不要任何多余文字），字段如下：
{
  "llmSummary": "一句话总结最可能根因",
  "topCause": "最可能根因的完整描述（引用具体证据）",
  "confidence": "高 或 中 或 低",
  "evidenceRefs": ["依据1", "依据2", "依据3"],
  "verifySql": ["建议在数据库执行的只读验证SQL，1到3条"],
  "steps": ["处置步骤1", "处置步骤2"]
}`;

/** 归一化 LLM 返回，容忍字段缺失/类型偏差（模型输出不可完全信任） */
function normalize(obj: Record<string, unknown> | null): LlmAnalysisResult {
  const str = (v: unknown) => String(v ?? '').trim();
  const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : []);
  const conf = str(obj?.confidence);
  const confidence = ['高', '中', '低'].includes(conf)
    ? conf
    : conf === 'high'
      ? '高'
      : conf === 'medium'
        ? '中'
        : conf === 'low'
          ? '低'
          : '';
  return {
    llmSummary: str(obj?.llmSummary || obj?.topCause).slice(0, 500),
    topCause: str(obj?.topCause || obj?.llmSummary).slice(0, 800),
    confidence,
    evidenceRefs: arr(obj?.evidenceRefs, 8),
    verifySql: arr(obj?.verifySql, 4),
    steps: arr(obj?.steps, 10),
  };
}

/** 解析 LLM 返回的 JSON：容忍 markdown 代码块、多余前后文；解析失败则降级为纯文本摘要 */
export function parseLlmJson(content: string): LlmAnalysisResult {
  const text = content.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fence ? fence[1].trim() : text;
  try {
    return normalize(JSON.parse(candidate) as Record<string, unknown>);
  } catch {
    const m = /{[\s\S]*}/.exec(candidate);
    if (m) {
      try {
        return normalize(JSON.parse(m[0]) as Record<string, unknown>);
      } catch {
        /* fallthrough */
      }
    }
  }
  return { llmSummary: text.slice(0, 500), topCause: text.slice(0, 800), confidence: '', evidenceRefs: [], verifySql: [], steps: [] };
}

/**
 * LLM 适配层（默认关闭，规则引擎为骨架）：接入后作为「增强」而非「依赖」，
 * 故障可降级为纯规则结果。OpenAI 兼容端点（行内网关 / 微信 chatapi / 智谱 GLM / Ollama）。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly llm: AppConfig['llm'];

  constructor(cfg: ConfigService) {
    this.llm = cfg.get<AppConfig>('app')!.llm;
  }

  get enabled(): boolean {
    return this.llm.enabled;
  }

  async chat(messages: ChatMessage[], temperature = 0.2): Promise<string | null> {
    if (!this.llm.enabled || !this.llm.baseUrl) return null;
    // 瞬时故障（网络/超时/5xx）指数退避重试；4xx 为永久性错误不重试
    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.chatOnce(messages, temperature);
      } catch (e) {
        lastErr = e as Error;
        if (isPermanentLlmError(e)) {
          this.logger.warn(`LLM 永久性错误，放弃重试：${lastErr.message}`);
          break;
        }
        if (attempt < LLM_MAX_ATTEMPTS) {
          const delay = Math.min(LLM_RETRY_BASE_MS * 2 ** (attempt - 1), LLM_RETRY_MAX_MS);
          this.logger.warn(`LLM 请求失败（第 ${attempt}/${LLM_MAX_ATTEMPTS} 次），${delay}ms 后重试：${lastErr.message}`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  private async chatOnce(messages: ChatMessage[], temperature = 0.2): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.llm.timeoutMs);
    try {
      const resp = await fetch(`${this.llm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.llm.apiKey}` },
        body: JSON.stringify({ model: this.llm.model, messages, temperature }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const err = new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 500)}`) as Error & { status?: number };
        err.status = resp.status;
        throw err;
      }
      const data = await resp.json();
      return data.choices?.[0]?.message?.content ?? null;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error(`LLM 请求超时（${this.llm.timeoutMs}ms）`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 综合分析：基于【知识库上下文】（规则候选 + 命中案例 + 表结构 + 作业状态）让 LLM 分析。
   * 返回结构化结论；解析失败返回 null（调用方降级为纯规则报告）。
   */
  async analyzeWithContext(ctx: LlmAnalysisContext): Promise<LlmAnalysisResult | null> {
    if (!this.enabled) return null;
    const content = await this.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `用户问题与知识库上下文：\n${JSON.stringify(ctx, null, 2)}` },
      ],
      0.3,
    );
    if (!content) return null;
    return parseLlmJson(content);
  }
}