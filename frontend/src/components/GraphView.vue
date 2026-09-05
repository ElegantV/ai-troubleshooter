<template>
  <div v-if="loaded">
    <div class="panel">
      <h3><el-icon class="h3-ico"><Compass /></el-icon>三大关联能力是什么</h3>
      <div class="panel-sub">血缘关联 / 作业链路 / 案例关联，一图看懂</div>
      <div class="concept-grid">
        <el-card v-for="c in concepts" :key="c.name" class="concept" shadow="never">
          <template #header>
            <div class="concept-head">
              <el-icon class="concept-ico"><component :is="c.icon" /></el-icon>
              <b>{{ c.name }}</b>
              <span class="concept-tag">{{ c.tag }}</span>
            </div>
          </template>
          <p class="concept-desc">{{ c.desc }}</p>
          <div class="kv">
            <span class="k">回答</span>
            <p>{{ c.answers }}</p>
          </div>
          <div class="kv">
            <span class="k">体现</span>
            <p>{{ c.value }}</p>
          </div>
        </el-card>
      </div>
    </div>

    <div class="panel">
      <h3><el-icon class="h3-ico"><TrendCharts /></el-icon>血缘 × 链路关系图（当前知识库真实数据）</h3>
      <div class="panel-sub">上层调度作业链路、下层表级血缘，悬停节点查看说明；宽度不足时可横向滚动</div>
      <LineageSvg :graph="graph" />
    </div>

    <div class="panel">
      <h3><el-icon class="h3-ico"><Aim /></el-icon>关联分析真实演示（基于知识库当前数据）</h3>
      <div class="panel-sub">点击「试一试」可把场景直接带入智能排查</div>
      <el-card v-for="d in demoCards" :key="d.title" shadow="never" class="demo-card">
        <template #header>
          <div class="demo-head">
            <b>{{ d.title }}</b>
            <el-button size="small" type="primary" plain :icon="VideoPlay" @click="tryInput(d.try)">试一试</el-button>
          </div>
        </template>
        <div class="kv">
          <span class="k">场景</span>
          <p>{{ d.scenario }}</p>
        </div>
        <div class="kv">
          <span class="k">关联过程</span>
          <ol class="steps"><li v-for="(s, i) in d.steps" :key="i">{{ s }}</li></ol>
        </div>
        <div class="kv">
          <span class="k">怎么用</span>
          <p>{{ d.usage }}</p>
        </div>
      </el-card>
    </div>
  </div>
  <div v-else class="panel"><el-skeleton :rows="8" animated /></div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Compass, Connection, Link, Collection, TrendCharts, Aim, VideoPlay } from '@element-plus/icons-vue';
import { api, tryInput } from '../store';
import LineageSvg from './LineageSvg.vue';

const graph = ref(null);
const demoCards = ref([]);
const loaded = ref(false);

/** 概念卡改为结构化字段，不再用 <br> 堆砌 */
const concepts = [
  {
    icon: Connection, name: '血缘关联', tag: '表级血缘',
    desc: '解析存储过程 SQL，得到「源表 → 加工 → 目标表」的依赖关系网。',
    answers: '这张表的数据从哪来、被哪些下游用？',
    value: '数据异常时把单表问题放大为整条数据链的逐层核查路径，并支撑「改一张表影响哪些报表」的影响分析。',
  },
  {
    icon: Link, name: '作业链路', tag: '调度 DAG',
    desc: '从调度系统采集作业间依赖，形成跑批执行顺序图。',
    answers: '作业失败根因在哪一级、下游哪些作业被连带？',
    value: '失败作业向上回溯根因，向下评估级联影响（哪些作业被跳过、哪些表没产出），并生成按序重跑清单。',
  },
  {
    icon: Collection, name: '案例关联', tag: '工单 / 案例库',
    desc: '历史工单与已解决问题沉淀为结构化案例，按错误码 + 关联作业 + 关联表三重加权检索。',
    answers: '以前谁遇到过类似问题、怎么解决的？',
    value: '把个人经验变成团队资产；用户反馈确认后自动沉淀新案例，越用越准。',
  },
];

onMounted(async () => {
  const [g, d] = await Promise.all([api('/graph'), api('/demos')]);
  graph.value = g;
  demoCards.value = [d.lineageDemo, d.chainDemo, d.caseDemo];
  loaded.value = true;
});
</script>

<style scoped>
.h3-ico { font-size: 1rem; }

/* ---- 概念卡 ---- */
.concept-head {
  display: flex; align-items: center; gap: var(--sp-2);
  flex-wrap: wrap; font-size: var(--fs-strong);
}
.concept-ico { font-size: 0.875rem; color: var(--el-color-primary); flex: none; }
.concept-tag {
  font-size: var(--fs-cap); color: var(--ink-muted);
  background: var(--surface-sunken); border: 1px solid var(--line);
  border-radius: var(--r-pill); padding: 0 var(--sp-2);
  margin-left: auto;
}
.concept-desc {
  font-size: var(--fs-body); line-height: 1.75; color: var(--ink-3);
  margin-bottom: var(--sp-3);
}

/* ---- 键值对行（概念卡 / 演示卡共用） ---- */
.kv {
  display: grid; grid-template-columns: auto 1fr;
  gap: var(--sp-1) var(--sp-3); align-items: start;
  margin-top: var(--sp-2);
  font-size: var(--fs-body); line-height: 1.75;
}
.kv .k {
  color: var(--ink-faint); font-size: var(--fs-cap);
  padding-top: 0.125rem; white-space: nowrap;
}
.kv p { color: var(--ink-2); min-width: 0; overflow-wrap: anywhere; }
.kv ol.steps { padding-left: 1.25em; margin-top: 0; }
.kv ol.steps li { font-size: var(--fs-body); line-height: 1.75; color: var(--ink-2); }

/* ---- 演示卡 ---- */
.demo-card { margin-top: var(--gap-panel); border-radius: var(--r-lg); }
.demo-head {
  display: flex; justify-content: space-between; align-items: center;
  gap: var(--sp-2); flex-wrap: wrap;
}

@media (max-width: 45rem) {
  .kv { grid-template-columns: 1fr; gap: 0; }
  .kv .k { padding-top: 0; }
}
</style>
