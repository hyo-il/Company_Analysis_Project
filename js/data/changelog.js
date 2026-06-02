// 차수별 변경 데이터. bullets는 HTML 문자열 허용(innerHTML 사용).
// 신규 차수는 배열 맨 위에 추가(역순 정렬 유지 — 최신이 가장 위).
export const CHANGELOG_VERSIONS = [
  {
    id: 'v-quant-peer',
    title: '퀀트 점수 백분위 통합',
    date: '2026-05-30',
    bullets: [
      '<strong>동종업계 4곳과 비교한 백분위 점수</strong>로 전환 — 가치·수익성·성장성·안정성 4개 카테고리. (배당은 산업별 정책 차이로 절대 기준 유지)',
      '<strong>5단계 막대 시각화</strong> + 종합 카드에 "N곳 중 X위" 보조 표기.',
      '비교 종목명 안내 + "동종업계 비교 표 보기 →" 링크로 상대가치 비교 메뉴와 자연 연결.',
      '하한 3명 미만 시 점수 영역 자체 숨김 — 비교 대상이 부족한 종목 정직 처리.',
    ],
  },
  {
    id: 'v-history',
    title: '개발 히스토리 메뉴 신설',
    date: '2026-05-30',
    bullets: [
      '<strong>도움말 아래 "개발 히스토리" 메뉴</strong> 신설 — 차수별 업데이트 내역을 좌측 목차 + 우측 본문 2단으로 표시.',
      'Asset_Allocation 프로젝트의 패턴을 CA 보라 테마(<code>--primary</code>)로 이식.',
    ],
  },
  {
    id: 'v-cleanup',
    title: '정리 및 null 숨김 통합',
    date: '2026-05-29',
    bullets: [
      '<strong>코드 정리 8건</strong> — 미사용 export 삭제, help.js 폴백 라인 정리, mockFinancials·시계열 stub화, etf 메타 어댑터화, 매직 임계치 명명 상수, 코스피200 보강.',
      '<strong>null 지표 표시 안 함 정책</strong> — 값이 없는 지표 행/카드 자동 숨김. 한국 종목·실패 시 퀀트 점수 카드 영역 자체 숨김.',
      '관심 종목 페이지 매출 컬럼 제거 (의미 없는 NaN 노출 방지).',
      'git 1차 푸시 — Cloudflare 프록시 + 13차-r + 12+14차 v2 + 정리 통합본을 한 커밋으로 정리.',
    ],
  },
  {
    id: 'v-finnhub',
    title: 'Finnhub 실데이터 종합 연동',
    date: '2026-05-27',
    bullets: [
      '미국 종목 <strong>시세·프로필·재무·뉴스</strong>를 Finnhub 실데이터로 일괄 전환.',
      'Cloudflare Worker 프록시 도입 — 7경로 화이트리스트 + Origin 검증 + 서버 키 보관(친구 무설정 즉시 사용).',
      '드로어 탭(★ 관심 · 🕘 최근) + SVG 책갈피·시계 핸들 + 최근 조회 모듈 신설.',
      '한국 종목 안내 패널 + KR 실데이터 미지원 배지 (DART 연동 전 단계).',
      'API 캐시 결함 수정 — 실패·빈 응답을 캐시하지 않도록 변경.',
    ],
  },
];

export function listChangelogVersions() {
  return CHANGELOG_VERSIONS.map(({ id, title, date }) => ({ id, title, date }));
}

export function getChangelogVersion(id) {
  return CHANGELOG_VERSIONS.find(v => v.id === id) || null;
}
