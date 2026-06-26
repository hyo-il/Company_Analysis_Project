// 경기선행지표 페이지 — UI 스켈레톤 (데이터 통합은 별도 차수)
//
// 본 차수: 메뉴 구조 + 페이지 placeholder 만.
// 다음 차수: 미국 LEI (Conference Board / FRED) + 한국 경기종합지수 (통계청 KOSIS / 한국은행 ECOS) 통합.

import { emptyState } from '../components/common.js';

export async function renderLeading(container) {
  container.innerHTML = `
    <div class="panel">
      <div class="panel-title">
        경기선행지표
        <span style="font-weight:400; color:var(--text-muted); font-size:12px;">
          Leading Economic Index — 미국 + 한국
        </span>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin:0 0 16px;">
        경기 흐름을 사전에 예측하는 종합 지표. 본 페이지는 미국 (Conference Board LEI)
        과 한국 (통계청 경기종합지수 — 선행지수) 데이터를 통합해 표시합니다.
      </p>
      <div style="margin:24px 0;">
        ${emptyState('데이터 통합 준비 중입니다. 곧 차트와 분석이 추가될 예정입니다.')}
      </div>
      <div style="font-size:12px; color:var(--text-muted); border-top:1px solid var(--border); padding-top:12px; margin-top:24px;">
        <strong>예정 항목:</strong><br />
        • 미국 LEI 추이 (월간) — Conference Board / FRED.<br />
        • 한국 경기종합지수 선행지수 (월간) — 통계청 KOSIS.<br />
        • YoY 변동률 + 6개월·12개월 추세.<br />
        • 경기 국면 판정 (확장 / 정점 / 수축 / 저점).
      </div>
    </div>
  `;
}
