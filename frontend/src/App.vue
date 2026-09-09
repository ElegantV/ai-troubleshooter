<template>
  <!-- 未登录（含退出/会话过期）显示独立登录页；ready 之前先不渲染避免闪屏 -->
  <LoginView v-if="auth.ready && !auth.user" />
  <div class="wrap" v-else-if="auth.ready">
    <header class="hero">
      <div class="hero-inner">
        <div class="brand">
          <div class="brand-icon"><img class="brand-ico" src="/favicon.svg" alt="" /></div>
          <div class="brand-text">
            <h1>AI 问题排查助手 <span class="ver">v0.4</span></h1>
            <div class="sub">面向数据异常与批量作业失败 · 血缘 / 链路 / 案例关联分析 · 规则归因（可解释可审计）</div>
          </div>
        </div>
        <div v-if="auth.user" class="who">
          <span class="who-avatar">{{ (auth.user.display_name || auth.user.username).slice(0, 1) }}</span>
          <b>{{ auth.user.display_name }}</b>
          <span class="who-role">{{ auth.user.role === 'admin' ? '管理员' : '成员' }}</span>
          <span v-if="auth.user.system_code" class="who-sys">
            <el-icon class="who-ico"><PriceTag /></el-icon>{{ auth.user.system_code }}
          </span>
          <el-link class="who-logout" @click="profileOpen = true">资料</el-link>
          <el-link class="who-logout" @click="confirmLogout()">退出</el-link>
        </div>
      </div>
      <div class="stats" v-if="meta.data">
        <div class="stat">
          <b>{{ meta.data.tables }}</b
          ><span>表</span>
        </div>
        <div class="stat">
          <b>{{ meta.data.jobs }}</b
          ><span>作业</span>
        </div>
        <div class="stat">
          <b>{{ meta.data.lineageEdges }}</b
          ><span>血缘边</span>
        </div>
        <div class="stat">
          <b>{{ meta.data.tickets }}</b
          ><span>历史工单</span>
        </div>
        <div class="stat">
          <b>{{ meta.data.cases }}</b
          ><span>案例</span>
        </div>
        <div class="stat stat-date">
          <b>{{ meta.data.latestRunDate }}</b
          ><span>最新跑批日</span>
        </div>
      </div>
      <div class="alerts" v-if="meta.data && meta.data.abnormalJobs.length">
        <button class="alerts-toggle" :class="{ open: alertsOpen }" :aria-expanded="alertsOpen" @click="alertsOpen = !alertsOpen">
          <el-icon class="alerts-ico"><Warning /></el-icon>
          <span>{{ meta.data.abnormalJobs.length }} 个异常作业</span>
          <el-icon class="alerts-chev"><ArrowDown /></el-icon>
        </button>
        <div class="alerts-list" v-if="alertsOpen">
          <span v-for="j in meta.data.abnormalJobs" :key="j.job_name" class="alerts-item"
            >{{ j.job_name }} · {{ j.final_status }}</span
          >
        </div>
      </div>
    </header>

    <main class="main">
      <!--
        列表类视图用 v-if 挂载：切走即销毁，回来重建并重新拉数据
        （el-tabs 的 lazy + destroy-on-close 组合对已激活过的 pane 不生效，pane 会永久驻留 DOM）。
        智能排查 tab 保留实例，避免切走后丢失已生成的报告。
      -->
      <el-tabs v-model="ui.activeTab" class="main-tabs">
        <el-tab-pane label="智能排查" name="trouble"><TroublePanel /></el-tab-pane>
        <el-tab-pane label="能力图示" name="graph" lazy><GraphView v-if="ui.activeTab === 'graph'" /></el-tab-pane>
        <el-tab-pane label="案例库" name="cases" lazy><CasesView v-if="ui.activeTab === 'cases'" /></el-tab-pane>
        <el-tab-pane label="排查历史" name="queries" lazy
          ><QueriesView v-if="ui.activeTab === 'queries'"
        /></el-tab-pane>
      </el-tabs>
    </main>

    <footer class="foot">
      知识来源：表级血缘 × 作业链路 × 跑批日志 × 历史工单/案例 · 验证 SQL 仅供人工只读执行 ·
      所有查询已审计留痕并归属操作人
    </footer>

    <ProfileDialog v-model="profileOpen" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { Warning, ArrowDown, PriceTag } from '@element-plus/icons-vue';
