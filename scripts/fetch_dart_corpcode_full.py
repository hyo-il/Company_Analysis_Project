#!/usr/bin/env python3
"""
OpenDART corpCode.xml → dart-corpcode-full.json 생성.

용도:
    검색 화면에서 SYMBOLS 마스터에 없는 한국 종목을 즉시 lookup 하기 위한 사전 매핑.
    상장사(증권신고서 stock_code 가 있는 회사)만 추출.

사용:
    export DART_KEY="$(cat ~/.secrets/opendart_key)"
    python3 scripts/fetch_dart_corpcode_full.py
    → js/data/dart-corpcode-full.json 생성 (repo: CA_Project/scripts 에서 실행)

출력 형식:
    {
      "generatedAt": "2026-06-05T12:00:00",
      "count": 2543,
      "byTicker": {
        "005930": { "corp_code": "00126380", "nameKr": "삼성전자", "nameEn": "Samsung Electronics", "market": "kr" },
        ...
      },
      "byName": {
        "삼성전자": "005930",
        "samsung electronics": "005930",
        ...
      }
    }
"""
from __future__ import annotations

import json
import os
import sys
import zipfile
import io
import urllib.request
import urllib.error
from pathlib import Path
from xml.etree import ElementTree as ET
from datetime import datetime

REPO_ROOT = Path(__file__).resolve().parent.parent  # CA_Project/ (git repo root)
OUTPUT_JSON = REPO_ROOT / "js" / "data" / "dart-corpcode-full.json"
LOCAL_XML = REPO_ROOT / "CORPCODE.xml"  # 사용자가 미리 받아두면 그것 사용 (CA_Project/CORPCODE.xml)

DART_BASE = "https://opendart.fss.or.kr"


def load_key() -> str | None:
    key = os.environ.get("DART_KEY") or os.environ.get("CRTFC_KEY")
    if key:
        return key.strip()
    key_file = Path.home() / ".secrets" / "opendart_key"
    if key_file.exists():
        try:
            return key_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return None


def download_corpcode_zip(key: str) -> bytes:
    """OpenDART 에서 corpCode.zip 다운로드. (약 1MB)"""
    url = f"{DART_BASE}/api/corpCode.xml?crtfc_key={key}"
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def parse_corpcode_xml(xml_bytes: bytes) -> list[dict]:
    """corpCode XML 에서 모든 회사 정보 파싱."""
    root = ET.fromstring(xml_bytes)
    out: list[dict] = []
    for el in root.findall(".//list"):
        out.append({
            "corp_code": (el.findtext("corp_code") or "").strip(),
            "corp_name": (el.findtext("corp_name") or "").strip(),
            "corp_eng_name": (el.findtext("corp_eng_name") or "").strip(),
            "stock_code": (el.findtext("stock_code") or "").strip(),
        })
    return out


def main() -> int:
    key = load_key()
    if not key and not LOCAL_XML.exists():
        print(
            "OpenDART 키 또는 로컬 CORPCODE.xml 둘 다 없습니다.\n"
            "  방법 1) 키 환경변수: export DART_KEY=\"...\"\n"
            "  방법 2) 키 파일: ~/.secrets/opendart_key (chmod 600)\n"
            "  방법 3) CORPCODE.xml 을 CompanyAnalysis/ 루트에 두기",
            file=sys.stderr,
        )
        return 2

    # XML 확보: 로컬 우선, 없으면 다운로드
    if LOCAL_XML.exists():
        print(f"로컬 XML 사용: {LOCAL_XML}")
        with open(LOCAL_XML, "rb") as f:
            xml_bytes = f.read()
    else:
        print("OpenDART 에서 corpCode.zip 다운로드 중...")
        try:
            zip_bytes = download_corpcode_zip(key)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f"다운로드 실패: {e}", file=sys.stderr)
            return 2
        # zip 안의 CORPCODE.xml 추출
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            xml_name = next((n for n in names if n.upper().endswith("CORPCODE.XML")), None)
            if not xml_name:
                print(f"zip 안에 CORPCODE.xml 없음. 내용: {names}", file=sys.stderr)
                return 2
            xml_bytes = zf.read(xml_name)
        print(f"  다운로드 + 압축 해제 완료 ({len(xml_bytes)//1024} KB)")

    # 파싱
    companies = parse_corpcode_xml(xml_bytes)
    print(f"파싱: 전체 {len(companies)} 회사")

    # 상장사만 (stock_code 가 6자리)
    listed = [c for c in companies if c["stock_code"] and len(c["stock_code"]) == 6]
    print(f"상장사: {len(listed)}")

    # 출력 구조
    by_ticker: dict[str, dict] = {}
    by_name: dict[str, str] = {}

    for c in listed:
        ticker = c["stock_code"]
        name_kr = c["corp_name"]
        name_en = c["corp_eng_name"] or name_kr
        by_ticker[ticker] = {
            "corp_code": c["corp_code"],
            "nameKr": name_kr,
            "nameEn": name_en,
            "market": "kr",
        }
        # 이름 → ticker 역인덱스 (소문자·트림). 동일 이름 중복 시 먼저 들어온 것 유지.
        for key in (name_kr.strip().lower(), name_en.strip().lower()):
            if key and key not in by_name:
                by_name[key] = ticker

    result = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "count": len(by_ticker),
        "byTicker": by_ticker,
        "byName": by_name,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장: {OUTPUT_JSON} ({OUTPUT_JSON.stat().st_size // 1024} KB, {len(by_ticker)} 종목)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
