import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { REDIS } from '../infra/redis/redis.module';

/** 验证码有效期与长度：5 分钟 / 4 位 */
const CAPTCHA_TTL_SEC = 5 * 60;
const CAPTCHA_LEN = 4;
/** 去掉易混淆字符：I L 1 O 0 */
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * 登录图形验证码：SVG 自绘（无第三方依赖，内网可用），Redis 一次性消费。
 * 校验通过即删除，同一验证码只能用一次；防机器人撞库，不做抗 OCR（内部工具威胁模型）。
 */
@Injectable()
export class CaptchaService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async create(): Promise<{ captcha_id: string; image: string }> {
    let code = '';
    for (let i = 0; i < CAPTCHA_LEN; i++) code += CHARS[crypto.randomInt(CHARS.length)];
    const id = crypto.randomBytes(12).toString('hex');
    // ioredis 懒连接：重启后首个请求会撞上连接未就绪，短重试覆盖预热窗口
    await this.retry(() => this.redis.set(`auth:captcha:${id}`, code.toLowerCase(), 'EX', CAPTCHA_TTL_SEC));
    return { captcha_id: id, image: `data:image/svg+xml;base64,${Buffer.from(this.renderSvg(code)).toString('base64')}` };
  }

  /** 校验并消费（幂等：无论对错，取过即失效）。Redis 不可用时 fail-closed：验证不了就不放行 */
  async verify(id: string, input: string): Promise<boolean> {
    if (!id || !input) return false;
    const key = `auth:captcha:${String(id)}`;
    const code = await this.retry(() => this.redis.get(key), 2, 100).catch(() => null);
    await this.redis.del(key).catch(() => null);
    return !!code && code === String(input).trim().toLowerCase();
  }

  private async retry<T>(fn: () => Promise<T>, attempts = 5, delayMs = 200): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (e) { last = e; await new Promise(r => setTimeout(r, delayMs)); }
    }
    throw last;
  }

  /** 4 字符 SVG：渐变底 + 柔和色块 + 波浪网格线，字符带阴影/描边/大角度旋转/轻微重叠，前景干扰曲线横穿文字 */
  private renderSvg(code: string): string {
    const w = 132, h = 44;
    const palette = ['#1e3a8a', '#2563eb', '#0f766e', '#b45309', '#6d28d9', '#be123c'];
    const pick = () => palette[crypto.randomInt(palette.length)];
    const gid = 'g' + crypto.randomBytes(4).toString('hex');
    const parts: string[] = [
      `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="#eef2f7"/><stop offset="1" stop-color="#d8e1ef"/></linearGradient></defs>`,
      `<rect width="${w}" height="${h}" fill="url(#${gid})"/>`,
    ];

    // 背景柔和色块
    for (let i = 0; i < 3; i++) {
      parts.push(`<ellipse cx="${crypto.randomInt(w)}" cy="${crypto.randomInt(h)}" rx="${crypto.randomInt(14, 30)}" ry="${crypto.randomInt(8, 16)}" fill="${pick()}" opacity="0.07"/>`);
    }
    // 波浪网格线（上中下三条，随机振幅）
    for (let i = 0; i < 3; i++) {
      const y = 8 + i * 14 + crypto.randomInt(-3, 3);
      const a = crypto.randomInt(3, 7);
      parts.push(`<path d="M0 ${y} Q ${w / 4} ${y - a} ${w / 2} ${y} T ${w} ${y}" fill="none" stroke="#64748b" stroke-opacity="0.22" stroke-width="1"/>`);
    }

    // 字符：底层灰色阴影 + 上层填色（部分用描边空心），大角度旋转、轻微重叠
    const step = (w - 34) / CAPTCHA_LEN;
    code.split('').forEach((ch, i) => {
      const x = 20 + step * i + crypto.randomInt(-2, 2);
      const y = h / 2 + 8 + crypto.randomInt(-3, 3);
      const rot = crypto.randomInt(-32, 32);
      const size = crypto.randomInt(25, 32);
      const color = pick();
      const common = `font-size="${size}" font-weight="700" font-family="Consolas, Menlo, monospace" transform="rotate(${rot} ${x} ${y})"`;
      parts.push(`<text x="${x + 1.5}" y="${y + 1.5}" ${common} fill="#334155" fill-opacity="0.35">${ch}</text>`);
      if (crypto.randomInt(2)) parts.push(`<text x="${x}" y="${y}" ${common} fill="${color}">${ch}</text>`);
      else parts.push(`<text x="${x}" y="${y}" ${common} fill="none" stroke="${color}" stroke-width="1.3">${ch}</text>`);
    });

    // 前景干扰曲线：横穿文字的两条贝塞尔
    for (let i = 0; i < 2; i++) {
      const y0 = crypto.randomInt(6, h - 6);
      parts.push(`<path d="M0 ${y0} C ${w * 0.3} ${crypto.randomInt(-10, h)}, ${w * 0.7} ${crypto.randomInt(-10, h)}, ${w} ${crypto.randomInt(4, h - 4)}" fill="none" stroke="${pick()}" stroke-opacity="0.45" stroke-width="1.8"/>`);
    }
    // 噪点
    for (let i = 0; i < 40; i++) {
      parts.push(`<circle cx="${crypto.randomInt(w)}" cy="${crypto.randomInt(h)}" r="${(crypto.randomInt(6, 14) / 10).toFixed(1)}" fill="${pick()}" fill-opacity="0.35"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
  }
}
