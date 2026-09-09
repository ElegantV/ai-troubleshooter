/**
 * XML/SVG 文本转义：用于 v-html 注入 SVG 前对服务端/用户派生文本做白名单式转义。
 * 覆盖全部 5 个关键字符（& < > " '），作为 v-html 注入点的纵深防御。
 */
export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}