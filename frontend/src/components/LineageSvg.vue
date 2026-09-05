<template>
  <div class="svg-block">
    <div class="legend">
      <span class="lg"><i class="sw sw-job"></i>调度作业（箭头 = 依赖）</span>
      <span class="lg"><i class="sw sw-tbl"></i>表级血缘（箭头 = 数据流）</span>
      <span class="lg"><i class="sw sw-link"></i>作业加工产出表</span>
    </div>
    <div class="svg-wrap" ref="wrapEl" v-html="svg"></div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({ graph: { type: Object, required: true } });

/** 图形常量（SVG 用户坐标，非布局尺寸） */
const COLS = 5;          // ODS / DIM / DWD / DWS / ADS
const PAD = 16;          // 左右留白
const GAP = 32;          // 层间通道（走连线）
const MIN_BOX = 150;     // 节点最小宽度，低于此值改为横向滚动
const MAX_FS = 11.5;     // 节点文字最大字号

/** 容器宽度 -> 节点宽度：用 ResizeObserver 跟随，容器够宽时铺满，过窄时保底并横滚 */
const wrapEl = ref(null);
const boxW = ref(200);
let ro = null;

onMounted(() => {
  if (!wrapEl.value || typeof ResizeObserver === 'undefined') return;
  ro = new ResizeObserver(entries => {
    const w = entries[0]?.contentRect?.width;
    if (!w) return;
    boxW.value = Math.max(MIN_BOX, (w - PAD * 2 - GAP * (COLS - 1)) / COLS);
  });
  ro.observe(wrapEl.value);
});
onBeforeUnmount(() => ro?.disconnect());

/** 等宽字体下按节点宽度反推字号，长表名自动缩小而不溢出 */
const fitFont = (text, box) => {
  const need = Math.max(1, String(text).length * 0.6);
  return Math.max(8.5, Math.min(MAX_FS, (box - 12) / need));
};

/** 按数仓分层布局：上层调度作业（蓝），下层表血缘（绿），灰虚线=作业加工产出表 */
const svg = computed(() => {
  const g = props.graph;
  if (!g) return '';
  const escX = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const layers = ['ODS', 'DIM', 'DWD', 'DWS', 'ADS'];
  const bw = boxW.value;
  const colX = i => PAD + i * (bw + GAP);
  const W = PAD * 2 + bw * COLS + GAP * (COLS - 1);

  const pos = {};
  const jobsBy = {}, tablesBy = {};
  g.jobs.forEach(j => (jobsBy[j.layer] = jobsBy[j.layer] || []).push(j));
  g.tables.forEach(t => (tablesBy[t.layer] = tablesBy[t.layer] || []).push(t));

  layers.forEach((L, i) => {
    (jobsBy[L] || []).forEach((j, k) => (pos['j:' + j.name] = { x: colX(i), y: 34 + k * 48, w: bw, h: 38, kind: 'j', text: j.name, desc: `${j.desc}（${j.schedule}）` }));
    (tablesBy[L] || []).forEach((t, k) => (pos['t:' + t.name] = { x: colX(i), y: 260 + k * 46, w: bw, h: 34, kind: 't', text: t.name, desc: t.comment }));
  });

  const edge = (a, b, color, dash, fromRight) => {
    if (!fromRight) {
      const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
      const my = (a.y + a.h + b.y) / 2;
      return `<path d="M ${ax} ${a.y + a.h} C ${ax} ${my}, ${bx} ${my}, ${bx} ${b.y}" fill="none" stroke="${color}" stroke-width="1.4" ${dash ? 'stroke-dasharray="4,3"' : ''} marker-end="url(#arw)" opacity="0.65"><title>${escX(a.desc || '')} → ${escX(b.desc || '')}</title></path>`;
    }
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="1.4" ${dash ? 'stroke-dasharray="4,3"' : ''} marker-end="url(#arw)" opacity="0.65"><title>${escX(a.desc || '')} → ${escX(b.desc || '')}</title></path>`;
  };

  let edges = '';
  g.jobDeps.forEach(d => {
    const a = pos['j:' + d.depends_on], b = pos['j:' + d.job_name];
    if (a && b) edges += edge(a, b, '#2563eb', false, true);
  });
  g.tlineage.forEach(e => {
    const a = pos['t:' + e.src], b = pos['t:' + e.tgt];
    if (a && b) edges += edge(a, b, '#059669', false, true).replace('url(#arw)', 'url(#arwg)');
  });
  g.tlineage.forEach(e => {
    const j = pos['j:' + e.job], t = pos['t:' + e.tgt], s = pos['t:' + e.src];
    if (j && t) edges += edge(j, t, '#94a3b8', true, false);
    if (s && j) edges += edge(s, j, '#cbd5e1', true, false);
  });

  const tBottom = Math.max(...Object.values(pos).filter(p => p.kind === 't').map(p => p.y + p.h));
  const H = (isFinite(tBottom) ? tBottom : 260) + 20;

  const box = k => {
    const p = pos[k];
    const fs = fitFont(p.text, bw).toFixed(1);
    const fill = p.kind === 'j' ? '#eff6ff' : '#ecfdf5';
    const stroke = p.kind === 'j' ? '#3b82f6' : '#10b981';
    const ink = p.kind === 'j' ? '#1e40af' : '#065f46';
    return `<g><title>${escX(p.desc || '')}</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/><text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + 4}" text-anchor="middle" font-size="${fs}" fill="${ink}" font-family="Consolas,monospace">${escX(p.text)}</text></g>`;
  };

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="血缘与作业链路关系图">
    <defs>
      <marker id="arw" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#2563eb"/></marker>
      <marker id="arwg" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#059669"/></marker>
    </defs>
    ${layers.map((L, i) => `<text x="${colX(i) + bw / 2}" y="20" text-anchor="middle" font-size="12" font-weight="bold" fill="#94a3b8">${L}</text>`).join('')}
    ${edges}${Object.keys(pos).map(box).join('')}
  </svg>`;
});
</script>

<style scoped>
.svg-block { display: flex; flex-direction: column; gap: var(--sp-3); }
.svg-wrap { overflow-x: auto; }

.legend {
  display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4);
  font-size: var(--fs-cap); color: var(--ink-muted);
}
.lg { display: inline-flex; align-items: center; gap: var(--sp-2); }
.sw { width: 0.875rem; height: 0.625rem; border-radius: 0.1875rem; flex: none; }
.sw-job { background: #eff6ff; border: 1px solid #3b82f6; }
.sw-tbl { background: #ecfdf5; border: 1px solid #10b981; }
.sw-link { background: transparent; border: 1px dashed #94a3b8; }
</style>
