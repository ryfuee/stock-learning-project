#!/usr/bin/env python3
import argparse
import contextlib
import datetime as dt
import json
import sys


def _clean_number(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _to_bs_code(code):
    text = str(code).strip()
    if text.startswith(("sh.", "sz.")):
        return text
    return f"sh.{text}" if text.startswith("6") else f"sz.{text}"


def _to_plain_code(code):
    text = str(code).strip()
    if "." in text:
        return text.split(".")[-1]
    return text


def _row_to_bar(row):
    return {
        "date": row.get("date", ""),
        "open": _clean_number(row.get("open")),
        "high": _clean_number(row.get("high")),
        "low": _clean_number(row.get("low")),
        "close": _clean_number(row.get("close")),
        "volume": _clean_number(row.get("volume")),
        "amount": _clean_number(row.get("amount")),
        "pctChg": _clean_number(row.get("pctChg")),
    }


def _valid_bar(bar):
    return bool(bar["date"] and bar["open"] and bar["high"] and bar["low"] and bar["close"])


def fetch_baostock(codes, indexes, start, end):
    result = {"ok": True, "source": "Baostock", "series": {}, "indexes": {}, "warnings": []}
    with contextlib.redirect_stdout(sys.stderr):
        import baostock as bs

        login = bs.login()
    if getattr(login, "error_code", "0") != "0":
        raise RuntimeError(f"Baostock login failed: {getattr(login, 'error_msg', '')}")

    def query_one(code, is_index=False):
        bs_code = _to_bs_code(code)
        fields = "date,code,open,high,low,close,volume,amount,pctChg"
        with contextlib.redirect_stdout(sys.stderr):
            rs = bs.query_history_k_data_plus(
                bs_code,
                fields,
                start_date=start,
                end_date=end,
                frequency="d",
                adjustflag="3" if is_index else "2",
            )
        if getattr(rs, "error_code", "0") != "0":
            result["warnings"].append(f"{code} query failed: {getattr(rs, 'error_msg', '')}")
            return []
        rows = []
        while rs.next():
            bar = _row_to_bar(dict(zip(rs.fields, rs.get_row_data())))
            if _valid_bar(bar):
                rows.append(bar)
        if not rows:
            result["warnings"].append(f"{code} returned no bars")
        return rows

    try:
        for code in codes:
            result["series"][_to_plain_code(code)] = query_one(code, False)
        for code in indexes:
            result["indexes"][code] = query_one(code, True)
    finally:
        with contextlib.redirect_stdout(sys.stderr):
            bs.logout()
    return result


def fetch_akshare(codes, start, end):
    result = {"ok": True, "source": "AKShare", "series": {}, "indexes": {}, "warnings": []}
    import akshare as ak

    start_compact = start.replace("-", "")
    end_compact = end.replace("-", "")
    for code in codes:
        try:
            df = ak.stock_zh_a_hist(symbol=_to_plain_code(code), period="daily", start_date=start_compact, end_date=end_compact, adjust="qfq")
            rows = []
            for _, row in df.iterrows():
                bar = {
                    "date": str(row.get("日期", ""))[:10],
                    "open": _clean_number(row.get("开盘")),
                    "high": _clean_number(row.get("最高")),
                    "low": _clean_number(row.get("最低")),
                    "close": _clean_number(row.get("收盘")),
                    "volume": _clean_number(row.get("成交量")),
                    "amount": _clean_number(row.get("成交额")),
                    "pctChg": _clean_number(row.get("涨跌幅")),
                }
                if _valid_bar(bar):
                    rows.append(bar)
            result["series"][_to_plain_code(code)] = rows
            if not rows:
                result["warnings"].append(f"{code} returned no bars")
        except Exception as exc:
            result["warnings"].append(f"{code} AKShare failed: {exc}")
            result["series"][_to_plain_code(code)] = []
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codes", default="")
    parser.add_argument("--indexes", default="sh.000300,sh.000001,sz.399006")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--provider", default="auto", choices=["auto", "baostock", "akshare"])
    args = parser.parse_args()

    codes = [item.strip() for item in args.codes.split(",") if item.strip()]
    indexes = [item.strip() for item in args.indexes.split(",") if item.strip()]
    if not codes:
        raise RuntimeError("codes is empty")

    errors = []
    if args.provider in {"auto", "baostock"}:
        try:
            print(json.dumps(fetch_baostock(codes, indexes, args.start, args.end), ensure_ascii=False))
            return
        except Exception as exc:
            errors.append(f"Baostock failed: {exc}")
            if args.provider == "baostock":
                raise

    if args.provider in {"auto", "akshare"}:
        try:
            data = fetch_akshare(codes, args.start, args.end)
            data["warnings"] = errors + data.get("warnings", [])
            print(json.dumps(data, ensure_ascii=False))
            return
        except Exception as exc:
            errors.append(f"AKShare failed: {exc}")
            if args.provider == "akshare":
                raise

    print(json.dumps({"ok": False, "source": "none", "series": {}, "indexes": {}, "warnings": errors}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "source": "none", "series": {}, "indexes": {}, "warnings": [str(exc)]}, ensure_ascii=False))
        sys.exit(1)
