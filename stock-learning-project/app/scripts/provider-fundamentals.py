#!/usr/bin/env python3
import datetime as _dt
import contextlib
import json
import os
import sys


def _json_default(value):
    try:
        import math

        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
    except Exception:
        pass
    try:
        return value.item()
    except Exception:
        return str(value)


def _clean(value):
    if value is None:
        return ""
    try:
        if hasattr(value, "item"):
            value = value.item()
    except Exception:
        pass
    if isinstance(value, bool):
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "none", "null", "--", "false", "true"}:
        return ""
    return text


def _latest_record(df):
    if df is None or getattr(df, "empty", True):
        return {}
    return {str(k): _clean(v) for k, v in df.iloc[0].to_dict().items()}


def _add_metric(metrics, name, value, period="", source=""):
    text = _clean(value)
    if not text:
        return
    metrics.append({"name": name, "value": text, "period": _clean(period), "source": source})


def _period_from_row(row):
    for key in ["报告期", "REPORT_DATE", "REPORT_DATE_NAME", "date", "statDate", "pubDate", "end_date", "ann_date"]:
        value = _clean(row.get(key))
        if value:
            return value.replace(" 00:00:00", "")
    return ""


def _metric_by_keywords(row, metrics, label, keywords, source):
    lowered = [(key, key.lower()) for key in row.keys()]
    for keyword in keywords:
        keyword_lower = keyword.lower()
        for key, lower in lowered:
            if keyword_lower in lower:
                _add_metric(metrics, label, row.get(key), _period_from_row(row), source)
                return


def _to_ts_code(code):
    return f"{code}.SH" if str(code).startswith("6") else f"{code}.SZ"


def _to_baostock_code(code):
    return f"sh.{code}" if str(code).startswith("6") else f"sz.{code}"


def _to_em_code(code):
    return f"{code}.SH" if str(code).startswith("6") else f"{code}.SZ"


def _to_sina_stock(code):
    return f"sh{code}" if str(code).startswith("6") else f"sz{code}"


def _short(text, limit=180):
    value = _clean(text)
    if len(value) <= limit:
        return value
    return f"{value[:limit - 1]}…"


def _warning_summary(prefix, warnings):
    if not warnings:
        return prefix
    details = "; ".join(_short(item, 160) for item in warnings[-2:])
    return _short(f"{prefix}: {details}", 260)


def _call_frame(result, source, fn, **kwargs):
    try:
        df = fn(**kwargs)
        if df is not None and not getattr(df, "empty", True):
            return source, df
    except Exception as exc:
        result["warnings"].append(f"{source} failed: {exc}")
    return None


