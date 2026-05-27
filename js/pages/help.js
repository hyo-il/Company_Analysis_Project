import { getApiKey, setApiKey, API_KEYS } from '../data/config.js';
import { showToast } from '../components/toast.js';

export function renderHelp(container) {
  const finnhubKey = getApiKey(API_KEYS.FINNHUB);
  container.innerHTML = `
    <div class="panel">
      <div class="panel-title">CA 사용 안내</div>
      <h3 style="margin-top:8px;">이 도구는 무엇인가요?</h3>
      <p>국내(코스피200)와 미국(S&P500·나스닥) 기업·ETF의 핵심 지표·뉴스·일정을 한곳에서 보고, 동종업계 비교와 퀀트 점수로 상대적 위치를 파악할 수 있는 개인용 분석 도구입니다.</p>

      <h3 style="margin-top:16px;">데이터 정확도 원칙</h3>
      <ul>
        <li>모든 수치에는 <strong>출처</strong>(DART, SEC EDGAR, KRX 등)와 <strong>기준일</strong>이 함께 표기됩니다.</li>
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
      <p style="font-size:13px;">
        주요 일정의 <strong>미국 종목 실적·배당</strong>은 무료 외부 데이터(Finnhub)를 사용합니다.
        무료 키를 발급받아 아래에 입력하시면 실데이터로 표시됩니다.
        키가 없거나, 한국 종목이거나, 호출이 실패하면 <strong>가짜 데이터로 채우지 않고 "데이터 없음"으로 정직히 표시</strong>합니다.
        가입 전 Finnhub 공식 사이트의 Privacy/Terms를 직접 확인하시기 바랍니다.
        한국 종목·매크로 일정(FOMC/CPI 등) 연동은 본 앱 구조 제약(CORS·서버 없음)으로 후속 단계에서 별도 어댑터로 다룹니다.
      </p>
      <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:8px 0;">
        <label for="apikey-finnhub" style="font-size:13px;">Finnhub API Key (선택)</label>
        <input type="password" id="apikey-finnhub" placeholder="발급받은 키 입력" autocomplete="off" value="${finnhubKey.replace(/"/g, '&quot;')}"
          style="flex:1; min-width:240px; padding:7px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px;" />
        <button class="btn-primary" id="apikey-finnhub-save">저장</button>
        <button class="btn-secondary" id="apikey-finnhub-clear">지우기</button>
        <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" style="font-size:13px;">무료 키 발급 ↗</a>
        <a href="https://finnhub.io/" target="_blank" rel="noopener noreferrer" style="font-size:13px;">Finnhub 공식 사이트(약관·개인정보 확인) ↗</a>
      </div>
      <p style="font-size:12px; color:var(--text-muted); margin:0 0 6px;">
        키는 이 PC의 localStorage에만 저장되며 외부로 전송되지 않습니다(브라우저에서 Finnhub로만 직접 호출).
      </p>

      <h3 style="margin-top:16px;">면책</h3>
      <p style="font-size:13px; color:var(--text-muted);">
        본 서비스는 정보 제공 목적의 참고 자료이며 투자 권유가 아닙니다. 모든 투자 판단과 책임은 사용자에게 있습니다. AI/규칙 기반 해설과 퀀트 점수는 과거·현재 지표에 기반한 참고용이며 미래 수익을 보장하지 않습니다.
      </p>
    </div>`;

  const input = container.querySelector('#apikey-finnhub');
  container.querySelector('#apikey-finnhub-save')?.addEventListener('click', () => {
    setApiKey(API_KEYS.FINNHUB, input.value.trim());
    // 새 키로 다음 호출이 fresh 하도록 캘린더 캐시 클리어
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ca:calendar:')) localStorage.removeItem(k);
    }
    showToast('Finnhub 키가 저장되었습니다.', { type: 'success' });
  });
  container.querySelector('#apikey-finnhub-clear')?.addEventListener('click', () => {
    setApiKey(API_KEYS.FINNHUB, '');
    if (input) input.value = '';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ca:calendar:')) localStorage.removeItem(k);
    }
    showToast('Finnhub 키를 지웠습니다.', { type: 'info' });
  });
}
