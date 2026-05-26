export function fmtNum(v, digits = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtInt(v) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('ko-KR');
}

export function fmtPct(v, digits = 2) {
  if (v == null || isNaN(v)) return '—';
  return `${Number(v).toFixed(digits)}%`;
}

export function fmtChange(v, digits = 2) {
  if (v == null || isNaN(v)) return '—';
  const sign = v > 0 ? '▲' : v < 0 ? '▼' : '–';
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
  return `<span class="${cls}">${sign} ${Math.abs(v).toFixed(digits)}%</span>`;
}

export function fmtMoney(v, currency = 'KRW') {
  if (v == null || isNaN(v)) return '—';
  if (currency === 'KRW') {
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
    if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
    return fmtInt(v);
  }
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${fmtInt(v)}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ko-KR');
}

export function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}