import { auth, ui, meta, initAuth, logout } from './store';
import LoginView from './views/LoginView.vue';
import ProfileDialog from './components/ProfileDialog.vue';
import TroublePanel from './components/TroublePanel.vue';
import GraphView from './components/GraphView.vue';
import CasesView from './components/CasesView.vue';
import QueriesView from './components/QueriesView.vue';

const alertsOpen = ref(false);
const profileOpen = ref(false);
onMounted(initAuth);

async function confirmLogout() {
  try {
    await ElMessageBox.confirm('退出后需要重新登录，确认退出？', '确认退出', {
      type: 'warning',
      confirmButtonText: '退出',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  logout();
}
</script>

<style>
/* ============================================================
   设计令牌：全部基于 rem / clamp，无硬编码布局像素
   （1rem = 16px 为基准；仅 hairline 边框与图标微调保留 px）
   ============================================================ */
:root {
  /* ---- Element Plus 主题（企业蓝） ---- */
  --el-color-primary: #2563eb;
  --el-color-primary-light-3: #5b8def;
  --el-color-primary-light-5: #8fb0f4;
  --el-color-primary-light-7: #bcd0f8;
  --el-color-primary-light-8: #d4e0fb;
  --el-color-primary-light-9: #edf2fe;
  --el-color-primary-dark-2: #1e4fd6;
  --el-color-success: #059669;
  --el-color-warning: #d97706;
  --el-color-danger: #dc2626;

  /* ---- 字号：流式（随视口在上下限之间平滑变化） ---- */
  --fs-cap: 0.75rem; /* 12  元信息 / 角标 */
  --fs-body: 0.8125rem; /* 13  正文 */
  --fs-strong: 0.875rem; /* 14  小标题 */
  --fs-title: 0.9375rem; /* 15  区块标题 */
  --fs-lead: clamp(1rem, 0.93rem + 0.35vw, 1.25rem); /* 16→20 结论正文 */
  --fs-h1: clamp(1.125rem, 1rem + 0.7vw, 1.5rem); /* 18→24 主标题 */
  --fs-stat: clamp(1.25rem, 1.05rem + 1vw, 1.75rem); /* 20→28 统计数字 */

  /* ---- 间距：0.25rem 基准阶梯 ---- */
  --sp-1: 0.25rem;
  --sp-2: 0.5rem;
  --sp-3: 0.75rem;
  --sp-4: 1rem;
  --sp-5: 1.25rem;
  --sp-6: 1.5rem;
  --sp-8: 2rem;
  --sp-10: 2.5rem;
  --sp-12: 3rem;

  /* ---- 容器与区块：流式内边距 ---- */
  --wrap-max: 70rem; /* 1120 */
  --pad-page-x: clamp(1rem, 0.4rem + 2.4vw, 1.75rem);
  --pad-page-t: clamp(1rem, 0.6rem + 1.6vw, 1.75rem);
  --pad-page-b: clamp(2rem, 1.4rem + 2.4vw, 3.5rem);
  --pad-panel: clamp(0.875rem, 0.6rem + 1.1vw, 1.375rem);
  --pad-hero: clamp(1.125rem, 0.85rem + 1.1vw, 1.625rem);
  --gap-panel: clamp(0.625rem, 0.45rem + 0.7vw, 1rem);
  --gap-grid: clamp(0.625rem, 0.45rem + 0.7vw, 1rem);

  /* ---- 圆角 ---- */
  --r-sm: 0.375rem;
  --r-md: 0.5rem;
  --r-lg: 0.625rem;
  --r-xl: 0.875rem;
  --r-2xl: 1.125rem;
  --r-pill: 62.5rem;

  /* ---- 表面与描边（外白内灰，形成层次） ---- */
  --surface: #ffffff;
  --surface-sunken: #f8fafc;
  --surface-hover: #f1f5f9;
  --line: #e5e7eb;
  --line-soft: #eef2f7;
  --ink: #1f2937;
  --ink-2: #374151;
  --ink-3: #4b5563;
  --ink-muted: #6b7280;
  --ink-faint: #94a3b8;
  --brand-deep: #1e3a8a;

  /* Element Plus 跟随令牌 */
  --el-border-radius-base: var(--r-md);
  --el-border-radius-small: var(--r-sm);
  --el-font-size-base: var(--fs-strong);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif;
  font-size: var(--fs-body); /* 定基准，避免未声明字号的元素掉回 16px */
  line-height: 1.6;
  background: linear-gradient(180deg, #f8fafc 0%, #edf1f7 100%);
  background-attachment: fixed; /* 长页面下渐变不随内容拉伸 */
  min-height: 100vh;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 0.5rem;
  height: 0.5rem;
}
::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 0.25rem;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--ink-faint);
}

.wrap {
  max-width: var(--wrap-max);
  margin-inline: auto;
  padding: var(--pad-page-t) var(--pad-page-x) var(--pad-page-b);
}

/* ============================================================
   顶部 Hero
   ============================================================ */
.hero {
  background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
  border-radius: var(--r-2xl);
  padding: var(--pad-hero);
  color: #fff;
  box-shadow: 0 0.625rem 1.875rem -0.75rem rgba(37, 99, 235, 0.45);
}
.hero-inner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--sp-4);
  flex-wrap: wrap;
}
.brand {
  display: flex;
  gap: var(--sp-3);
  align-items: flex-start;
  min-width: 0;
  flex: 1 1 18rem;
}
.brand-text {
  min-width: 0;
}
.brand-icon {
  width: 2.875rem;
  height: 2.875rem;
  border-radius: var(--r-lg);
  flex: none;
  overflow: hidden;
  box-shadow: 0 0.25rem 0.75rem -0.25rem rgba(0, 0, 0, 0.35);
}
/* icon 自带蓝底渐变，占满容器即可，无需容器再铺底色 */
.brand-ico {
  display: block;
  width: 100%;
  height: 100%;
}
.hero h1 {
  font-size: var(--fs-h1);
  font-weight: 600;
  line-height: 1.3;
}
.hero .ver {
  font-size: var(--fs-cap);
  background: rgba(255, 255, 255, 0.22);
  padding: 0.125rem 0.5rem;
  border-radius: var(--r-pill);
  margin-left: 0.375rem;
  font-weight: 500;
  vertical-align: 0.125rem;
}
.hero .sub {
  color: #dbeafe;
  font-size: var(--fs-body);
  margin-top: var(--sp-2);
}

