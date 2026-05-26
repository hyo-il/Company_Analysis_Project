import { fmtDate, daysSince } from '../utils/format.js';

export function metaBadge({ source, asOf }) {
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
