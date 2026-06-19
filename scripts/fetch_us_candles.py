#!/usr/bin/env python3
"""
US 종목 시계열 정적 수집 — yfinance(Yahoo Finance 비공식).

용도:
    스윙 모드 모멘텀 카드 산출용. 1년치 일봉 받아 요약 지표만 JSON 으로 저장.
    1·3·6개월 가격 변화, 52주 고저, 20일·60일 이동평균 위치.

사용:
    pip3 install yfinance
    cd /Users/hyone/Documents/ClaudeCode/Work/CompanyAnalysis
    python3 workspace/CA_Project/scripts/fetch_us_candles.py

또는 워크스페이스 안에서:
    cd workspace/CA_Project
    python3 scripts/fetch_us_candles.py

출력:
    workspace/CA_Project/js/data/us-candles.json
    형식:
      {
        "generatedAt": "2026-12-15T12:00:00",
        "validUntil": "2026-12-22",   # 권장 갱신 기한
        "tickerCount": 612,
        "data": {
          "AAPL": {
            "currentPrice": 250.5,
            "lastUpdated": "2026-12-13",
            "change1m": 5.2,        # 1개월 가격 변화율 (%)
            "change3m": 12.4,
            "change6m": 18.7,
            "high52": 280.0,        # 52주 고가
            "low52": 200.0,
            "ma20": 245.0,          # 20일 이동평균
            "ma60": 235.0,
            "pos52": 0.82           # 52주 고저 위치 (0~1, 1=고가)
          },
          ...
        },
        "failed": ["TICKER1", "TICKER2"]
      }

호출량 절약:
    yfinance 의 batch download(`yf.download` 다중 ticker) 활용으로 ~650 종목을 한 번에.
    실패 종목은 결과에서 제외하고 'failed' 에 표기.

운영 주기: 매주 1회 (월요일 권장). KR `fetch_dart_data.py` 와 동일 패턴.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from datetime import datetime, timedelta

try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    print("yfinance 또는 pandas 가 설치되지 않았습니다. 다음 명령으로 설치하세요:", file=sys.stderr)
    print("  pip3 install yfinance", file=sys.stderr)
    sys.exit(2)

# === 경로 ===
REPO_ROOT = Path(__file__).resolve().parent.parent  # workspace/CA_Project/
SYMBOLS_US_EXTRA_JSON = REPO_ROOT / "js" / "data" / "symbols-us-extra.json"
ETF_US_EXTRA_JSON = REPO_ROOT / "js" / "data" / "etf-us-extra.json"
OUTPUT_JSON = REPO_ROOT / "js" / "data" / "us-candles.json"

# symbols.js 의 하드코딩 US 종목(약 20개). symbols.js 직접 파싱 대신 별도 명시.
HARDCODED_US = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA",
    "AMD", "AVGO", "TSM", "JPM", "BAC", "V", "WMT", "KO",
    "SPY", "IVV", "VOO", "QQQ", "VTI",
    "BK", "FI", "MMC", "PARA",   # candles 누락 동기화 (2026-06-12)
    # 4순위 가 보강 (2026-06-12)
    "UBER", "LYFT", "SNAP", "PINS", "SHOP", "SQ", "SOFI", "HOOD",
    "SNOW", "U", "NET", "OKTA", "DKNG", "RBLX", "RIVN", "LCID",
    "NIO", "XPEV", "BABA", "TME", "SE", "GRAB", "DOCN", "TWLO",
    "ZM", "ROKU", "SPOT", "ETSY", "BNTX", "NVAX",
]


def load_tickers() -> list[str]:
    tickers: set[str] = set(HARDCODED_US)
    # symbols-us-extra (S&P500 + NASDAQ100 약 505)
    if SYMBOLS_US_EXTRA_JSON.exists():
        d = json.loads(SYMBOLS_US_EXTRA_JSON.read_text(encoding="utf-8"))
        for s in d.get("symbols", []):
            t = s.get("ticker")
            if t:
                tickers.add(t)
    # etf-us-extra (123 ETF)
    if ETF_US_EXTRA_JSON.exists():
        d = json.loads(ETF_US_EXTRA_JSON.read_text(encoding="utf-8"))
        # etf-us-extra.json 구조 확인: data 또는 symbols 키 양쪽 시도
        items = d.get("symbols") or d.get("data") or d.get("etfs") or []
        for s in items:
            t = s.get("ticker") if isinstance(s, dict) else s
            if t:
                tickers.add(t)
    return sorted(tickers)


def summarize_one(df: "pd.DataFrame", ticker: str) -> dict | None:
    """단일 종목 1년치 일봉 → 요약 지표 dict 변환."""
    if df is None or df.empty:
        return None
    closes = df["Close"].dropna()
    if len(closes) < 20:        # 최소 20일 필요(이동평균 산출 위해)
        return None

    current = float(closes.iloc[-1])
    last_date = closes.index[-1].strftime("%Y-%m-%d")

    def pct_change_days(n: int) -> float | None:
        if len(closes) <= n:
            return None
        prev = closes.iloc[-(n + 1)]
        if not prev:
            return None
        return round((current / float(prev) - 1) * 100, 2)

    high52 = float(closes.max())
    low52 = float(closes.min())
    pos52 = round((current - low52) / (high52 - low52), 3) if high52 > low52 else None

    ma20 = float(closes.iloc[-20:].mean())
    ma60 = float(closes.iloc[-60:].mean()) if len(closes) >= 60 else None

    return {
        "currentPrice": round(current, 2),
        "lastUpdated": last_date,
        "change1m": pct_change_days(21),   # 약 1개월 거래일
        "change3m": pct_change_days(63),
        "change6m": pct_change_days(126),
        "high52": round(high52, 2),
        "low52": round(low52, 2),
        "ma20": round(ma20, 2),
        "ma60": round(ma60, 2) if ma60 is not None else None,
        "pos52": pos52,
    }


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

    if n_total == 0 or n_ok / n_total < 0.98:
        return False, f"성공률 {n_ok}/{n_total} ({n_ok/max(n_total,1)*100:.1f}%) < 98%"
    if n_ok < 615:
        return False, f"성공 종목 {n_ok} < 615"

    KEY = ["AAPL", "MSFT", "NVDA", "JPM", "SPY"]
    for t in KEY:
        d = result["data"].get(t)
        if not d or not isinstance(d, dict):
            return False, f"핵심 종목 {t} 누락"
        ohlc = d.get("ohlc") or d.get("series") or d.get("candles") or []
        if len(ohlc) < 60:
            return False, f"핵심 종목 {t} 시세 {len(ohlc)}건 < 60"

    if size_kb < 160:
        return False, f"파일 크기 {size_kb:.0f} KB < 160 KB"

    return True, f"성공 {n_ok}/{n_total} ({size_kb:.0f} KB)"


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
    print(f"수집 대상: {len(tickers)} 종목")
    print(f"출력 경로: {OUTPUT_JSON}\n")

    # 1년치 일봉 — yfinance batch download
    # group_by='ticker' 옵션으로 ticker 별 DataFrame 분리.
    print("yfinance 호출 중...")
    raw = yf.download(
        tickers,
        period="1y",
        interval="1d",
        group_by="ticker",
        threads=True,
        progress=True,
        auto_adjust=False,
    )

    data: dict[str, dict] = {}
    failed: list[str] = []

    for t in tickers:
        try:
            # batch download 결과는 MultiIndex 열 — t 키로 접근.
            if isinstance(raw.columns, pd.MultiIndex):
                if t not in raw.columns.get_level_values(0):
                    failed.append(t)
                    continue
                df = raw[t]
            else:
                # 단일 ticker 결과 — 컬럼이 다름
                df = raw

            summary = summarize_one(df, t)
            if summary is None:
                failed.append(t)
                continue
            data[t] = summary
        except Exception as e:
            print(f"  ! {t} 실패: {e}", file=sys.stderr)
            failed.append(t)

    now = datetime.now()
    valid_until = (now + timedelta(days=7)).strftime("%Y-%m-%d")
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
        _notify("❌ US 시세 갱신 실패", reason, ok=False)
        return 1

    print(f"\n[검증 통과] {reason}")

    # 자동 푸시 분기 (--auto-push 일 때만)
    if args.auto_push:
        subj = f"chore(data): us-candles 자동 갱신 — {reason}"
        push_ok, push_msg = _auto_push(OUTPUT_JSON, subj)
        if push_ok:
            if push_msg == "변경 없음 (스킵)":
                _notify("✅ us-candles 갱신 통과 (변경 없음)", reason, ok=True)
            else:
                _notify("🚀 us-candles 자동 푸시 완료", f"{reason} | {push_msg}", ok=True)
            return 0
        else:
            print(f"\n[푸시 실패] {push_msg}", file=sys.stderr)
            _notify("⚠ us-candles 갱신 통과, 푸시 실패", push_msg, ok=False)
            return 1
    else:
        _notify("✅ US 시세 갱신 통과", f"{reason}. 수동 푸시 가능.", ok=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
