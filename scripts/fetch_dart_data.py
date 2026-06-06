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
    - dart-corpcode.json 에서 한국 종목 ticker → corp_code 매핑 로드
    - 각 종목별 다음을 OpenDART 에서 받아 정적 JSON 으로 가공:
        * 회사 개황 (company.json)
        * 사업보고서 2개년 (작년·재작년)  — 절대 지표 + 연간 YoY 성장
        * 직전 연도 분기 4건 (1Q·반기·3Q·연간) — 분기 시계열 4분기 환산
    - 요청 간 짧은 sleep 으로 OpenDART 부하 분산
    - 중간 진행 표시, 실패 종목은 건너뛰고 마지막에 요약

저작권/주의:
    - OpenDART 무료 한도(일 20,000건) 안에서 운영. 200 종목 기준 약 1,400 호출.
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
REPO_ROOT = Path(__file__).resolve().parent.parent  # CompanyAnalysis/
CORPCODE_JSON = REPO_ROOT / "js" / "data" / "dart-corpcode.json"
OUTPUT_JSON   = REPO_ROOT / "js" / "data" / "kr-dart.json"

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
        "roe": None, "roa": None, "opMargin": None, "netMargin": None,
        "debtRatio": None,
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


# === 메인 ===
def main() -> int:
    parser = argparse.ArgumentParser(description="OpenDART 한국 종목 데이터 일괄 수집")
    parser.add_argument("--year", type=int, default=None,
                        help="기준 연도(미지정 시 현재 연도-1). 사업보고서·시계열의 latestY 기준.")
    parser.add_argument("--limit", type=int, default=None,
                        help="처음 N 종목만(테스트용)")
    parser.add_argument("--output", type=Path, default=OUTPUT_JSON,
                        help=f"결과 JSON 경로 (기본 {OUTPUT_JSON})")
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

    with CORPCODE_JSON.open(encoding="utf-8") as f:
        corpmap: dict[str, str] = json.load(f)

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
        latestY = extract_accounts(fy_latest_raw)
        prevY = extract_accounts(fy_prev_raw)
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
