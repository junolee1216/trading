from datetime import date, datetime, timedelta
from pathlib import Path
import json
import re

import FinanceDataReader as fdr
import requests
from bs4 import BeautifulSoup


APP_DIR = Path(__file__).resolve().parents[1]
DATA_JS = APP_DIR / "data.js"
INDEX_HTML = APP_DIR / "index.html"

STOCKS = [
    ("005930", "삼성전자", "KOSPI", "반도체"),
    ("000660", "SK하이닉스", "KOSPI", "반도체"),
    ("373220", "LG에너지솔루션", "KOSPI", "2차전지"),
    ("207940", "삼성바이오로직스", "KOSPI", "바이오"),
    ("005380", "현대차", "KOSPI", "자동차"),
    ("000270", "기아", "KOSPI", "자동차"),
    ("068270", "셀트리온", "KOSPI", "바이오"),
    ("035420", "NAVER", "KOSPI", "인터넷"),
    ("035720", "카카오", "KOSPI", "인터넷"),
    ("005490", "POSCO홀딩스", "KOSPI", "철강"),
    ("051910", "LG화학", "KOSPI", "화학"),
    ("006400", "삼성SDI", "KOSPI", "2차전지"),
    ("105560", "KB금융", "KOSPI", "금융"),
    ("055550", "신한지주", "KOSPI", "금융"),
    ("086790", "하나금융지주", "KOSPI", "금융"),
    ("012330", "현대모비스", "KOSPI", "자동차부품"),
    ("028260", "삼성물산", "KOSPI", "지주"),
    ("066570", "LG전자", "KOSPI", "전자"),
    ("096770", "SK이노베이션", "KOSPI", "에너지"),
    ("323410", "카카오뱅크", "KOSPI", "금융"),
    ("259960", "크래프톤", "KOSPI", "게임"),
    ("034020", "두산에너빌리티", "KOSPI", "기계"),
    ("012450", "한화에어로스페이스", "KOSPI", "방산"),
    ("329180", "HD현대중공업", "KOSPI", "조선"),
    ("017670", "SK텔레콤", "KOSPI", "통신"),
    ("030200", "KT", "KOSPI", "통신"),
    ("003670", "포스코퓨처엠", "KOSPI", "2차전지"),
    ("247540", "에코프로비엠", "KOSDAQ", "2차전지"),
    ("086520", "에코프로", "KOSDAQ", "2차전지"),
    ("196170", "알테오젠", "KOSDAQ", "바이오"),
    ("028300", "HLB", "KOSDAQ", "바이오"),
    ("035900", "JYP Ent.", "KOSDAQ", "엔터"),
]

HEADERS = {"User-Agent": "Mozilla/5.0"}


def to_num(text):
    if text is None:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", str(text))
    if cleaned in {"", "-", ".", "-."}:
        return None
    return float(cleaned) if "." in cleaned else int(cleaned)


def number_values(text):
    values = []
    for token in re.findall(r"[-+]?[0-9][0-9,]*(?:\.[0-9]+)?", text):
        try:
            values.append(float(token.replace(",", "")))
        except ValueError:
            pass
    return values


def parse_per_table(soup):
    per = pbr = dividend = None
    for row in soup.select("table.per_table tr"):
        text = row.get_text(" ", strip=True)
        values = number_values(text)
        if not values:
            continue
        if text.startswith("PER") and per is None:
            per = values[-2] if len(values) >= 2 else values[-1]
        elif text.startswith("PBR") and pbr is None:
            pbr = values[-2] if len(values) >= 2 else values[-1]
        elif text.startswith("배당수익률") and dividend is None:
            dividend = values[-1]
    return per, pbr, dividend


def parse_company_info(soup):
    rows = [row.get_text(" ", strip=True) for row in soup.select("#tab_con1 table tr")]
    market_cap = foreign_ratio = week_high = week_low = None
    for row in rows:
        if row.startswith("시가총액 "):
            market_cap = (
                re.sub(r"\s+", " ", row.replace("원", ""))
                .strip()
                .replace("시가총액 ", "")
                .replace("억원", "억")
            )
        elif "외국인소진율" in row:
            percentages = re.findall(r"([0-9]+(?:\.[0-9]+)?)%", row)
            if percentages:
                foreign_ratio = float(percentages[-1])
        elif "52주최고" in row:
            values = [int(value.replace(",", "")) for value in re.findall(r"[0-9,]+", row)]
            if len(values) >= 2:
                week_high, week_low = values[-2], values[-1]
    return market_cap, foreign_ratio, week_high, week_low


