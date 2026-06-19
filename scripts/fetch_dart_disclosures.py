#!/usr/bin/env python3
"""
KR 종목 OpenDART 공시 목록 정적 수집 → kr-disclosures.json.

용도:
    KR 종목 분석 페이지의 뉴스/공시 패널 활성화.
    Cloudflare Worker(미국 IP) → OpenDART 차단 우회 (정적 JSON 방식, kr-dart 와 동일).

사용:
    cd /Users/hyone/Documents/ClaudeCode/Work/CompanyAnalysis
    export DART_KEY="..."   # 또는 ~/.secrets/opendart_key
    python3 workspace/CA_Project/scripts/fetch_dart_disclosures.py

출력:
    workspace/CA_Project/js/data/kr-disclosures.json
    형식:
      {
        "generatedAt": "2026-06-12T...",
        "windowDays": 30,
        "tickerCount": 341,
        "data": {
          "005930": {
            "name": "삼성전자",
            "disclosures": [
              {
                "rcept_no": "20260605000123",
                "report_nm": "분기보고서 (2026.03)",
                "rcept_dt": "2026-06-05",
                "flr_nm": "삼성전자",
                "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260605000123",
                "category": "정기공시"
              },
              ...
            ]
          },
          ...
        },
        "failed": [...]
      }

운영 주기: 일 1회 권장 (공시 갱신 빈도). 사용자 PC(한국 IP) 에서 수동 실행.

호출량: 341 종목 × 1 호출 = 341 호출. 약 1~2분 소요.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from datetime import datetime, timedelta
from urllib.parse import urlencode
import urllib.request
import urllib.error

# === 경로 ===
REPO_ROOT             = Path(__file__).resolve().parent.parent
CORPCODE_JSON         = REPO_ROOT / "js" / "data" / "dart-corpcode.json"
CORPCODE_FULL_JSON    = REPO_ROOT / "js" / "data" / "dart-corpcode-full.json"
SYMBOLS_KR_EXTRA_JSON = REPO_ROOT / "js" / "data" / "symbols-kr-extra.json"
OUTPUT_JSON           = REPO_ROOT / "js" / "data" / "kr-disclosures.json"

# === 상수 ===
DART_BASE = "https://opendart.fss.or.kr"
REQ_INTERVAL_SEC = 0.12
RETRY_COUNT = 2
WINDOW_DAYS = 30   # 최근 30일 공시 수집


# === 공시 카테고리 분류 (report_nm 키워드 기반) ===
def categorize(report_nm: str) -> str:
    nm = report_nm.lower()
    if any(k in report_nm for k in ["사업보고서", "분기보고서", "반기보고서"]):
        return "정기공시"
    if "주요사항보고서" in report_nm:
        return "주요사항"
    if "주주총회" in report_nm:
        return "주주총회"
    if any(k in report_nm for k in ["배당", "주식배당"]):
        return "배당"
    if any(k in report_nm for k in ["증자", "감자", "합병", "분할"]):
        return "자본거래"
    if any(k in report_nm for k in ["공정공시", "수시공시"]):
        return "수시공시"
    return "기타"


def load_key() -> str | None:
    key = os.environ.get("DART_KEY")
    if not key:
        key_file = Path.home() / ".secrets" / "opendart_key"
        if key_file.exists():
            try:
                key = key_file.read_text(encoding="utf-8").strip()
            except Exception as e:
                print(f"키 파일 읽기 실패: {key_file} ({e})", file=sys.stderr)
    if not key:
        print(
            "OpenDART 키가 설정되지 않았습니다.\n"
            "  export DART_KEY=\"...\" 또는 ~/.secrets/opendart_key",
            file=sys.stderr,
        )
        sys.exit(2)
    return key


def load_corpmap() -> dict[str, str]:
    """fetch_dart_data.py 와 동일 패턴 — KOSPI200 + KOSDAQ150 통합 corpmap."""
    if not CORPCODE_JSON.exists():
        print(f"corpCode 매핑 파일이 없습니다: {CORPCODE_JSON}", file=sys.stderr)
        sys.exit(2)
    with CORPCODE_JSON.open(encoding="utf-8") as f:
        corpmap: dict[str, str] = json.load(f)

    if SYMBOLS_KR_EXTRA_JSON.exists() and CORPCODE_FULL_JSON.exists():
        with SYMBOLS_KR_EXTRA_JSON.open(encoding="utf-8") as f:
            extra = json.load(f)
        with CORPCODE_FULL_JSON.open(encoding="utf-8") as f:
            full = json.load(f)
        by_ticker = full.get("byTicker", {})
        for s in extra.get("symbols", []):
            t = s.get("ticker")
            if not t or t in corpmap: continue
            cc = (by_ticker.get(t, {}) or {}).get("corp_code")
            if cc: corpmap[t] = cc

    print(f"[corpmap] 총 {len(corpmap)} 종", file=sys.stderr)
    return corpmap


def name_lookup() -> dict[str, str]:
    """ticker → nameKr 매핑 (symbols-kr-extra 우선, full byTicker fallback)."""
    names: dict[str, str] = {}
    if CORPCODE_FULL_JSON.exists():
        with CORPCODE_FULL_JSON.open(encoding="utf-8") as f:
            full = json.load(f)
        for t, e in (full.get("byTicker") or {}).items():
            nm = (e or {}).get("nameKr")
            if nm: names[t] = nm
    return names


def dart_get(path: str, params: dict) -> dict | None:
    url = DART_BASE + path + "?" + urlencode(params)
    last_err = None
    for attempt in range(RETRY_COUNT + 1):
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                if resp.status != 200:
                    last_err = f"HTTP {resp.status}"
                    continue
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_err = str(e)
            time.sleep(0.5 * (attempt + 1))
    print(f"  ! {path} 실패: {last_err}", file=sys.stderr)
    return None


def fetch_disclosures_for(corp_code: str, key: str, bgn_de: str, end_de: str) -> list[dict] | None:
    """종목별 공시 목록. 최대 100건/페이지 (충분)."""
    res = dart_get("/api/list.json", {
        "crtfc_key": key,
        "corp_code": corp_code,
        "bgn_de": bgn_de,
        "end_de": end_de,
        "page_count": 100,
        "page_no": 1,
    })
    if not res: return None
    status = res.get("status")
    # status: "000" 정상, "013" 조회 결과 없음
    if status not in ("000", "013"):
        print(f"  ! corp={corp_code}: status={status} message={res.get('message')}", file=sys.stderr)
        return None
    return res.get("list", []) or []


def normalize_one(d: dict) -> dict:
    rcept_no = d.get("rcept_no", "")
    rcept_dt = d.get("rcept_dt", "")
    # YYYYMMDD → YYYY-MM-DD
    if len(rcept_dt) == 8:
        rcept_dt = f"{rcept_dt[:4]}-{rcept_dt[4:6]}-{rcept_dt[6:]}"
    report_nm = d.get("report_nm", "")
    return {
        "rcept_no": rcept_no,
        "report_nm": report_nm,
        "rcept_dt": rcept_dt,
        "flr_nm": d.get("flr_nm", ""),
        "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}" if rcept_no else "",
        "category": categorize(report_nm),
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

    # 1. 성공률 ≥ 98%
    if n_total == 0 or n_ok / n_total < 0.98:
        return False, f"성공률 {n_ok}/{n_total} ({n_ok/max(n_total,1)*100:.1f}%) < 98%"

    # 2. 절대 종목 수 (KOSPI200 + KOSDAQ150 = 341 기준 ≥ 336)
    if n_ok < 336:
        return False, f"성공 종목 {n_ok} < 336"

    # 3. 핵심 5종 모두 data 키에 존재 (활동 없으면 공시 0건 가능 — 키 존재만)
    KEY = ["005930", "000660", "247540", "263750", "041510"]
    missing = [t for t in KEY if t not in result["data"]]
    if missing:
        return False, f"핵심 종목 누락: {missing}"

    # 4. 파일 크기 ≥ 700 KB
    if size_kb < 700:
        return False, f"파일 크기 {size_kb:.0f} KB < 700 KB"

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
    key = load_key()
    corpmap = load_corpmap()
    names = name_lookup()

    today = datetime.now()
    bgn = (today - timedelta(days=WINDOW_DAYS)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")
    print(f"기간: {bgn} ~ {end} ({WINDOW_DAYS}일)", file=sys.stderr)

    tickers = sorted(corpmap.keys())
    data: dict[str, dict] = {}
    failed: list[str] = []

    for i, t in enumerate(tickers, 1):
        corp = corpmap[t]
        print(f"[{i:3}/{len(tickers)}] {t} ({corp}) ... ", end="", flush=True)
        raw = fetch_disclosures_for(corp, key, bgn, end)
        if raw is None:
            print("실패")
            failed.append(t)
            time.sleep(REQ_INTERVAL_SEC)
            continue
        normalized = [normalize_one(d) for d in raw]
        data[t] = {
            "name": names.get(t, ""),
            "disclosures": normalized,
        }
        print(f"OK ({len(normalized)} 건)")
        time.sleep(REQ_INTERVAL_SEC)

    result = {
        "generatedAt": today.isoformat(timespec="seconds"),
        "windowDays": WINDOW_DAYS,
        "tickerCount": len(data),
        "data": data,
        "failed": failed,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    size_kb = OUTPUT_JSON.stat().st_size // 1024
    print(f"\n저장: {OUTPUT_JSON} ({size_kb} KB)")
    print(f"성공: {len(data)}, 실패: {len(failed)}")

    ok, reason = _validate(result, OUTPUT_JSON)
    if not ok:
        print(f"\n[검증 실패] {reason}", file=sys.stderr)
        _notify("❌ DART 공시 갱신 실패", reason, ok=False)
        return 1

    print(f"\n[검증 통과] {reason}")

    # 자동 푸시 분기 (--auto-push 일 때만)
    if args.auto_push:
        subj = f"chore(data): kr-disclosures 자동 갱신 — {reason}"
        push_ok, push_msg = _auto_push(OUTPUT_JSON, subj)
        if push_ok:
            if push_msg == "변경 없음 (스킵)":
                _notify("✅ kr-disclosures 갱신 통과 (변경 없음)", reason, ok=True)
            else:
                _notify("🚀 kr-disclosures 자동 푸시 완료", f"{reason} | {push_msg}", ok=True)
            return 0
        else:
            print(f"\n[푸시 실패] {push_msg}", file=sys.stderr)
            _notify("⚠ kr-disclosures 갱신 통과, 푸시 실패", push_msg, ok=False)
            return 1
    else:
        _notify("✅ DART 공시 갱신 통과", f"{reason}. 수동 푸시 가능.", ok=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
