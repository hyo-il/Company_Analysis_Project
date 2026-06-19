#!/usr/bin/env python3
"""
OpenDART 한국 종목 데이터 일괄 수집 → 정적 JSON 생성.

사용 방법:
    1) 본 파일을 CompanyAnalysis/scripts/ 에 둔다.
    2) 동일 디렉토리(CompanyAnalysis/) 에 OpenDART API 키 환경변수 설정 후 실행:
       export DART_KEY="여기에본인키"
       python3 scripts/fetch_dart_data.py
    3) 결과는 workspace/CA_Project/js/data/kr-dart.json 에 저장된다.

구성:
    - dart-corpcode.json (코스피200 200종) + symbols-kr-extra.json (KOSDAQ150 141종) 의
      ticker → corp_code 매핑을 통합 corpmap 으로 로드
    - 각 종목별 다음을 OpenDART 에서 받아 정적 JSON 으로 가공:
        * 회사 개황 (company.json)
        * 사업보고서 2개년 (작년·재작년)  — 절대 지표 + 연간 YoY 성장
        * 직전 연도 분기 4건 (1Q·반기·3Q·연간) — 분기 시계열 4분기 환산
    - 요청 간 짧은 sleep 으로 OpenDART 부하 분산
    - 중간 진행 표시, 실패 종목은 건너뛰고 마지막에 요약

저작권/주의:
    - OpenDART 무료 한도(일 20,000건) 안에서 운영. 약 340 종목 기준 약 2,400 호출.
    - 본 스크립트는 사용자 PC(한국 IP) 에서 실행해야 OpenDART 가 정상 응답.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
import urllib.request
import urllib.error

# === 경로 ===
REPO_ROOT = Path(__file__).resolve().parent.parent  # CA_Project/ (git repo root)
CORPCODE_JSON         = REPO_ROOT / "js" / "data" / "dart-corpcode.json"
CORPCODE_FULL_JSON    = REPO_ROOT / "js" / "data" / "dart-corpcode-full.json"   # 신규 — 3,967 lookup 풀
SYMBOLS_KR_EXTRA_JSON = REPO_ROOT / "js" / "data" / "symbols-kr-extra.json"     # 신규 — KOSDAQ150
OUTPUT_JSON           = REPO_ROOT / "js" / "data" / "kr-dart.json"

# === 상수 ===
DART_BASE = "https://opendart.fss.or.kr"
REQ_INTERVAL_SEC = 0.15   # 호출 간 짧은 대기
RETRY_COUNT = 2           # 실패 시 재시도 횟수

# DART 보고서 코드
REPORT_FY = "11011"   # 사업보고서 (연간)
REPORT_Q3 = "11014"   # 3분기 (1~3분기 누적)
REPORT_HY = "11012"   # 반기 (1~2분기 누적)
REPORT_Q1 = "11013"   # 1분기

# 화면 카드와 매핑되는 핵심 계정
# 한국 회계 다양한 표기 대응. 보험·금융업의 매출 계정도 포함.
ACCOUNT_MAP: dict[str, str] = {
    # 매출 (일반 + 금융업 + 보험업)
    "매출액":                          "revenue",
    "수익(매출액)":                     "revenue",
    "매출":                            "revenue",
    "영업수익":                         "revenue",  # 금융업 (은행·증권 등)
    "보험료수익":                       "revenue",  # 보험업
    "수입보험료":                       "revenue",  # 보험업 다른 표기
    # 영업이익
    "영업이익":                         "operatingIncome",
    "영업이익(손실)":                   "operatingIncome",
    "영업손실":                         "operatingIncome",
    # 순이익
    "당기순이익":                       "netIncome",
    "당기순이익(손실)":                  "netIncome",
    "당기순손실":                       "netIncome",
    "반기순이익":                       "netIncome",
    "반기순이익(손실)":                  "netIncome",
    "분기순이익":                       "netIncome",
    "분기순이익(손실)":                  "netIncome",
    # BS
    "자산총계":                         "totalAssets",
    "부채총계":                         "totalLiabilities",
    "자본총계":                         "totalEquity",
    # CF (OCF 다양한 표기)
    "영업활동 현금흐름":                  "ocf",
    "영업활동으로 인한 현금흐름":          "ocf",
    "영업활동현금흐름":                   "ocf",
    "영업활동으로인한현금흐름":           "ocf",
    "영업활동으로인한순현금흐름":         "ocf",
    "영업활동으로 인한 순현금흐름":        "ocf",
    # BS - 유동/비유동 (유동비율 산출)
    "유동자산":                          "currentAssets",
    "유동부채":                          "currentLiabilities",
    # PL - 이자비용 (이자보상비율 산출)
    "이자비용":                          "interestExpense",
    "이자비용(영업외)":                  "interestExpense",
    "금융비용":                          "interestExpense",     # 금융업·일부 IFRS 표기
    # PL - 감가상각비 (EBITDA 산출)
    "감가상각비":                        "depreciation",
    "감가상각비및무형자산상각비":         "depreciation",
    "감가상각비 및 무형자산상각비":       "depreciation",
    "유형자산상각비":                     "depreciation",
}


# === HTTP ===
def dart_get(path: str, params: dict[str, Any], key: str) -> dict | None:
    qs = urlencode({**params, "crtfc_key": key})
    url = f"{DART_BASE}{path}?{qs}"
    for attempt in range(RETRY_COUNT + 1):
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                body = r.read().decode("utf-8")
            data = json.loads(body)
            status = data.get("status")
            if status in ("000", "013"):
                return data
            # 010·011·020 등 키/요청 오류
            print(f"  ! status={status} message={data.get('message','')} path={path}", file=sys.stderr)
            return None
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if attempt < RETRY_COUNT:
                time.sleep(0.5 * (attempt + 1))
                continue
            print(f"  ! fetch failed path={path} error={e}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"  ! unexpected path={path} error={e}", file=sys.stderr)
            return None
    return None


def fetch_company(corp_code: str, key: str) -> dict | None:
    return dart_get("/api/company.json", {"corp_code": corp_code}, key)


def fetch_fnltt(corp_code: str, year: int, report_code: str, key: str) -> dict | None:
    return dart_get(
        "/api/fnlttSinglAcnt.json",
        {"corp_code": corp_code, "bsns_year": str(year), "reprt_code": report_code},
        key,
    )


def fetch_fnltt_supp(corp_code: str, year: int, key: str) -> dict | None:
    """fnlttSinglAcntAll (사업보고서 전체 계정) — 보강 데이터 전용.

    이자비용·감가상각비 등 fnlttSinglAcnt(주요계정) 에 없는 항목 추출용.
    호출 줄이기 위해 사업보고서(REPORT_FY) 만 받음. 분기 보고서는 받지 않음.
    """
    return dart_get(
        "/api/fnlttSinglAcntAll.json",
        {
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": REPORT_FY,
            "fs_div": "CFS",          # 연결재무제표 우선
        },
        key,
    )


# === 가공 ===
def parse_amount(s: Any) -> float | None:
    if s in (None, "", "-"):
        return None
    try:
        return float(str(s).replace(",", ""))
    except Exception:
        return None


def extract_accounts(report: dict | None) -> dict[str, float] | None:
    """단일 보고서 응답에서 연결재무제표(CFS) 우선으로 핵심 계정만 추출."""
    if not report or not report.get("list"):
        return None
    items = report["list"]
    cfs = [r for r in items if r.get("fs_div") == "CFS"]
    ofs = [r for r in items if r.get("fs_div") == "OFS"]
    chosen = cfs if cfs else ofs

    out: dict[str, float] = {}
    for r in chosen:
        key = ACCOUNT_MAP.get(r.get("account_nm", ""))
        if not key:
            continue
        amount = parse_amount(r.get("thstrm_amount"))
        if amount is not None and key not in out:
            out[key] = amount
    return out or None


def extract_quarterly_accounts(report: dict | None) -> dict[str, float] | None:
    """단일 보고서 응답에서 분기 단독 금액(thstrm_add_amount)을 추출.

    timeseries 용. 사업보고서·반기·3분기 응답에서 해당 분기 단독 금액을 가져온다.
    1분기 보고서는 thstrm_add_amount = thstrm_amount 라 둘 다 동일.
    필드가 비어 있으면 None 반환 → 호출부가 누적-누적 환산 폴백을 사용한다.
    """
    if not report or not report.get("list"):
        return None
    items = report["list"]
    cfs = [r for r in items if r.get("fs_div") == "CFS"]
    ofs = [r for r in items if r.get("fs_div") == "OFS"]
    chosen = cfs if cfs else ofs

    out: dict[str, float] = {}
    for r in chosen:
        key = ACCOUNT_MAP.get(r.get("account_nm", ""))
        if not key:
            continue
        amount = parse_amount(r.get("thstrm_add_amount"))
        if amount is not None and key not in out:
            out[key] = amount
    return out or None


def extract_supp_accounts(report: dict | None) -> dict[str, float] | None:
    """fnlttSinglAcntAll 응답에서 보강 키만 추출.

    SUPP_KEYS 화이트리스트(interestExpense, depreciation) 안 키만 채움.
    핵심 키(revenue·netIncome 등) 는 무시하여 core 결과를 절대 덮어쓰지 않음 — 회귀 방지.
    fs_div 분기: CFS 가 비어 있으면 OFS 보조.
    """
    if not report or not report.get("list"):
        return None
    items = report["list"]
    # fnlttSinglAcntAll 은 fs_div 를 요청 파라미터로 받으므로 응답 행에 fs_div 가 없다(None).
    # 행에 태그가 있으면 CFS>OFS 우선, 없으면 전체 사용(요청이 이미 fs_div=CFS).
    cfs = [r for r in items if r.get("fs_div") == "CFS"]
    ofs = [r for r in items if r.get("fs_div") == "OFS"]
    chosen = cfs or ofs or items
    if not chosen:
        return None

    # 보강 대상 화이트리스트 — 이 두 키만 추출
    SUPP_KEYS = {"interestExpense", "depreciation"}

    out: dict[str, float] = {}
    for r in chosen:
        key = ACCOUNT_MAP.get(r.get("account_nm", ""))
        if not key or key not in SUPP_KEYS:
            continue
        amount = parse_amount(r.get("thstrm_amount"))
        if amount is not None and key not in out:
            out[key] = amount
    return out or None


def subtract_quarter(later: dict | None, earlier: dict | None) -> dict | None:
    """누적 보고서끼리 차이로 단일 분기 값 산출. earlier=None 이면 later 그대로(=Q1).

    Sanity check: 매출(revenue)이 음수로 나오면 환산 오류 가능성이 크므로 해당 분기 값은 null.
    DART fnlttSinglAcnt 응답에서 일부 보고서가 누적 의미가 다를 때 발생.
    """
    if not later:
        return None
    if not earlier:
        return dict(later)
    out: dict[str, float | None] = {}
    keys = ("revenue", "operatingIncome", "netIncome", "ocf")
    for k in keys:
        a = later.get(k)
        b = earlier.get(k)
        if a is not None and b is not None:
            diff = a - b
            # 매출은 음수 불가. 환산 오류로 판단하고 null.
            if k == "revenue" and diff < 0:
                out[k] = None
            else:
                out[k] = diff
        elif a is not None:
            out[k] = a
    # 매출이 null이면 영업이익률 등 파생도 의미 없어지지만 다른 키는 그대로 유지.
    return out or None


def build_financials_card(latestY: dict | None, prevY: dict | None) -> dict:
    """단일 종목용 화면 카드 형식 재무 객체."""
    fin: dict[str, float | None] = {
        "revenue": None, "operatingIncome": None, "netIncome": None, "ocf": None,
        "totalAssets": None, "totalLiabilities": None, "totalEquity": None,
        "currentAssets": None, "currentLiabilities": None,
        "roe": None, "roa": None, "opMargin": None, "netMargin": None,
        "debtRatio": None, "currentRatio": None, "interestCoverage": None, "ebitdaMargin": None,
        "revenueGrowthYoY": None, "opGrowth": None, "epsGrowth": None,
    }

    ref = latestY or {}
    # 절대 지표
    fin["revenue"] = ref.get("revenue")
    fin["operatingIncome"] = ref.get("operatingIncome")
    fin["netIncome"] = ref.get("netIncome")
    fin["ocf"] = ref.get("ocf")
    fin["totalAssets"] = ref.get("totalAssets")
    fin["totalLiabilities"] = ref.get("totalLiabilities")
    fin["totalEquity"] = ref.get("totalEquity")
    fin["currentAssets"] = ref.get("currentAssets")
    fin["currentLiabilities"] = ref.get("currentLiabilities")

    # 파생 지표
    if ref.get("revenue") and ref.get("operatingIncome") is not None:
        fin["opMargin"] = ref["operatingIncome"] / ref["revenue"] * 100
    if ref.get("revenue") and ref.get("netIncome") is not None:
        fin["netMargin"] = ref["netIncome"] / ref["revenue"] * 100
    if ref.get("totalEquity") and ref.get("netIncome") is not None:
        fin["roe"] = ref["netIncome"] / ref["totalEquity"] * 100
    if ref.get("totalAssets") and ref.get("netIncome") is not None:
        fin["roa"] = ref["netIncome"] / ref["totalAssets"] * 100
    if ref.get("totalEquity") and ref.get("totalLiabilities") is not None:
        fin["debtRatio"] = ref["totalLiabilities"] / ref["totalEquity"] * 100

    # 유동비율 = 유동자산 / 유동부채 × 100 (백분율)
    if ref.get("currentLiabilities") and ref.get("currentAssets") is not None:
        fin["currentRatio"] = ref["currentAssets"] / ref["currentLiabilities"] * 100

    # 이자보상비율 = 영업이익 / 이자비용 (배수)
    if ref.get("interestExpense") and ref.get("operatingIncome") is not None:
        # 이자비용이 양수일 때만 의미. DART 에서 이자비용은 양수로 들어옴.
        if ref["interestExpense"] > 0:
            fin["interestCoverage"] = ref["operatingIncome"] / ref["interestExpense"]

    # EBITDA 마진 = (영업이익 + 감가상각비) / 매출 × 100
    if ref.get("revenue") and ref.get("operatingIncome") is not None and ref.get("depreciation") is not None:
        ebitda = ref["operatingIncome"] + ref["depreciation"]
        fin["ebitdaMargin"] = ebitda / ref["revenue"] * 100

    # 연간 YoY 성장
    if latestY and prevY:
        if prevY.get("revenue"):
            fin["revenueGrowthYoY"] = (latestY.get("revenue", 0) / prevY["revenue"] - 1) * 100
        if prevY.get("operatingIncome"):
            fin["opGrowth"] = (latestY.get("operatingIncome", 0) / prevY["operatingIncome"] - 1) * 100
        if prevY.get("netIncome"):
            fin["epsGrowth"] = (latestY.get("netIncome", 0) / prevY["netIncome"] - 1) * 100

    return fin


INCOME_KEYS = ("revenue", "operatingIncome", "netIncome")


def build_timeseries(q1_raw: dict | None, hy_raw: dict | None, q3_raw: dict | None, fy_raw: dict | None, year: int) -> dict:
    """단일 종목용 분기 시계열 (해당 연도 4분기, 분기 단독값).

    DART fnlttSinglAcnt 필드 의미(검증 완료):
      - 손익계산서: thstrm_amount = 당기(3개월) 단독, thstrm_add_amount = 당기누적
      - 현금흐름표: thstrm_amount = 당기누적 (3개월 단독 미제공)
      - 사업보고서(연간): thstrm_amount = 연간 전체, thstrm_add_amount 없음

    분기 단독값 산출:
      손익(revenue·op·net)  Q1~Q3 = 각 보고서 thstrm_amount (이미 단독, 빼기 불필요)
                            Q4    = 연간 − 3Q누적(thstrm_add_amount)
                                    [폴백: 연간 − (Q1+Q2+Q3 단독)]
      OCF                   누적 차감: Qn = 누적n − 누적(n-1)
    EPS·FCF·ROE 는 자본·주식수·CAPEX 정보 부족으로 분기 시계열 미생성.
    """
    yy = str(year)[2:]
    # 손익 단독 = thstrm_amount / OCF 누적 = thstrm_amount
    s1, s2, s3 = extract_accounts(q1_raw), extract_accounts(hy_raw), extract_accounts(q3_raw)
    fy = extract_accounts(fy_raw)               # 손익 연간 전체 / OCF 연간 누적
    cum3 = extract_quarterly_accounts(q3_raw)   # thstrm_add_amount = 3Q 누적 (손익 Q4용)

    def g(d: dict | None, k: str) -> float | None:
        return d.get(k) if d else None

    def income_q4(k: str) -> float | None:
        annual = g(fy, k)
        if annual is None:
            return None
        c = g(cum3, k)                          # 3Q 누적 우선
        if c is not None:
            return annual - c
        parts = [g(s1, k), g(s2, k), g(s3, k)]  # 폴백: 연간 − 단독 3개 합
        if all(p is not None for p in parts):
            return annual - sum(parts)
        return None

    def ocf_q(later: dict | None, earlier: dict | None) -> float | None:
        a = g(later, "ocf")
        if a is None:
            return None
        b = g(earlier, "ocf")
        return a if b is None else a - b        # 누적 차감 (earlier 없으면 그대로)

    quarters = [
        (f"{yy}Q1", {**{k: g(s1, k) for k in INCOME_KEYS}, "ocf": g(s1, "ocf")}),
        (f"{yy}Q2", {**{k: g(s2, k) for k in INCOME_KEYS}, "ocf": ocf_q(s2, s1)}),
        (f"{yy}Q3", {**{k: g(s3, k) for k in INCOME_KEYS}, "ocf": ocf_q(s3, s2)}),
        (f"{yy}Q4", {**{k: income_q4(k) for k in INCOME_KEYS}, "ocf": ocf_q(fy, s3)}),
    ]

    labels: list[str] = []
    rev: list[float | None] = []
    op: list[float | None] = []
    ni: list[float | None] = []
    ocf: list[float | None] = []
    opm: list[float | None] = []

    for label, src in quarters:
        # 4개 지표 모두 비면 해당 분기 자체를 생략
        if all(src.get(k) is None for k in ("revenue", "operatingIncome", "netIncome", "ocf")):
            continue
        r = src.get("revenue")
        # 매출 음수는 환산 오류로 판단 → null (영업이익률도 자동 null)
        if r is not None and r < 0:
            r = None
        o = src.get("operatingIncome")
        labels.append(label)
        rev.append(r)
        op.append(o)
        ni.append(src.get("netIncome"))
        ocf.append(src.get("ocf"))
        # 분기별 영업이익률 — 매출이 양수일 때만 의미 있음
        if r is not None and o is not None and r > 0:
            opm.append(o / r * 100)
        else:
            opm.append(None)

    return {
        "labels": labels,
        "revenue": rev,
        "operatingIncome": op,
        "netIncome": ni,
        "ocf": ocf,
        "opMargin": opm,
    }


def build_profile_card(co: dict | None, fallback_ticker: str) -> dict:
    co = co or {}
    return {
        "nameKr": co.get("corp_name") or "",
        "nameEn": co.get("corp_name_eng") or "",
        "ceo": co.get("ceo_nm") or None,
        "induty_code": co.get("induty_code") or None,
        "established": co.get("est_dt") or None,
        "fiscalMonth": co.get("acc_mt") or None,
        "homepage": co.get("hm_url") or None,
        "irPage": co.get("ir_url") or None,
        "address": co.get("adres") or None,
    }


def load_corpmap() -> dict[str, str]:
    """기존 dart-corpcode.json (코스피200) + symbols-kr-extra.json (KOSDAQ150) 통합 corpmap.

    Returns: { ticker: corp_code } (중복 시 코스피200 우선 유지)
    """
    # 1. 기존 코스피200 — 그대로 사용
    if not CORPCODE_JSON.exists():
        print(f"corpCode 매핑 파일이 없습니다: {CORPCODE_JSON}", file=sys.stderr)
        sys.exit(2)
    with CORPCODE_JSON.open(encoding="utf-8") as f:
        corpmap: dict[str, str] = json.load(f)

    # 2. KOSDAQ150 추가 — dart-corpcode-full.json 의 byTicker 로 lookup
    if not SYMBOLS_KR_EXTRA_JSON.exists() or not CORPCODE_FULL_JSON.exists():
        print(f"[경고] EXTRA 파일이 없어 KOSPI200 200종만 수집합니다.", file=sys.stderr)
        return corpmap

    with SYMBOLS_KR_EXTRA_JSON.open(encoding="utf-8") as f:
        extra = json.load(f)
    with CORPCODE_FULL_JSON.open(encoding="utf-8") as f:
        full = json.load(f)
    by_ticker = full.get("byTicker", {})

    added = 0
    skipped_dup = 0
    skipped_no_corpcode = 0
    for s in extra.get("symbols", []):
        t = s.get("ticker")
        if not t:
            continue
        if t in corpmap:
            skipped_dup += 1
            continue
        entry = by_ticker.get(t, {})
        cc = entry.get("corp_code")
        if not cc:
            skipped_no_corpcode += 1
            print(f"  [경고] {t} ({s.get('nameKr')}): corp_code 미가용", file=sys.stderr)
            continue
        corpmap[t] = cc
        added += 1

    print(f"[corpmap] 코스피200 {len(corpmap) - added} + KOSDAQ150 신규 {added} = 총 {len(corpmap)} 종 (중복 {skipped_dup}, corp_code 미가용 {skipped_no_corpcode})", file=sys.stderr)
    return corpmap


def _notify(title: str, message: str, ok: bool = True) -> None:
    """macOS 알림 (osascript). 실패해도 무시."""
    import subprocess
    sound = "default" if ok else "Basso"
    safe_t = title.replace('"', "'")
    safe_m = message.replace('"', "'")
    script = f'display notification "{safe_m}" with title "{safe_t}" sound name "{sound}"'
    try:
        subprocess.run(["osascript", "-e", script], check=False, capture_output=True, timeout=5)
    except Exception:
        pass


def _validate(out_payload, fail_profile, fail_fin, fail_ts, output_path) -> tuple[bool, str]:
    n_ok = out_payload["tickerCount"]
    size_kb = output_path.stat().st_size / 1024

    # tickerCount 절대 기준
    if n_ok < 330:
        return False, f"성공 종목 {n_ok} < 330"

    # 재무 실패 ≤ 10
    if len(fail_fin) > 10:
        return False, f"재무 실패 {len(fail_fin)} > 10"

    # 개황 실패 ≤ 10
    if len(fail_profile) > 10:
        return False, f"개황 실패 {len(fail_profile)} > 10"

    # 핵심 5종 profile + revenue 채워짐
    KEY = ["005930", "000660", "247540", "263750", "041510"]
    for t in KEY:
        d = out_payload["data"].get(t)
        if not d:
            return False, f"핵심 종목 {t} 누락"
        prof = d.get("profile") or {}
        fin = d.get("financials") or {}
        if not prof or not prof.get("nameKr"):
            return False, f"핵심 종목 {t} profile 미가용"
        rev = fin.get("revenue")
        if not rev or rev <= 0:
            return False, f"핵심 종목 {t} revenue 미가용"

    if size_kb < 650:
        return False, f"파일 크기 {size_kb:.0f} KB < 650 KB"

    return True, f"성공 {n_ok}, 재무 실패 {len(fail_fin)}, 개황 실패 {len(fail_profile)} ({size_kb:.0f} KB)"


def _auto_push(file_path, commit_subject: str) -> tuple[bool, str]:
    """검증 통과 시 자동 git add → commit → push.

    Returns: (ok: bool, message: str)
    - 변경 사항 없으면 (True, "변경 없음 (스킵)")
    - 푸시 성공 시 (True, "푸시 완료")
    - 실패 시 (False, 에러 메시지 100자)
    """
    import subprocess
    repo_root = file_path.parent.parent.parent   # workspace/CA_Project
    rel_path = file_path.relative_to(repo_root)

    def _git(*args, timeout=60):
        return subprocess.run(
            ["git", "-C", str(repo_root), *args],
            capture_output=True, timeout=timeout
        )

    try:
        # 1. add
        r = _git("add", str(rel_path))
        if r.returncode != 0:
            return False, f"add 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"

        # 2. 변경 사항 확인 — staged diff 비어있으면 스킵
        r = _git("diff", "--cached", "--quiet")
        if r.returncode == 0:
            return True, "변경 없음 (스킵)"

        # 3. commit
        r = _git("commit", "-m", commit_subject, timeout=30)
        if r.returncode != 0:
            return False, f"commit 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"

        # 4. push
        r = _git("push", "origin", "main", timeout=120)
        if r.returncode != 0:
            return False, f"push 실패: {r.stderr.decode('utf-8', errors='ignore')[:100]}"

        return True, "푸시 완료"
    except subprocess.TimeoutExpired:
        return False, "타임아웃 (60s+)"
    except Exception as e:
        return False, f"예외: {str(e)[:80]}"


# === 메인 ===
def main() -> int:
    parser = argparse.ArgumentParser(description="OpenDART 한국 종목 데이터 일괄 수집")
    parser.add_argument("--year", type=int, default=None,
                        help="기준 연도(미지정 시 현재 연도-1). 사업보고서·시계열의 latestY 기준.")
    parser.add_argument("--limit", type=int, default=None,
                        help="처음 N 종목만(테스트용)")
    parser.add_argument("--output", type=Path, default=OUTPUT_JSON,
                        help=f"결과 JSON 경로 (기본 {OUTPUT_JSON})")
    parser.add_argument("--auto-push", action="store_true",
                        help="검증 통과 시 자동 git add/commit/push (기본: 수동)")
    args = parser.parse_args()

    key = os.environ.get("DART_KEY") or os.environ.get("CRTFC_KEY")
    if not key:
        # 폴백: 키 파일에서 읽기 (자동 실행 환경에서 환경변수 미상속 시)
        key_file = Path.home() / ".secrets" / "opendart_key"
        if key_file.exists():
            try:
                key = key_file.read_text(encoding="utf-8").strip()
            except Exception as e:
                print(f"키 파일 읽기 실패: {key_file} ({e})", file=sys.stderr)
    if not key:
        print(
            "OpenDART 키가 설정되지 않았습니다. 다음 중 하나로 설정하세요.\n"
            "  1) 환경변수: export DART_KEY=\"...\"\n"
            "  2) 키 파일: ~/.secrets/opendart_key (chmod 600)\n",
            file=sys.stderr,
        )
        return 2

    if not CORPCODE_JSON.exists():
        print(f"corpCode 매핑 파일이 없습니다: {CORPCODE_JSON}", file=sys.stderr)
        return 2

    corpmap = load_corpmap()

    tickers = sorted(corpmap.keys())
    if args.limit:
        tickers = tickers[: args.limit]

    from datetime import datetime
    today = datetime.now()
    base_year = args.year if args.year else today.year - 1
    prev_year = base_year - 1

    print(f"기준 연도: {base_year} (직전 비교: {prev_year})")
    print(f"종목 수: {len(tickers)}")
    print(f"호출 간격: {REQ_INTERVAL_SEC}s, 재시도: {RETRY_COUNT}회")
    print(f"출력 경로: {args.output}")
    print()

    result: dict[str, dict] = {}
    fail_profile: list[str] = []
    fail_fin: list[str] = []
    fail_ts: list[str] = []

    for idx, ticker in enumerate(tickers, 1):
        corp_code = corpmap[ticker]
        print(f"[{idx:3d}/{len(tickers)}] {ticker} ({corp_code}) ", end="", flush=True)

        # 1) 회사 개황
        co_raw = fetch_company(corp_code, key)
        time.sleep(REQ_INTERVAL_SEC)
        profile = build_profile_card(co_raw, ticker)
        if not co_raw:
            fail_profile.append(ticker)

        # 2) 사업보고서 2개년
        fy_latest_raw = fetch_fnltt(corp_code, base_year, REPORT_FY, key)
        time.sleep(REQ_INTERVAL_SEC)
        fy_prev_raw = fetch_fnltt(corp_code, prev_year, REPORT_FY, key)
        time.sleep(REQ_INTERVAL_SEC)
        fy_supp_raw = fetch_fnltt_supp(corp_code, base_year, key)   # 신규 보강 호출
        time.sleep(REQ_INTERVAL_SEC)
        latestY = extract_accounts(fy_latest_raw)
        prevY = extract_accounts(fy_prev_raw)
        supp = extract_supp_accounts(fy_supp_raw)

        # 보강 머지 — core 우선, supp 는 비어있는 키만 채움
        if supp:
            if latestY is None:
                latestY = {}
            for k, v in supp.items():
                latestY.setdefault(k, v)   # ← 이미 있으면 안 덮어씀

        financials = build_financials_card(latestY, prevY)
        if not latestY:
            fail_fin.append(ticker)

        # 3) 분기 시계열 (기준 연도 4개 보고서)
        q1_raw = fetch_fnltt(corp_code, base_year, REPORT_Q1, key)
        time.sleep(REQ_INTERVAL_SEC)
        hy_raw = fetch_fnltt(corp_code, base_year, REPORT_HY, key)
        time.sleep(REQ_INTERVAL_SEC)
        q3_raw = fetch_fnltt(corp_code, base_year, REPORT_Q3, key)
        time.sleep(REQ_INTERVAL_SEC)
        # raw 보고서 그대로 전달 (build_timeseries 내부에서 분기 단독 → 누적 환산 폴백 시도).
        # 4분기(Q4)는 사업보고서(fy_latest_raw) 재활용.
        ts = build_timeseries(q1_raw, hy_raw, q3_raw, fy_latest_raw, base_year)
        if not ts["labels"]:
            fail_ts.append(ticker)

        result[ticker] = {
            "profile": profile,
            "financials": financials,
            "timeseries": ts,
            "basis": {
                "year": base_year,
                "statement": "연결",
                "earnings": "지배주주",
            },
        }

        ok_marks = "".join([
            "P" if co_raw else "·",
            "F" if latestY else "·",
            "T" if ts["labels"] else "·",
            "S" if supp else "·",   # 신규
        ])
        print(f"[{ok_marks}]")

    # === 결과 저장 ===
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out_payload = {
        "generatedAt": today.isoformat(timespec="seconds"),
        "baseYear": base_year,
        "tickerCount": len(result),
        "data": result,
    }
    args.output.write_text(json.dumps(out_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    size_kb = args.output.stat().st_size / 1024

    # === 요약 ===
    print()
    print(f"저장: {args.output}  ({size_kb:,.1f} KB)")
    print(f"총 종목: {len(result)}")
    print(f"개황 실패: {len(fail_profile)}  {fail_profile[:10]}{' ...' if len(fail_profile) > 10 else ''}")
    print(f"재무 실패: {len(fail_fin)}  {fail_fin[:10]}{' ...' if len(fail_fin) > 10 else ''}")
    print(f"시계열 실패: {len(fail_ts)}  {fail_ts[:10]}{' ...' if len(fail_ts) > 10 else ''}")

    ok, reason = _validate(out_payload, fail_profile, fail_fin, fail_ts, args.output)
    if not ok:
        print(f"\n[검증 실패] {reason}", file=sys.stderr)
        _notify("❌ KR DART 갱신 실패", reason, ok=False)
        return 1

    print(f"\n[검증 통과] {reason}")

    # 자동 푸시 분기 (--auto-push 일 때만)
    if args.auto_push:
        subj = f"chore(data): kr-dart 자동 갱신 — {reason}"
        push_ok, push_msg = _auto_push(args.output, subj)
        if push_ok:
            if push_msg == "변경 없음 (스킵)":
                _notify("✅ kr-dart 갱신 통과 (변경 없음)", reason, ok=True)
            else:
                _notify("🚀 kr-dart 자동 푸시 완료", f"{reason} | {push_msg}", ok=True)
            return 0
        else:
            print(f"\n[푸시 실패] {push_msg}", file=sys.stderr)
            _notify("⚠ kr-dart 갱신 통과, 푸시 실패", push_msg, ok=False)
            return 1
    else:
        _notify("✅ KR DART 갱신 통과", f"{reason}. 수동 푸시 가능.", ok=True)
        return 0


if __name__ == "__main__":
    sys.exit(main())