def _fetch_akshare(code):
    result = {"source": "AKShare", "metrics": [], "summary": [], "segments": [], "warnings": []}
    try:
        import akshare as ak
    except Exception as exc:
        return None, f"AKShare not installed: {exc}"

    try:
        if hasattr(ak, "stock_individual_info_em"):
            info = ak.stock_individual_info_em(symbol=code)
            for _, row in info.head(12).iterrows():
                key = _clean(row.get("item") or row.get("项目"))
                value = _clean(row.get("value") or row.get("值"))
                if key and value:
                    result["summary"].append(f"{key}: {value}")
    except Exception as exc:
        result["warnings"].append(f"individual_info failed: {exc}")

    financial_frames = []
    frame_specs = [
        ("stock_financial_analysis_indicator", {"symbol": code}),
        ("stock_financial_analysis_indicator_em", {"symbol": _to_em_code(code), "indicator": "按报告期"}),
        ("stock_financial_abstract", {"symbol": code}),
        ("stock_financial_abstract_ths", {"symbol": code, "indicator": "按报告期"}),
        ("stock_financial_abstract_new_ths", {"symbol": code, "indicator": "按报告期"}),
        ("stock_financial_report_sina_利润表", {"stock": _to_sina_stock(code), "symbol": "利润表"}),
    ]
    for source, kwargs in frame_specs:
        fn_name = source.split("_利润表")[0]
        fn = getattr(ak, fn_name, None)
        if not fn:
            continue
        frame = _call_frame(result, source, fn, **kwargs)
        if frame:
            financial_frames.append(frame)

    for source, df in financial_frames:
        row = _latest_record(df)
        if not row:
            continue
        _metric_by_keywords(row, result["metrics"], "ROE", ["roejq", "roe", "净资产收益率"], source)
        _metric_by_keywords(row, result["metrics"], "毛利率", ["xsmll", "gross", "销售毛利率", "毛利率", "mlr"], source)
        _metric_by_keywords(row, result["metrics"], "净利率", ["xsjll", "net profit margin", "销售净利率", "净利率"], source)
        _metric_by_keywords(row, result["metrics"], "营收同比", ["totaloperaterevetz", "djd_toi_yoy", "营业收入同比", "营业总收入同比", "revenue_yoy"], source)
        _metric_by_keywords(row, result["metrics"], "净利润同比", ["parentnetprofittz", "netprofitrphbzc", "djd_dpnp_yoy", "净利润同比", "归母净利润同比"], source)
        _metric_by_keywords(row, result["metrics"], "资产负债率", ["zcfzl", "资产负债率", "debt_to_assets"], source)
        _metric_by_keywords(row, result["metrics"], "每股收益", ["eps", "基本每股收益", "每股收益"], source)

    try:
        if hasattr(ak, "stock_zyjs_ths"):
            segments = ak.stock_zyjs_ths(symbol=code)
            for _, row in segments.head(5).iterrows():
                result["segments"].append({str(k): _clean(v) for k, v in row.to_dict().items() if _clean(v)})
    except Exception as exc:
        result["warnings"].append(f"segments failed: {exc}")

    if not result["metrics"] and not result["summary"] and not result["segments"]:
        return None, _warning_summary("AKShare returned no usable fundamentals", result["warnings"])
    return result, None


def _baostock_frame(rs):
    try:
        return rs.get_data()
    except Exception:
        return None


def _fetch_baostock(code, bs=None):
    result = {"source": "Baostock", "metrics": [], "summary": [], "segments": [], "warnings": []}
    try:
        if bs is None:
            import baostock as bs
    except Exception as exc:
        return None, f"Baostock not installed: {exc}"

    stock_code = _to_baostock_code(code)
    today = _dt.date.today()
    quarters = []
    for year_offset in range(0, 2):
        year = today.year - year_offset
        for quarter in [4, 3, 2, 1]:
            quarters.append((year, quarter))

    frames = []
    for year, quarter in quarters:
        try:
            profit = _baostock_frame(bs.query_profit_data(code=stock_code, year=year, quarter=quarter))
            if profit is not None and not profit.empty:
                frames.append(("baostock_profit", profit))
                break
        except Exception as exc:
            result["warnings"].append(f"profit failed: {exc}")

    for year, quarter in quarters[:4]:
        try:
            growth = _baostock_frame(bs.query_growth_data(code=stock_code, year=year, quarter=quarter))
            if growth is not None and not growth.empty:
                frames.append(("baostock_growth", growth))
                break
        except Exception as exc:
            result["warnings"].append(f"growth failed: {exc}")

    for source, df in frames:
        row = _latest_record(df)
        if not row:
            continue
        period = row.get("statDate") or row.get("pubDate") or ""
        _add_metric(result["metrics"], "ROE", row.get("roeAvg"), period, source)
        _add_metric(result["metrics"], "净利率", row.get("npMargin"), period, source)
        _add_metric(result["metrics"], "毛利率", row.get("gpMargin"), period, source)
        _add_metric(result["metrics"], "净利润同比", row.get("YOYNI"), period, source)
        _add_metric(result["metrics"], "营收同比", row.get("YOYEquity"), period, source)

    if not result["metrics"]:
        return None, "Baostock returned no usable fundamentals"
    return result, None