/* ---- 用户信息 ---- */
.who {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-body);
  flex-wrap: wrap;
}
.who-avatar {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  flex: none;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-body);
}
.who-role,
.who-sys {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--fs-cap);
  background: rgba(255, 255, 255, 0.2);
  padding: 0.0625rem 0.5rem;
  border-radius: var(--r-pill);
}
.who-ico {
  font-size: 0.75em;
}
.who .el-link.who-logout {
  color: #dbeafe;
  font-size: var(--fs-body);
}

/* ---- 统计条（大数字 + 小标签） ---- */
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3) clamp(1rem, 0.5rem + 2vw, 2rem);
  margin-top: var(--sp-5);
}
.stat {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}
.stat b {
  font-size: var(--fs-stat);
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.stat span {
  font-size: var(--fs-cap);
  color: #bfdbfe;
}
/* 日期不是计数，降一级避免被当成大数字 */
.stat-date b {
  font-size: var(--fs-strong);
  font-weight: 600;
  letter-spacing: 0.01em;
}

/* ---- 告警（独立一行，默认折叠） ---- */
.alerts {
  margin-top: var(--sp-4);
  border-top: 1px solid rgba(255, 255, 255, 0.16);
  padding-top: var(--sp-3);
}
.alerts-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  cursor: pointer;
  border: none;
  font-family: inherit;
  background: rgba(220, 38, 38, 0.85);
  color: #fff;
  font-size: var(--fs-cap);
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-pill);
  transition: background 0.15s ease;
}
.alerts-toggle:hover {
  background: rgba(220, 38, 38, 1);
}
.alerts-toggle.open .alerts-chev {
  transform: rotate(180deg);
}
.alerts-ico {
  font-size: 0.875rem;
}
.alerts-chev {
  font-size: 0.75rem;
  transition: transform 0.15s ease;
}
.alerts-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.alerts-item {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: var(--fs-cap);
  padding: 0.1875rem var(--sp-2);
  border-radius: var(--r-sm);
  font-family: Consolas, monospace;
}

/* ============================================================
   主区容器
   ============================================================ */