def read_naver_stock(code, fallback_name, market, sector):
    response = requests.get(
        f"https://finance.naver.com/item/main.naver?code={code}",
        headers=HEADERS,
        timeout=15,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    name_node = soup.select_one(".wrap_company h2")
    name = name_node.get_text(strip=True) if name_node else fallback_name

    price_node = soup.select_one("p.no_today .blind")
    price = to_num(price_node.get_text(strip=True) if price_node else None)

    exday = soup.select_one("p.no_exday")
    rate_blinds = [node.get_text(strip=True) for node in soup.select("p.no_exday .blind")]
    rate = to_num(rate_blinds[1]) if len(rate_blinds) > 1 else None
    sign = -1 if exday and exday.select_one("em.no_down") else 1
    rate = round(sign * abs(rate), 2) if rate is not None else 0

    info_values = [node.get_text(strip=True) for node in soup.select("table.no_info .blind")]
    high = to_num(info_values[1]) if len(info_values) > 1 else None
    volume = to_num(info_values[3]) if len(info_values) > 3 else None
    low = to_num(info_values[5]) if len(info_values) > 5 else None

    per, pbr, dividend = parse_per_table(soup)
    market_cap, foreign_ratio, week_high, week_low = parse_company_info(soup)

    start = (date.today() - timedelta(days=430)).isoformat()
    end = date.today().isoformat()
    history = fdr.DataReader(code, start, end).dropna()
    closes = [int(value) for value in history["Close"].tail(60).tolist()]
    volumes = [int(value) for value in history["Volume"].tail(60).tolist()]

    if closes and price:
        closes[-1] = int(price)
    if volumes and volume:
        volumes[-1] = int(volume)

    avg_volume20 = int(sum(volumes[-20:]) / min(20, len(volumes))) if volumes else int(volume or 0)

    if not week_high or not week_low:
        week = history.tail(252)
        week_high = int(week["High"].max()) if len(week) else int(high or price)
        week_low = int(week["Low"].min()) if len(week) else int(low or price)

    today_label = date.today().isoformat()
    return {
        "code": code,
        "name": name,
        "market": market,
        "sector": sector,
        "price": int(price or closes[-1]),
        "changeRate": rate,
        "volume": int(volume or 0),
        "avgVolume20": avg_volume20,
        "marketCap": market_cap or "확인 필요",
        "weekHigh": int(week_high),
        "weekLow": int(week_low),
        "updatedAt": f"{today_label} 네이버 증권 기준",
        "fundamentals": {
            "per": per,
            "pbr": pbr,
            "roe": None,
            "revenueGrowth": None,
            "opGrowth": None,
            "netGrowth": None,
            "debtRatio": None,
            "opMargin": None,
            "dividendYield": dividend,
            "foreignRatio": foreign_ratio,
        },
        "sectorAverage": {
            "per": None,
            "pbr": None,
            "roe": None,
            "revenueGrowth": None,
            "opGrowth": None,
            "netGrowth": None,
            "debtRatio": None,
            "opMargin": None,
            "dividendYield": None,
        },
        "flows": {
            "available": False,
            "individual": {"d1": 0, "d5": 0, "d20": 0},
            "foreign": {"d1": 0, "d5": 0, "d20": 0},
            "institution": {"d1": 0, "d5": 0, "d20": 0},
        },
        "news": [],
        "disclosures": [],
        "backtest": {
            "period": "전략 데이터 연결 전",
            "buyRule": "전략 조건 설정 필요",
            "sellRule": "전략 조건 설정 필요",
            "returnRate": None,
            "mdd": None,
            "winRate": None,
            "holdingDays": None,
            "excessReturn": None,
        },
        "prices": closes,
        "volumes": volumes,
    }


def market_data():
    end = date.today().isoformat()
    kospi = fdr.DataReader("KS11", (date.today() - timedelta(days=40)).isoformat(), end).dropna().tail(1).iloc[0]
    kosdaq = fdr.DataReader("KQ11", (date.today() - timedelta(days=40)).isoformat(), end).dropna().tail(1).iloc[0]
    fx = fdr.DataReader("USD/KRW", (date.today() - timedelta(days=45)).isoformat(), end).dropna()
    usdkrw = float(fx["Close"].tail(1).iloc[0])
    usdkrw_prev = float(fx["Close"].tail(2).iloc[0]) if len(fx) > 1 else usdkrw

    return {
        "kospi": {
            "level": round(float(kospi["Close"]), 2),
            "changeRate": round(float(kospi["Change"]) * 100, 2),
            "trend": "weak" if float(kospi["Change"]) < 0 else "neutral",
            "turnover": "지수 데이터 확인",
        },
        "kosdaq": {
            "level": round(float(kosdaq["Close"]), 2),
            "changeRate": round(float(kosdaq["Change"]) * 100, 2),
            "trend": "weak" if float(kosdaq["Change"]) < 0 else "neutral",
            "turnover": "지수 데이터 확인",
        },
        "usdkrw": {
            "value": round(usdkrw, 2),
            "change": round(usdkrw - usdkrw_prev, 2),
            "signal": "확인 필요",
        },
        "baseRate": {"value": None, "signal": "금리 데이터 미연결"},
        "sentiment": "개별 종목 가격은 네이버 증권 종목 페이지 기준이며, 시장 지수와 환율은 FinanceDataReader 조회 기준입니다.",
    }


def update_index_cache_buster(version):
    html = INDEX_HTML.read_text(encoding="utf-8")
    html = re.sub(r'data\.js\?v=[^"]+', f"data.js?v={version}", html)
    INDEX_HTML.write_text(html, encoding="utf-8")


def refresh():
    stocks = [read_naver_stock(*entry) for entry in STOCKS]
    today_label = date.today().isoformat()
    data = {
        "updatedAt": f"{today_label} 네이버 증권/FinanceDataReader 조회 기준",
        "market": market_data(),
        "stocks": stocks,
    }
    DATA_JS.write_text(
        "window.KR_STOCK_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    version = "data-" + datetime.now().strftime("%Y%m%d%H%M%S")
    update_index_cache_buster(version)
    return data


if __name__ == "__main__":
    refreshed = refresh()
    for stock in refreshed["stocks"]:
        print(f"{stock['code']} price={stock['price']:,} change={stock['changeRate']}%")
