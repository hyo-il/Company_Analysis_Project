import { getFinnhubProxyBase, setFinnhubProxyBase, clearFinnhubProxyBase, isUsingDefaultProxy } from '../data/config.js';
import { showToast } from '../components/toast.js';

function clearCalendarCache() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('ca:calendar:')) localStorage.removeItem(k);
  }
}

export function renderHelp(container) {
  const proxyBase = getFinnhubProxyBase();
  const usingDefault = isUsingDefaultProxy();
  const inputValue = (usingDefault ? '' : proxyBase).replace(/"/g, '&quot;');

  container.innerHTML = `
    <div class="panel">
      <div class="panel-title">CA 사용 안내</div>
      <h3 style="margin-top:8px;">이 도구는 무엇인가요?</h3>
      <p>국내(코스피200)와 미국(S&P500·나스닥) 기업·ETF의 핵심 지표·뉴스·일정을 한곳에서 보고, 동종업계 비교와 퀀트 점수로 상대적 위치를 파악할 수 있는 개인용 분석 도구입니다.</p>

      <h3 style="margin-top:16px;">데이터 정확도 원칙</h3>
      <ul>
        <li>모든 수치에는 <strong>출처</strong>(DART, SEC EDGAR, KRX, Finnhub 등)와 <strong>기준일</strong>이 함께 표기됩니다.</li>
        <li>시세는 EOD(전일 종가) 기준이며 일 1회 갱신됩니다.</li>
        <li>재무는 분기 공시 시점에 갱신됩니다.</li>
        <li>무료 데이터 한계가 있는 항목(예: 컨센서스)은 <i class="warn-icon" style="display:inline-flex;">!</i> 아이콘으로 명시됩니다.</li>
      </ul>

      <h3 style="margin-top:16px;">색상 의미</h3>
      <ul>
        <li><span class="up">▲ 빨강</span> 상승 / <span class="down">▼ 파랑</span> 하락 (국내 관례)</li>
        <li>색맹 배려를 위해 부호(▲/▼)를 항상 병기합니다.</li>
      </ul>

      <h3 style="margin-top:16px;">데이터 소스 설정</h3>

      <h4 style="margin:10px 0 4px; color:var(--primary);">① 친구 공유 모드 (Cloudflare 프록시) — 기본</h4>
      <p style="font-size:13px;">
        이 사이트는 본인이 운영하는 Cloudflare Worker를 통해 Finnhub 데이터를 받아오도록 기본 설정되어 있습니다.
        별도 키 등록 없이 미국 종목의 실적·배당 일정이 표시됩니다.
        (Worker URL은 코드에 박혀 있고, 실제 API 키는 본인의 Cloudflare 환경변수에만 보관됩니다.)
      </p>
      <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:8px 0;">
        <label for="proxy-finnhub" style="font-size:13px;">Finnhub 프록시 Worker URL (덮어쓰기)</label>
        <input type="url" id="proxy-finnhub" placeholder="기본값 사용 중 — 비워두면 코드의 DEFAULT 사용" value="${inputValue}"
          style="flex:1; min-width:280px; padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;" />
        <button class="btn-primary" id="proxy-finnhub-save">저장</button>
        <button class="btn-secondary" id="proxy-finnhub-reset">기본값으로</button>
      </div>

      <h4 style="margin:14px 0 4px; color:var(--primary);">② 데이터 소스 안내 (한계)</h4>
      <ul style="font-size:12px; color:var(--text-muted);">
        <li>한국 종목 일정은 본 앱 구조 제약(CORS·서버 없음)으로 아직 지원하지 않습니다.</li>
        <li>매크로 일정(FOMC/CPI 등)도 후속 단계에서 별도 어댑터로 다룰 예정입니다.</li>
        <li>무료 한도(시점 변동)는 Finnhub/Cloudflare 공식 페이지에서 확인하세요.</li>
        <li>프록시 모드에서 키는 본인의 Cloudflare 환경변수에만 존재하며, 친구의 PC·브라우저에는 저장되지 않습니다.</li>
        <li>관심 종목은 본인 PC의 브라우저에만 저장됩니다(localStorage). 친구마다 독립적으로 관리되며, 친구의 관심 종목이 본인에게 보이지 않고 그 반대도 마찬가지입니다. PC를 바꾸거나 브라우저 데이터를 지우면 관심 종목이 초기화될 수 있습니다.</li>
        <li>프록시가 일시적으로 비활성화된 경우, 본인은 Cloudflare Workers 대시보드에서 Worker를 재활성화하거나 키를 회전시킬 수 있습니다(<code>cloudflare/README.md</code> 참고).</li>
      </ul>

      <h3 style="margin-top:16px;">면책</h3>
      <p style="font-size:13px; color:var(--text-muted);">
        본 서비스는 정보 제공 목적의 참고 자료이며 투자 권유가 아닙니다. 모든 투자 판단과 책임은 사용자에게 있습니다. AI/규칙 기반 해설과 퀀트 점수는 과거·현재 지표에 기반한 참고용이며 미래 수익을 보장하지 않습니다.
      </p>
    </div>`;

  const proxyInput = container.querySelector('#proxy-finnhub');

  container.querySelector('#proxy-finnhub-save')?.addEventListener('click', () => {
    setFinnhubProxyBase(proxyInput.value.trim());
    clearCalendarCache();
    showToast('프록시 URL이 저장되었습니다.', { type: 'success' });
    renderHelp(container);
  });
  container.querySelector('#proxy-finnhub-reset')?.addEventListener('click', () => {
    clearFinnhubProxyBase();
    clearCalendarCache();
    showToast('기본 프록시 URL로 되돌렸습니다.', { type: 'info' });
    renderHelp(container);
  });
}