def _fetch_tushare(code, token):
    result = {"source": "Tushare", "metrics": [], "summary": [], "segments": [], "warnings": []}
    if not token:
        return None, "Tushare token missing"
    try:
        import tushare as ts
    except Exception as exc:
        return None, f"Tushare not installed: {exc}"

    try:
        ts.set_token(token)
        pro = ts.pro_api()
        df = pro.fina_indicator(ts_code=_to_ts_code(code), limit=4)
    except Exception as exc:
        return None, f"Tushare query failed: {exc}"

    row = _latest_record(df)
    if not row:
        return None, "Tushare returned no usable fundamentals"
    period = row.get("end_date") or row.get("ann_date") or ""
    _add_metric(result["metrics"], "ROE", row.get("roe"), period, "tushare_fina_indicator")
    _add_metric(result["metrics"], "ROA", row.get("roa"), period, "tushare_fina_indicator")
    _add_metric(result["metrics"], "毛利率", row.get("grossprofit_margin"), period, "tushare_fina_indicator")
    _add_metric(result["metrics"], "净利率", row.get("netprofit_margin"), period, "tushare_fina_indicator")
    _add_metric(result["metrics"], "营收同比", row.get("tr_yoy"), period, "tushare_fina_indicator")
    _add_metric(result["metrics"], "净利润同比", row.get("q_netprofit_yoy"), period, "tushare_fina_indicator")
    _add_metric(result["metrics"], "资产负债率", row.get("debt_to_assets"), period, "tushare_fina_indicator")
    _add_metric(result["metrics"], "每股收益", row.get("eps"), period, "tushare_fina_indicator")
    if not result["metrics"]:
        return None, "Tushare returned no usable metrics"
    return result, None


def main():
    codes = [item.strip() for item in os.environ.get("A_SHARE_PROVIDER_CODES", "").split(",") if item.strip()]
    enabled = {
        "akshare": os.environ.get("A_SHARE_ENABLE_AKSHARE") == "1",
        "baostock": os.environ.get("A_SHARE_ENABLE_BAOSTOCK") == "1",
        "tushare": os.environ.get("A_SHARE_ENABLE_TUSHARE") == "1",
    }
    token = os.environ.get("TUSHARE_TOKEN", "")
    output = {
        "ok": True,
        "providers": {
            name: {"enabled": flag, "available": False, "status": "disabled" if not flag else "pending"}
            for name, flag in enabled.items()
        },
        "results": {},
    }

    # Some providers, notably Baostock, print login/logout text to stdout.
    # Keep stdout JSON-only so the Node bridge can parse this script reliably.
    with contextlib.redirect_stdout(sys.stderr):
        bs = None
        baostock_logged_in = False
        if enabled["baostock"]:
            try:
                import baostock as bs_module

                bs = bs_module
                login = bs.login()
                baostock_logged_in = True
                output["providers"]["baostock"].update({"available": True, "status": _clean(getattr(login, "error_msg", "")) or "login"})
            except Exception as exc:
                output["providers"]["baostock"].update({"available": False, "status": f"not_available: {exc}"})

        try:
            for code in codes:
                entry = {"code": code, "fundamentals": None, "sourcesTried": [], "warnings": []}
                if enabled["akshare"]:
                    data, warning = _fetch_akshare(code)
                    entry["sourcesTried"].append("akshare")
                    if data:
                        output["providers"]["akshare"].update({"available": True, "status": "ok"})
                        entry["fundamentals"] = data
                        output["results"][code] = entry
                        continue
                    if warning:
                        output["providers"]["akshare"]["status"] = warning
                        entry["warnings"].append(warning)

                if enabled["baostock"] and bs is not None and baostock_logged_in:
                    data, warning = _fetch_baostock(code, bs=bs)
                    entry["sourcesTried"].append("baostock")
                    if data:
                        entry["fundamentals"] = data
                        output["results"][code] = entry
                        continue
                    if warning:
                        entry["warnings"].append(warning)

                if enabled["tushare"]:
                    data, warning = _fetch_tushare(code, token)
                    entry["sourcesTried"].append("tushare")
                    if data:
                        output["providers"]["tushare"].update({"available": True, "status": "ok"})
                        entry["fundamentals"] = data
                        output["results"][code] = entry
                        continue
                    if warning:
                        output["providers"]["tushare"]["status"] = warning
                        entry["warnings"].append(warning)

                output["results"][code] = entry
        finally:
            if baostock_logged_in and bs is not None:
                try:
                    bs.logout()
                except Exception:
                    pass

    print(json.dumps(output, ensure_ascii=False, default=_json_default))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
