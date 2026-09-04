<template>
  <div v-if="loaded">
    <div class="panel">
      <h3>🧭 三大关联能力是什么</h3>
      <div class="concept-grid">
        <el-card class="concept" shadow="never">
          <div class="body"><b>🔗 血缘关联（表级血缘）</b><br>
            解析存储过程 SQL 得到"源表 → 加工 → 目标表"的依赖关系网。<br>
            <b>回答的问题：</b>这张表的数据从哪来、被哪些下游用？<br>
            <b>功能体现：</b>数据异常时，把单表问题放大为整条数据链的逐层核查路径，并支撑"改一张表影响哪些报表"的影响分析。</div>
        </el-card>
        <el-card class="concept" shadow="never">
          <div class="body"><b>⛓ 作业链路（调度 DAG）</b><br>
            从调度系统采集作业间依赖，形成跑批执行顺序图。<br>
            <b>回答的问题：</b>作业失败根因在哪一级、下游哪些作业被连带？<br>
            <b>功能体现：</b>失败作业向上回溯根因，向下评估级联影响（哪些作业被跳过、哪些表没产出），并生成按序重跑清单。</div>
        </el-card>
        <el-card class="concept" shadow="never">
          <div class="body"><b>📚 案例关联（工单/案例库）</b><br>
            历史工单与已解决问题沉淀为结构化案例，按<b>错误码 + 关联作业 + 关联表</b>三重加权检索。<br>
            <b>回答的问题：</b>以前谁遇到过类似问题、怎么解决的？<br>
            <b>功能体现：</b>把个人经验变成团队资产；用户反馈确认后自动沉淀新案例，越用越准。</div>
        </el-card>
      </div>
    </div>

    <div class="panel">
      <h3>🗺 血缘 × 链路关系图（当前知识库真实数据）</h3>
      <div class="hint">上层为调度作业链路（蓝，箭头=依赖："被指向者依赖指向者"），下层为表级血缘（绿，箭头=数据流："源表 → 目标表"），灰色虚线=作业加工产出表。悬停可查看说明。</div>
      <LineageSvg :graph="graph" />
    </div>

    <div class="panel">
      <h3>🎯 关联分析真实演示（基于知识库当前数据）</h3>
      <el-card v-for="d in demoCards" :key="d.title" shadow="never" style="margin-top:10px">
        <template #header>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b>{{ d.title }}</b>
            <el-button size="small" type="primary" plain @click="tryInput(d.try)">▶ 试一试</el-button>
          </div>
        </template>
        <div class="body"><b>场景：</b>{{ d.scenario }}<br><b>关联过程：</b></div>
        <ul class="plain"><li v-for="(s, i) in d.steps" :key="i">{{ s }}</li></ul>
        <div class="body"><b>怎么用：</b>{{ d.usage }}</div>
      </el-card>
    </div>
  </div>
  <div v-else class="panel"><el-skeleton :rows="8" animated /></div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api, tryInput } from '../store';
import LineageSvg from './LineageSvg.vue';

const graph = ref(null);
const demoCards = ref([]);
const loaded = ref(false);

onMounted(async () => {
  const [g, d] = await Promise.all([api('/api/graph'), api('/api/demos')]);
  graph.value = g;
  demoCards.value = [d.lineageDemo, d.chainDemo, d.caseDemo];
  loaded.value = true;
});
</script>

<style scoped>
.body { font-size: 13px; line-height: 1.75; }
.body b { color: #374151; }
</style>
