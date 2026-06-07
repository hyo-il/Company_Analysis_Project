import { getProfile, getQuoteEOD, getHoldings, ISSUER_LINKS } from '../data/adapter.js';
import { fmtNum, fmtChange, fmtMoney, fmtPct } from '../utils/format.js';
import { metaBadge, warnIcon, infoTip, loadingState, errorState } from '../components/common.js';
import { pushRecent } from '../data/recents.js';
import { openHoldingAnalysisDialog } from '../components/holding-dialog.js';
import { getSymbol } from '../data/symbols.js';
import { mockEtfDetail } from '../data/adapters/etf-meta.js';

export async function renderEtf(container, { ticker }) {
  if (!ticker) {
    container.innerHTML = `<div class="panel"><div class="state-empty">ETF를 검색해 선택해 주세요.</div></div>`;
    return;
  }
  pushRecent(ticker);
  container.innerHTML = loadingState();
  try {
    const [profile, quote, holdingsRes] = await Promise.all([
      getProfile(ticker), getQuoteEOD(ticker), getHoldings(ticker),
    ]);
    const etf = mockEtfDetail(ticker);
    const holdings = holdingsRes.data;
    const currency = profile.currency;
    const lowAum = etf.aum < 1e8;             // < $100M (실제 상장폐지 위험 권역)
    const highTracking = etf.trackingError > 1.5;   // > 1.5% (큰 ETF 도 일부 정상 범위 포함)
    const delistRisk = lowAum && highTracking;       // 둘 다 충족 시만 상장폐지 위험

    container.innerHTML = `
      <div class="panel">
        <div style="display:flex; align-items:flex-start; gap:16px; flex-wrap:wrap;">
          <div style="flex:1; min-width:240px;">
            <h2>${profile.data.nameKr} <span style="color:var(--text-muted); font-weight:400;">${profile.data.nameEn}</span> <span class="best-badge" style="background:var(--lavender);">ETF</span></h2>
            <div style="color:var(--text-muted); margin-top:4px;">
              ${profile.data.ticker} · ${profile.data.exchange} · ${profile.data.industry}
            </div>
            <p style="margin-top:8px;">${profile.data.nameKr}는 ${profile.data.industry} 카테고리의 상장지수펀드(ETF)입니다.</p>
          </div>
          <div style="text-align:right;">
            <div style="font-size:24px; font-weight:700;">${fmtNum(quote.data.price)}</div>
            <div>${fmtChange(quote.data.changePct)}</div>
            <div style="margin-top:6px;">${metaBadge(quote)}</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">기본 정보</div>
        <table>
          <tbody>
            <tr><td style="width:30%; color:var(--text-muted);">테마/유형</td><td>${profile.data.industry}</td></tr>
            <tr><td style="color:var(--text-muted);">벤치마크 지수</td><td>— ${warnIcon('무료 데이터로 벤치마크 지수명 자동 확보가 어려운 경우 표시되지 않습니다.')}</td></tr>
            <tr><td style="color:var(--text-muted);">운용사</td><td>— ${warnIcon('운용사 정보는 거래소 공시에서 별도 연동 필요.')}</td></tr>
            <tr><td style="color:var(--text-muted);">설정일</td><td>— ${warnIcon('설정일 정보 미연동.')}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="panel">
        <div class="panel-title">비용·규모·안정성</div>
        <table>
          <thead><tr><th>항목 ${infoTip('총보수(TER)는 ETF 비교의 1순위. AUM과 추적오차가 안정성 핵심.')}</th><th class="num">값</th><th>참고</th></tr></thead>
          <tbody>
            <tr><td>총보수 (TER)</td><td class="num"><strong>${fmtPct(etf.ter)}</strong></td><td style="color:var(--text-muted); font-size:12px;">매년 수익률에서 차감</td></tr>
            <tr><td>순자산총액 (AUM)</td><td class="num"><strong>${fmtMoney(etf.aum, currency)}</strong> ${lowAum ? warnIcon('AUM이 낮아 상장폐지 위험이 상대적으로 큽니다.') : ''}</td><td style="color:var(--text-muted); font-size:12px;">규모가 작으면 청산 위험</td></tr>
            <tr><td>추적오차</td><td class="num">${fmtPct(etf.trackingError)} ${highTracking ? warnIcon('추적오차가 큰 편입니다.') : ''}</td><td style="color:var(--text-muted); font-size:12px;">지수와의 괴리</td></tr>
            <tr><td>괴리율 (시장가 vs NAV)</td><td class="num">${etf.premiumDiscount > 0 ? '+' : ''}${fmtPct(etf.premiumDiscount)}</td><td style="color:var(--text-muted); font-size:12px;">프리미엄/디스카운트</td></tr>
            <tr><td>분배율</td><td class="num">${fmtPct(etf.distributionYield)}</td><td style="color:var(--text-muted); font-size:12px;">연 환산 분배금</td></tr>
          </tbody>
        </table>
        ${delistRisk ? `<div style="margin-top:10px; padding:10px 12px; background:#fff5f5; border:1px solid #fecaca; border-radius:6px; font-size:13px;">
          <strong style="color:var(--warn);">⚠ 상장폐지 위험 플래그</strong> — AUM 이 작고 추적오차도 큽니다.
          <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">거래소별 상장폐지 기준은 변동되므로 공식 출처를 추가 확인하세요.</div>
        </div>` : ''}
      </div>

      <div class="panel">
        <div class="panel-title">구성 종목 (상위) ${holdings.length ? '' : warnIcon('무료 데이터로 구성 종목 자동 수집이 어려운 경우 표시되지 않습니다. 운용사 공식 자료에서 확인하세요.')}</div>
        ${renderHoldings(holdings, etf, ticker)}
      </div>

      <div class="panel">
        <p style="font-size:12px; color:var(--text-muted); margin:0;">
          ⚠ 본 정보는 참고용이며 투자 권유가 아닙니다. 일부 항목은 무료 데이터 한계로 ${warnIcon('운용사 공시 연동 시 정확한 값으로 대체됩니다.')} 표시됩니다.
        </p>
      </div>
    `;
    container.querySelectorAll('.holding-row').forEach(tr => {
      const open = () => openHoldingAnalysisDialog(tr.dataset.ticker);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  } catch (e) {
    container.innerHTML = errorState('ETF 데이터 로드 실패: ' + e.message);
  }
}

function renderHoldings(holdings, etf, ticker) {
  const link = ISSUER_LINKS[ticker];
  const linkHtml = link ? ` <a href="${link}" target="_blank" rel="noopener noreferrer">운용사 공식 페이지 ↗</a>` : '';
  const footerNote = `<p style="font-size:12px; color:var(--text-muted); margin-top:8px;">
    섹터·국가별 배분, 분배 이력 등 상세는 운용사 공식 페이지에서 확인하세요.${linkHtml}
  </p>`;
  if (!holdings || !holdings.length) {
    return `<p style="color:var(--text-muted); font-size:13px;">
      구성 종목 정보가 무료 데이터로 확보되지 않았습니다.
    </p>${footerNote}`;
  }
  const top10Sum = holdings.slice(0, 10).reduce((s, h) => s + h.weight, 0);
  const rows = holdings.map(h => {
    const sym = getSymbol(h.ticker);
    const clickable = !!sym;
    const trAttrs = clickable
      ? `class="holding-row" role="button" tabindex="0" data-ticker="${h.ticker}" style="cursor:pointer;"`
      : `style="cursor:not-allowed; opacity:0.6;" title="분석 정보 미등록"`;
    return `<tr ${trAttrs}>
      <td>${h.name}</td>
      <td style="color:var(--text-muted); font-family:ui-monospace, SFMono-Regular, monospace; font-size:12px;">${h.ticker || '—'}</td>
      <td class="num" style="color:var(--primary); ${h.weight >= 5 ? 'font-weight:700;' : ''}">${fmtPct(h.weight, 1)}</td>
    </tr>`;
  }).join('');
  return `
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
      <div style="flex:1; min-width:200px; background:var(--bg-subtle); border:1px solid var(--accent-line); border-radius:6px; padding:10px 12px;">
        <div style="font-size:12px; color:var(--text-muted);">상위 10종목 합산 비중</div>
        <div style="font-size:20px; font-weight:700; color:var(--primary);">${fmtPct(top10Sum, 1)}</div>
      </div>
      <div style="flex:1; min-width:200px; background:var(--bg-subtle); border:1px solid var(--accent-line); border-radius:6px; padding:10px 12px;">
        <div style="font-size:12px; color:var(--text-muted);">표시된 종목 수</div>
        <div style="font-size:20px; font-weight:700;">${holdings.length}</div>
      </div>
    </div>
    <table class="metrics-table holdings-table">
      <thead><tr>
        <th style="text-align:left;">종목명</th>
        <th style="text-align:left;">티커</th>
        <th class="num">비중</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${footerNote}`;
}
