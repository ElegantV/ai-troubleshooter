import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import LineageSvg from './LineageSvg.vue';

const graph = {
  jobs: [{ name: 'job_dwd_x', layer: 'DWD', desc: 'X 加工', schedule: '每日' }],
  tables: [{ name: 'dwd_x', layer: 'DWD', comment: 'X 明细' }],
  jobDeps: [{ job_name: 'job_dwd_x', depends_on: 'job_ods_y' }],
  tlineage: [{ src: 'ods_y', tgt: 'dwd_x', job: 'job_dwd_x' }],
};

describe('LineageSvg（SVG 渲染与 XSS 纵深防御）', () => {
  it('渲染含节点的 SVG，且节点文本被转义', () => {
    const w = mount(LineageSvg, { props: { graph } });
    const html = w.html();
    expect(html).toContain('<svg');
    expect(html).toContain('job_dwd_x');
    expect(html).toContain('role="img"');
  });

  it('恶意表名/描述被转义，不产生可执行的注入点', () => {
    const evil = {
      jobs: [{ name: 'job_a', layer: 'DWD', desc: '<img src=x onerror=alert(1)>', schedule: '每日' }],
      tables: [{ name: 'dwd_a', layer: 'DWD', comment: '"><script>alert(2)</script>' }],
      jobDeps: [],
      tlineage: [],
    };
    const w = mount(LineageSvg, { props: { graph: evil } });
    const inner = w.find('.svg-wrap').element.innerHTML;
    // 注入载荷不得以可执行形态出现（v-html 注入点的纵深防御）
    expect(inner).not.toContain('<img src=x');
    expect(inner).not.toContain('<script>');
    expect(inner).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(inner).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('空图时 svg-wrap 无内容不抛错', () => {
    const w = mount(LineageSvg, { props: { graph: null } });
    expect(w.find('.svg-wrap').element.innerHTML).toBe('');
  });
});