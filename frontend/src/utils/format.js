/** ISO 时间 → 展示格式（截取到秒，T 换空格） */
export function fmtTime(s) {
  return String(s || '')
    .slice(0, 19)
    .replace('T', ' ');
}