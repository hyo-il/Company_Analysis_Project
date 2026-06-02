import { fmtDate, daysSince } from '../utils/format.js';

const REASON_STYLES = {
  'kr-not-supported': 'background:#f1f5f9;color:#475569;border-color:#cbd5e1;',
  'fetch-failed':     'background:#fef2f2;color:#991b1b;border-color:#fecaca;',
  'no-news':          'background:#f1f5f9;color:#475569;border-color:#cbd5e1;',
  'no-key':           'background:#fefce8;color:#854d0e;border-color:#fde68a;',
};
const REASON_LABELS = {
  'kr-not-supported': 'KR 실데이터 미지원',
  'fetch-failed':     '데이터 호출 실패',
  'no-news':          '뉴스 없음',
  'no-key':           '프록시 미설정',
};

export function metaBadge(meta) {
  if (!meta) return '';
  const { source, asOf, reason } = meta;
  if (reason) {
    const style = REASON_STYLES[reason] || '';
    const label = REASON_LABELS[reason] || reason;
    const asOfStr = asOf ? ` · ${fmtDate(asOf)}` : '';
    return `<span class="meta-badge" style="${style}" title="${reason}">${label}${asOfStr}</span>`;
  }
  const days = daysSince(asOf);
  const stale = days > 3;
  return `<span class="meta-badge" title="출처/기준일">
    ${source ? source + ' · ' : ''}${fmtDate(asOf)}
    ${stale ? '<i class="warn-icon" data-tooltip="기준일 데이터입니다(최신이 아닐 수 있음).">!</i>' : ''}
  </span>`;
}

export function warnIcon(tip) {
  return `<i class="warn-icon" data-tooltip="${tip.replace(/"/g, '&quot;')}">!</i>`;
}

export function infoTip(tip) {
  return `<i class="info-tip" data-tooltip="${tip.replace(/"/g, '&quot;')}">?</i>`;
}

export function loadingState(msg = '불러오는 중…') {
  return `<div class="state-loading">${msg}</div>`;
}

export function errorState(msg) {
  return `<div class="state-error">⚠ ${msg}</div>`;
}

export function emptyState(msg) {
  return `<div class="state-empty">${msg}</div>`;
}