.main {
  margin-top: var(--sp-5);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-xl);
  padding: var(--sp-1) var(--pad-panel) var(--pad-panel);
  box-shadow: 0 0.375rem 1.5rem -0.75rem rgba(15, 23, 42, 0.12);
}
.main-tabs {
  max-width: 100%;
}
.main-tabs .el-tabs__header {
  margin-bottom: var(--sp-3);
}
.main-tabs .el-tabs__item {
  font-size: var(--fs-strong);
  padding-inline: var(--sp-3);
}
.main-tabs .el-tabs__nav-wrap::after {
  height: 1px;
  background: var(--line);
}

/* ============================================================
   通用面板（外白内灰，嵌套时仍有层次）
   ============================================================ */
.panel {
  background: var(--surface-sunken);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-xl);
  padding: var(--pad-panel);
  margin-top: var(--gap-panel);
  box-shadow: 0 0.125rem 0.625rem -0.375rem rgba(15, 23, 42, 0.06);
}

.panel h3,
h3 {
  font-size: var(--fs-strong);
  color: var(--brand-deep);
  margin: var(--sp-4) 0 var(--sp-3);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-weight: 600;
}
.panel h3:first-child {
  margin-top: 0;
}
.h3-ico {
  font-size: 1rem;
}
.panel-sub {
  font-size: var(--fs-cap);
  color: var(--ink-muted);
  margin: calc(var(--sp-1) * -1) 0 var(--sp-3);
}

ul.plain {
  list-style: none;
}
ul.plain li {
  font-size: var(--fs-body);
  line-height: 1.75;
  padding: var(--sp-1) 0 var(--sp-1) var(--sp-4);
  position: relative;
  color: var(--ink-3);
}
ul.plain li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.75rem;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: #93c5fd;
}

.cause {
  border: 1px solid var(--line);
  border-left: 0.1875rem solid #93c5fd;
  border-radius: var(--r-lg);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-3);
  background: var(--surface);
  transition: box-shadow 0.15s ease;
}
.cause:hover {
  box-shadow: 0 0.25rem 0.875rem -0.5rem rgba(15, 23, 42, 0.18);
}
.cause .title {
  font-size: var(--fs-body);
  font-weight: 600;
  color: #111827;
}
.cause .type {
  font-size: var(--fs-cap);
  color: var(--ink-muted);
  margin-top: var(--sp-1);
}

pre.sql {
  background: #0f172a;
  color: #e2e8f0;
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-md);
  font-size: var(--fs-cap);
  overflow-x: auto;
  line-height: 1.6;
  margin: var(--sp-2) 0 var(--sp-3);
  border: 1px solid #1e293b;
}
.sql-purpose {
  font-size: var(--fs-body);
  color: #334155;
  font-weight: 600;
  margin-top: var(--sp-1);
}
ol.steps {
  padding-left: var(--sp-6);
}
ol.steps li {
  font-size: var(--fs-body);
  line-height: 1.9;
  color: var(--ink-2);
}
.src {
  font-size: var(--fs-cap);
  color: var(--ink-muted);
  margin-top: var(--sp-2);
}
.hint {
  font-size: var(--fs-cap);
  color: var(--ink-muted);
  margin-top: var(--sp-3);
  line-height: 1.7;
}

.foot {
  margin-top: var(--sp-6);
  font-size: var(--fs-cap);
  color: #64748b;
  text-align: center;
  line-height: 1.8;
}

/* ============================================================
   能力图示：概念卡网格（auto-fit 自适应列数）
   ============================================================ */
.concept-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  gap: var(--gap-grid);
}
.concept {
  border-radius: var(--r-lg);
}
.concept .body {
  font-size: var(--fs-body);
  line-height: 1.8;
}
.concept .body b {
  color: var(--ink-2);
}

/* ============================================================
   响应式
   ============================================================ */
@media (max-width: 64rem) {
  .hero-inner {
    gap: var(--sp-3);
  }
  .who {
    width: 100%;
  }
}
@media (max-width: 45rem) {
  .hero {
    border-radius: var(--r-xl);
  }
  .stats {
    gap: var(--sp-2) var(--sp-4);
  }
  .main {
    border-radius: var(--r-lg);
  }
  .panel {
    border-radius: var(--r-lg);
  }
  .foot {
    text-align: left;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
