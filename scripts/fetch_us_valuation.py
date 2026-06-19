#!/usr/bin/env python3
"""
US 종목 5년 PER·PBR 시계열 정적 수집 — yfinance.

용도:
    분석 페이지 "역사적 밸류에이션 밴드" (기획서 4.2.10) 활성화.
    본 회사의 과거 PER/PBR 평균 + ±1σ 밴드 산출용 원천 데이터.

사용:
    cd /Users/hyone/Documents/ClaudeCode/Work/CompanyAnalysis
    python3 workspace/CA_Project/scripts/fetch_us_valuation.py

출력:
    workspace/CA_Project/js/data/us-valuation.json
    형식:
      {
        "generatedAt": "2026-06-12T...",
        "validUntil": "2026-09-12",
        "tickerCount": ...,
        "data": {
          "AAPL": {
            "labels": ["20-06", "20-07", ..., "26-05"],   // 60 개월
            "per":    [25.3, 28.1, null, ..., 30.5],
            "pbr":    [12.4, 13.2, null, ..., 15.1]
          },
          ...
        },
        "failed": [...]
      }

산출 규칙:
    - 종가는 월말 Close. 60개월 미만 종목은 가용 길이만큼.
    - EPS·BPS 는 가장 최근 과거 결산일 값(forward-fill). 결산일 이전 시점은 None.
    - EPS ≤ 0 또는 BPS ≤ 0 인 시점은 PER/PBR 모두 None (의미 없음).
    - 종목별 발행주식수 미가용 시 PBR 전구간 None (PER 만 채움 가능).

운영 주기: 분기 1회 (사업보고서 갱신 시점).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from datetime import datetime, timedelta

try:
    import yfinance as yf
except ImportError:
    print("yfinance 가 설치되지 않았습니다. pip3 install yfinance", file=sys.stderr)
    sys.exit(2)

# === 경로 ===
REPO_ROOT = Path(__file__).resolve().parent.parent
SYMBOLS_US_EXTRA_JSON = REPO_ROOT / "js" / "data" / "symbols-us-extra.json"
OUTPUT_JSON = REPO_ROOT / "js" / "data" / "us-valuation.json"

# 하드코딩 US 종목 (fetch_us_financials.py 와 동기화 유지)
HARDCODED_US = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA",
    "AMD", "AVGO", "TSM", "JPM", "BAC", "V", "WMT", "KO",
    "BK", "FI", "MMC", "PARA",
    # 4순위 가 보강 (2026-06-12)
    "UBER", "LYFT", "SNAP", "PINS", "SHOP", "SQ", "SOFI", "HOOD",
    "SNOW", "U", "NET", "OKTA", "DKNG", "RBLX", "RIVN", "LCID",
    "NIO", "XPEV", "BABA", "TME", "SE", "GRAB", "DOCN", "TWLO",
    "ZM", "ROKU", "SPOT", "ETSY", "BNTX", "NVAX",
]


def load_tickers() -> list[str]:
    tickers: set[str] = set(HARDCODED_US)
    if SYMBOLS_US_EXTRA_JSON.exists():
        d = json.loads(SYMBOLS_US_EXTRA_JSON.read_text(encoding="utf-8"))
        for s in d.get("symbols", []):
            t = s.get("ticker")
            if t:
                tickers.add(t)
    # ETF 제외 (PER/PBR 의미 없음 — stock 만)
    return sorted(tickers)


def _safe_float(v) -> float | None:
    if v is None: return None
    if isinstance(v, float) and math.isnan(v): return None
    try:    return float(v)
    except Exception: return None


def _find_row(df, *names):
    """주어진 이름들 중 첫 매칭 라인 반환 (없으면 None)."""
    if df is None or getattr(df, "empty", True):
        return None
    for nm in names:
        if nm in df.index:
            return df.loc[nm]
    return None


def _fy_eps_bps(income_stmt, balance_sheet) -> list[dict]:
    """결산일별 EPS·BPS 시리즈 추출.

    Returns: [{'date': pd.Timestamp, 'eps': float|None, 'bps': float|None}, ...] (최신 → 과거)
    """
    out: list[dict] = []

    # Diluted EPS 직접 라인 우선, 없으면 Net Income / Diluted Shares 계산
    eps_row = _find_row(income_stmt, "Diluted EPS", "Basic EPS")
    net_income_row = _find_row(income_stmt, "Net Income", "Net Income Common Stockholders")
    diluted_shares_row = _find_row(income_stmt, "Diluted Average Shares", "Basic Average Shares")

    # Equity·Shares (BPS 계산)
    equity_row = _find_row(balance_sheet, "Stockholders Equity", "Total Equity Gross Minority Interest")
    shares_row = _find_row(balance_sheet, "Ordinary Shares Number", "Share Issued")

    # income_stmt 의 결산일 컬럼 기준으로 순회 (보통 최근 → 과거)
    if income_stmt is not None and not getattr(income_stmt, "empty", True):
        cols = list(income_stmt.columns)
    elif balance_sheet is not None and not getattr(balance_sheet, "empty", True):
        cols = list(balance_sheet.columns)
    else:
        return out

    for col in cols:
        eps = None
        if eps_row is not None and col in eps_row.index:
            eps = _safe_float(eps_row[col])
        if eps is None and net_income_row is not None and diluted_shares_row is not None:
            ni = _safe_float(net_income_row.get(col))
            ds = _safe_float(diluted_shares_row.get(col))
            if ni is not None and ds and ds > 0:
                eps = ni / ds

        bps = None
        if equity_row is not None and shares_row is not None and col in equity_row.index and col in shares_row.index:
            eq = _safe_float(equity_row[col])
            sh = _safe_float(shares_row[col])
            if eq is not None and sh and sh > 0:
                bps = eq / sh

        out.append({"date": col, "eps": eps, "bps": bps})

    # 과거 → 최신 순으로 정렬 (forward-fill 매칭 편의)
    out.sort(key=lambda x: x["date"])
    return out


def _build_monthly_pb(history_monthly, fy_series) -> tuple[list[str], list[float | None], list[float | None]]:
    """월별 종가 + 결산일별 EPS/BPS → labels, per, pbr 시리즈.

    Forward-fill: 각 월의 PER/PBR 는 그 시점 이전 가장 최근 결산일 값을 사용.
    """
    if history_monthly is None or getattr(history_monthly, "empty", True):
        return [], [], []

    labels: list[str] = []
    per_arr: list[float | None] = []
    pbr_arr: list[float | None] = []

    for idx, row in history_monthly.iterrows():
        # 라벨 — 'YY-MM'
        label = f"{idx.year % 100:02d}-{idx.month:02d}"
        labels.append(label)

        close = _safe_float(row.get("Close"))
        if close is None or close <= 0:
            per_arr.append(None)
            pbr_arr.append(None)
            continue

        # 이 시점 이전 가장 최근 결산일 fy_series 항목 (forward-fill)
        # history idx 는 tz-aware, 결산일(statement 컬럼)은 tz-naive → 비교 위해 naive 로 통일
        idx_cmp = idx.tz_localize(None) if getattr(idx, "tzinfo", None) is not None else idx
        match = None
        for fy in fy_series:
            if fy["date"] <= idx_cmp:
                match = fy   # 최신 매칭으로 덮어씀 (fy_series 는 과거 → 최신 정렬)
            else:
                break

        if match is None:
            per_arr.append(None)
            pbr_arr.append(None)
            continue

        per = (close / match["eps"]) if (match["eps"] and match["eps"] > 0) else None
        pbr = (close / match["bps"]) if (match["bps"] and match["bps"] > 0) else None
        per_arr.append(round(per, 2) if per is not None else None)
        pbr_arr.append(round(pbr, 2) if pbr is not None else None)

    return labels, per_arr, pbr_arr


def summarize_one(t: str) -> dict | None:
    try:
        tk = yf.Ticker(t)

        try:    hist = tk.history(period="5y", interval="1mo", auto_adjust=False)
        except Exception: hist = None
        try:    is_  = tk.income_stmt
        except Exception: is_  = None
        try:    bs   = tk.balance_sheet
        except Exception: bs   = None

        if hist is None or getattr(hist, "empty", True):
            return None

        fy_series = _fy_eps_bps(is_, bs)
        labels, per_arr, pbr_arr = _build_monthly_pb(hist, fy_series)

        if not labels or all(v is None for v in per_arr) and all(v is None for v in pbr_arr):
            return None

        return {"labels": labels, "per": per_arr, "pbr": pbr_arr}

    except Exception as e:
        print(f"  ! {t} 예외: {e}", file=sys.stderr)
        return None


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


def _validate(result, output_path) -> tuple[bool, str]:
    n_ok = result["tickerCount"]
    n_fail = len(result.get("failed", []))
    n_total = n_ok + n_fail
    size_kb = output_path.stat().st_size / 1024

    if n_total == 0 or n_ok / n_total < 0.97:
        return False, f"성공률 {n_ok}/{n_total} ({n_ok/max(n_total,1)*100:.1f}%) < 97%"
    if n_ok < 480:
        return False, f"성공 종목 {n_ok} < 480"

    # PER 가용성 ≥ 95% (PBR 은 자본 음수 시 None 가능)
    def has_per(v):
        per = v.get("per") if v else None
        return isinstance(per, list) and any(x is not None for x in per)
    with_per = sum(1 for v in result["data"].values() if has_per(v))
    if with_per / max(n_ok, 1) < 0.95:
        return False, f"PER 가용 {with_per}/{n_ok} ({with_per/max(n_ok,1)*100:.1f}%) < 95%"

    # 핵심 5종 labels 60개 + PER 마지막 non-null
    KEY = ["AAPL", "MSFT", "NVDA", "JPM", "BAC"]
    for t in KEY:
        d = result["data"].get(t)
        if not d:
            return False, f"핵심 종목 {t} 누락"
        labels = d.get("labels") or []
        if len(labels) < 36:   # 최소 3년
            return False, f"핵심 종목 {t} labels {len(labels)}월 < 36"
        per = d.get("per") or []
        last = next((x for x in reversed(per) if x is not None), None)
        if last is None or last <= 0:
            return False, f"핵심 종목 {t} PER 미가용 또는 음수"

    if size_kb < 1300:
        return False, f"파일 크기 {size_kb:.0f} KB < 1300 KB"

    return True, f"성공 {n_ok}/{n_total}, PER 가용 {with_per}/{n_ok} ({size_kb:.0f} KB)"


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


def _parse_args():
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--auto-push", action="store_true",
                   help="검증 통과 시 자동 git add/commit/push (기본: 수동)")
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    tickers = load_tickers()
    print(f"대상 ticker: {len(tickers)} 개 (stock 만)")
    print(f"출력: {OUTPUT_JSON}\n")

    data: dict[str, dict] = {}
    failed: list[str] = []

    for i, t in enumerate(tickers, 1):
        print(f"[{i:3}/{len(tickers)}] {t} ... ", end="", flush=True)
        summary = summarize_one(t)
        if summary is None:
            print("실패")
            failed.append(t)
            continue
        data[t] = summary
        print(f"OK ({len(summary['labels'])} 개월)")

    now = datetime.now()
    valid_until = (now + timedelta(days=90)).strftime("%Y-%m-%d")
    result = {
        "generatedAt": now.isoformat(timespec="seconds"),
        "validUntil": valid_until,
        "tickerCount": len(data),
        "data": data,
        "failed": failed,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    size_kb = OUTPUT_JSON.stat().st_size // 1024
    print(f"\n저장: {OUTPUT_JSON} ({size_kb} KB)")
    print(f"성공: {len(data)}, 실패: {len(failed)}")
    if failed[:10]:
        print(f"실패 예시(상위 10): {failed[:10]}")

    ok, reason = _validate(result, OUTPUT_JSON)
    if not ok:
        print(f"\n[검증 실패] {reason}", file=sys.stderr)
        _notify("❌ US 밸류 갱신 실패", reason, ok=False)
        return 1

    print(f"\n[검증 통과] {reason}")

    # 자동 푸시 분기 (--auto-push 일 때만)
    if args.auto_push:
        subj = f"chore(data): us-valuation 자동 갱신 — {reason}"
        push_ok, push_msg = _auto_push(OUTPUT_JSON, subj)
        if push_ok:
            if push_msg == "변경 없음 (스킵)":
                _notify("✅ us-valuation 갱신 통과 (변경 없음)", reason, ok=True)
            else:
                _notify("🚀 us-valuation 자동 푸시 완료", f"{reason} | {push_msg}", ok=True)
            return 0
        else:
            print(f"\n[푸시 실패] {push_msg}", file=sys.stderr)
            _notify("⚠ us-valuation 갱신 통과, 푸시 실패", push_msg, ok=False)
            return 1
    else:
        _notify("✅ US 밸류 갱신 통과", f"{reason}. 수동 푸시 가능.", ok=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
