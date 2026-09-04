<template>
  <div class="wrap" v-if="auth.ready">
    <header>
      <div class="head-row">
        <div style="flex:1">
          <h1>🔍 AI 问题排查助手 <span class="ver">原型 v0.3 · Vue3 + Element Plus</span></h1>
          <div class="sub">面向数据异常与批量作业失败场景 · 血缘/链路/案例关联分析 · 规则归因（LLM 接口已预留）</div>
        </div>
        <div v-if="auth.user" class="who">
          👤 <b>{{ auth.user.display_name }}</b> · <el-link type="primary" @click="logout()">退出</el-link>
        </div>
      </div>
      <div class="chips" v-if="meta.data">
        <el-tag size="small" effect="plain">表 {{ meta.data.tables }} 张</el-tag>
        <el-tag size="small" effect="plain">作业 {{ meta.data.jobs }} 个</el-tag>
        <el-tag size="small" effect="plain">血缘边 {{ meta.data.lineageEdges }} 条</el-tag>
        <el-tag size="small" effect="plain">历史工单 {{ meta.data.tickets }} 条</el-tag>
        <el-tag size="small" effect="plain">案例 {{ meta.data.cases }} 条</el-tag>
        <el-tag size="small" effect="plain">最新跑批日 {{ meta.data.latestRunDate }}</el-tag>
        <el-tag v-for="j in meta.data.abnormalJobs" :key="j.job_name" type="danger" size="small" effect="plain">
          ⚠ {{ j.job_name }}: {{ j.final_status }}
        </el-tag>
      </div>
    </header>

    <el-tabs v-model="ui.activeTab">
      <el-tab-pane label="智能排查" name="trouble"><TroublePanel /></el-tab-pane>
      <el-tab-pane label="能力图示（血缘 / 链路 / 案例）" name="graph" lazy><GraphView /></el-tab-pane>
      <el-tab-pane label="案例库（录入 / 浏览）" name="cases" lazy><CasesView /></el-tab-pane>
      <el-tab-pane label="排查历史" name="queries" lazy><QueriesView /></el-tab-pane>
    </el-tabs>

    <div class="foot">知识来源：表级血缘 × 作业链路 × 跑批日志 × 历史工单/案例 · 验证 SQL 仅供人工只读执行 · 所有查询已审计留痕并归属操作人</div>
    <LoginDialog />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { auth, ui, initAuth, logout } from './store';
import LoginDialog from './components/LoginDialog.vue';
import TroublePanel from './components/TroublePanel.vue';
import GraphView from './components/GraphView.vue';
import CasesView from './components/CasesView.vue';
import QueriesView from './components/QueriesView.vue';

onMounted(initAuth);
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Microsoft YaHei", system-ui, sans-serif; background: #f0f4f8; color: #1f2937; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; }
header h1 { font-size: 22px; color: #1e3a8a; }
header .ver { font-size: 13px; color: #9ca3af; font-weight: normal; }
header .sub { color: #6b7280; font-size: 13px; margin-top: 4px; }
.head-row { display: flex; align-items: flex-start; gap: 12px; }
.who { font-size: 13px; color: #6b7280; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.chips { margin: 12px 0 4px; display: flex; flex-wrap: wrap; gap: 6px; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-top: 14px; }
h3 { font-size: 14px; color: #1e3a8a; margin: 18px 0 8px; }
.panel h3:first-child { margin-top: 0; }
ul.plain { list-style: none; }
ul.plain li { font-size: 13px; line-height: 1.7; padding: 3px 0 3px 14px; position: relative; }
ul.plain li::before { content: ""; position: absolute; left: 0; top: 12px; width: 6px; height: 6px; border-radius: 50%; background: #93c5fd; }
.cause { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
.cause .title { font-size: 13.5px; font-weight: 600; }
.cause .type { font-size: 11px; color: #6b7280; margin-top: 2px; }
.cause ul.plain li { color: #4b5563; }
pre.sql { background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; overflow-x: auto; line-height: 1.5; margin: 4px 0 10px; }
.sql-purpose { font-size: 12.5px; color: #334155; font-weight: 600; }
ol.steps { padding-left: 20px; } ol.steps li { font-size: 13.5px; line-height: 1.8; }
.src { font-size: 12px; color: #6b7280; margin-top: 6px; }
.examples { font-size: 12px; color: #6b7280; display: inline-flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.hint { font-size: 12px; color: #6b7280; margin-top: 10px; line-height: 1.7; }
.foot { margin-top: 20px; font-size: 11.5px; color: #9ca3af; text-align: center; line-height: 1.8; }
.concept-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
@media (max-width: 860px) { .concept-grid { grid-template-columns: 1fr; } }
.concept .body { font-size: 13px; line-height: 1.75; }
.concept .body b { color: #374151; }
</style>
