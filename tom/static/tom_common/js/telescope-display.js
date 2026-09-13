/* Display helpers preserve unknown evidence and never infer observation success. */
((root) => {
  'use strict';
  const labels = {
    PENDING: '等待观测', SCHEDULED: '已排入计划', IN_PROGRESS: '观测中',
    COMPLETED: '设施报告完成', WINDOW_EXPIRED: '观测窗口已过',
    CANCELED: '已取消', CANCELLED: '已取消', FAILURE: '设施报告失败',
    submitted: '已提交', processed: '日报标记已处理', failed: '报告失败',
    not_configured: '尚未接入', raw: '原始图像', psf_after: 'PSF 处理后',
  };
  const text = value => value === null || value === undefined || value === '' ? '未提供' : String(value);
  const state = value => Object.hasOwn(labels, value) ? `${labels[value]}（${value}）` : text(value);
  function timestamp(value) {
    if (!value) return '未提供';
    // A timezone-free source string cannot safely be assumed to mean UTC.
    if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return `${text(value)}（时区未确认）`;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return `${text(value)}（时间无效）`;
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(date) + ' 北京时间';
  }
  function sameSnapshot(expected, pages) {
    return !!expected && pages.every(page => page.snapshot_sha256 === expected);
  }
  const api = {text, state, timestamp, sameSnapshot};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.telescopeDisplay = api;
})(globalThis);
