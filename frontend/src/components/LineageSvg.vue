<template>
  <div class="svg-wrap" v-html="svg"></div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ graph: { type: Object, required: true } });

/** 按数仓分层布局：上层调度作业（蓝），下层表血缘（绿），灰虚线=作业加工产出表 */
const svg = computed(() => {
  const g = props.graph;
  const escX = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const layers = ['ODS', 'DIM', 'DWD', 'DWS', 'ADS'];
  const colX = i => 40 + i * 246;
  const pos = {};
  const jobsBy = {}, tablesBy = {};
  g.jobs.forEach(j => (jobsBy[j.layer] = jobsBy[j.layer] || []).push(j));
  g.tables.forEach(t => (tablesBy[t.layer] = tablesBy[t.layer] || []).push(t));
  layers.forEach((L, i) => {
    (jobsBy[L] || []).forEach((j, k) => (pos['j:' + j.name] = { x: colX(i), y: 34 + k * 48, w: 200, h: 38, kind: 'j', desc: `${j.desc}（${j.schedule}）` }));
    (tablesBy[L] || []).forEach((t, k) => (pos['t:' + t.name] = { x: colX(i), y: 260 + k * 46, w: 200, h: 34, kind: 't', desc: t.comment }));
  });
  const edge = (a, b, color, dash, fromRight) => {
    if (!fromRight) {
      const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
      return `<path d="M ${ax} ${a.y + a.h} C ${ax} ${(a.y + a.h + b.y) / 2}, ${bx} ${(a.y + a.h + b.y) / 2}, ${bx} ${b.y}" fill="none" stroke="${color}" stroke-width="1.4" ${dash ? 'stroke-dasharray="4,3"' : ''} marker-end="url(#arw)" opacity="0.65"><title>${escX(a.desc || '')} → ${escX(b.desc || '')}</title></path>`;
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
  const W = 40 + 4 * 246 + 220;
  const tBottom = Math.max(...Object.values(pos).filter(p => p.kind === 't').map(p => p.y + p.h));
  const H = tBottom + 20;
  const box = k => {
    const p = pos[k];
    const label = escX(k.slice(2));
    return `<g><title>${escX(p.desc || '')}</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="7" fill="${p.kind === 'j' ? '#eff6ff' : '#ecfdf5'}" stroke="${p.kind === 'j' ? '#3b82f6' : '#10b981'}" stroke-width="1.4"/><text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + 4}" text-anchor="middle" font-size="11.5" fill="${p.kind === 'j' ? '#1e40af' : '#065f46'}" font-family="Consolas,monospace">${label}</text></g>`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" width="${Math.min(W, 1180)}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arw" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#2563eb"/></marker>
      <marker id="arwg" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#059669"/></marker>
    </defs>
    ${layers.map((L, i) => `<text x="${colX(i) + 100}" y="20" text-anchor="middle" font-size="12" font-weight="bold" fill="#94a3b8">${L}</text>`).join('')}
    ${edges}${Object.keys(pos).map(box).join('')}
  </svg>`;
});
</script>

<style scoped>
.svg-wrap { overflow-x: auto; }
</style>
