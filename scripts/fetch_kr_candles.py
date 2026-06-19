#!/usr/bin/env python3
"""
KR 종목 시세 시계열 정적 수집 — yfinance (Yahoo Finance, 한국 종목 .KS 접미).

용도:
    KR 종목의 스윙 모멘텀·변동성 카드 활성화.
    1·3·6개월 가격 변화, 52주 고저, 20·60일 이동평균 위치.
    (US us-candles.json 와 동일 형식)

사용:
    cd /Users/hyone/Documents/ClaudeCode/Work/CompanyAnalysis
    python3 workspace/CA_Project/scripts/fetch_kr_candles.py

출력:
    workspace/CA_Project/js/data/kr-candles.json
    형식 (us-candles.json 와 동일):
      {
        "generatedAt": "2026-06-11T...",
        "validUntil": "2026-06-18",
        "tickerCount": 200,
        "data": {
          "005930": {
            "currentPrice": 75000,
            "change1m": 5.2,
            "change3m": 12.4,
            "change6m": 18.7,
            "high52": 88000, "low52": 60000,
            "ma20": 73000, "ma60": 70000,
            "pos52": 0.54
          },
          ...
        },
        "failed": [...]
      }

운영 주기: 주 1회 (us-candles 와 동일 시점 권장).
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
    print("yfinance·pandas 미설치. pip3 install yfinance", file=sys.stderr)
    sys.exit(2)

# === 경로 ===
REPO_ROOT = Path(__file__).resolve().parent.parent  # workspace/CA_Project/
KR_DART_JSON = REPO_ROOT / "js" / "data" / "kr-dart.json"
OUTPUT_JSON = REPO_ROOT / "js" / "data" / "kr-candles.json"


def load_kr_tickers() -> list[str]:
    """kr-dart.json 에서 KR 종목 ticker 목록 추출 (200 종목)."""
    if not KR_DART_JSON.exists():
        print(f"kr-dart.json 없음: {KR_DART_JSON}", file=sys.stderr)
        return []
    d = json.loads(KR_DART_JSON.read_text(encoding="utf-8"))
    return sorted(d.get("data", {}).keys())


def summarize_one(df: "pd.DataFrame") -> dict | None:
    """단일 종목 1년치 일봉 → 요약 (us-candles 와 동일 구조)."""
    if df is None or df.empty:
        return None
    closes = df["Close"].dropna()
    if len(closes) < 20:
        return None

    current = float(closes.iloc[-1])

    def pct(n: int) -> float | None:
        if len(closes) <= n: return None
        prev = closes.iloc[-(n + 1)]
        if not prev: return None
        return round((current / float(prev) - 1) * 100, 2)

    high52 = float(closes.max())
    low52 = float(closes.min())
    pos52 = round((current - low52) / (high52 - low52), 3) if high52 > low52 else None
    ma20 = float(closes.iloc[-20:].mean())
    ma60 = float(closes.iloc[-60:].mean()) if len(closes) >= 60 else None

    return {
        "currentPrice": round(current, 2),
        "lastUpdated": closes.index[-1].strftime("%Y-%m-%d"),
        "change1m": pct(21),
        "change3m": pct(63),
        "change6m": pct(126),
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

    if n_total == 0 or n_ok / n_total < 0.97:
        return False, f"성공률 {n_ok}/{n_total} ({n_ok/max(n_total,1)*100:.1f}%) < 97%"
    if n_ok < 330:
        return False, f"성공 종목 {n_ok} < 330"

    # 핵심 5종 ohlc 60개 이상 확인 (월간 5년 또는 일간 ~3개월)
    KEY = ["005930", "000660", "247540", "263750", "041510"]
    for t in KEY:
        d = result["data"].get(t)
        if not d or not isinstance(d, dict):
            return False, f"핵심 종목 {t} 누락"
        ohlc = d.get("ohlc") or d.get("series") or d.get("candles") or []
        if len(ohlc) < 60:
            return False, f"핵심 종목 {t} 시세 {len(ohlc)}건 < 60"

    if size_kb < 50:
        return False, f"파일 크기 {size_kb:.0f} KB < 50 KB"

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
    kr_tickers = load_kr_tickers()
    if not kr_tickers:
        print("KR ticker 목록 비어있음 (kr-dart.json 먼저 갱신 필요)", file=sys.stderr)
        return 2

    # yfinance ticker 형식: 005930.KS · 005385.KS 등
    yf_tickers = [f"{t}.KS" for t in kr_tickers]
    print(f"대상 ticker: {len(yf_tickers)} 개 (KOSPI/.KS 접미)")
    print(f"출력: {OUTPUT_JSON}\n")

    print("yfinance 호출 중...")
    raw = yf.download(
        yf_tickers,
        period="1y",
        interval="1d",
        group_by="ticker",
        threads=True,
        progress=True,
        auto_adjust=False,
    )

    data: dict[str, dict] = {}
    failed: list[str] = []

    for kr_t, yf_t in zip(kr_tickers, yf_tickers):
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                if yf_t not in raw.columns.get_level_values(0):
                    failed.append(kr_t)
                    continue
                df = raw[yf_t]
            else:
                df = raw

            summary = summarize_one(df)
            if summary is None:
                failed.append(kr_t)
                continue
            # KR 원본 ticker (6자리 숫자) 키로 저장
            data[kr_t] = summary
        except Exception as e:
            print(f"  ! {kr_t} 실패: {e}", file=sys.stderr)
            failed.append(kr_t)

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
        _notify("❌ KR 시세 갱신 실패", reason, ok=False)
        return 1

    print(f"\n[검증 통과] {reason}")

    # 자동 푸시 분기 (--auto-push 일 때만)
    if args.auto_push:
        subj = f"chore(data): kr-candles 자동 갱신 — {reason}"
        push_ok, push_msg = _auto_push(OUTPUT_JSON, subj)
        if push_ok:
            if push_msg == "변경 없음 (스킵)":
                _notify("✅ kr-candles 갱신 통과 (변경 없음)", reason, ok=True)
            else:
                _notify("🚀 kr-candles 자동 푸시 완료", f"{reason} | {push_msg}", ok=True)
            return 0
        else:
            print(f"\n[푸시 실패] {push_msg}", file=sys.stderr)
            _notify("⚠ kr-candles 갱신 통과, 푸시 실패", push_msg, ok=False)
            return 1
    else:
        _notify("✅ KR 시세 갱신 통과", f"{reason}. 수동 푸시 가능.", ok=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
