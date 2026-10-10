"""对公开问卷统计执行人数、百分比和口径复核。

输入：正常浏览器读取的两份公开统计页面文本。
输出：逐题结构化统计及关键判断的复算结果（JSON）。
原理：公开汇总只支持边际分布核对，不能替代逐条答卷的去重或交叉分析。
"""

import json
from pathlib import Path
import re


CASE_DIR = Path(__file__).resolve().parents[1]
OUTPUT = CASE_DIR / "reproduced"
PAGE_DIR = CASE_DIR / "data" / "public-summaries"


def parse_report(name):
    """提取页面实际列出的题号、题型、选项人数和分母。"""
    text = (PAGE_DIR / f"{name}.txt").read_text(encoding="utf-8")
    starts = list(re.finditer(r"第(\d+)题：", text))
    questions = {}
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        block = text[match.end():end]
        denominator = re.search(r"本题有效填写人次\s+(\d+)", block)
        rows = []
        for option, count, percent in re.findall(
            r"([^\n\t]+)\t(\d+)\t\s*([\d.]+)%", block
        ):
            rows.append({
                "option": option.strip(), "count": int(count),
                "display_percent": float(percent),
            })
        kind = "多选" if "[多选题]" in block else (
            "单选" if "[单选题]" in block else "开放／说明"
        )
        base = int(denominator.group(1)) if denominator else None
        if rows:
            if base is None:
                raise ValueError(f"{name}第{match.group(1)}题缺分母")
            # 显示比例可能只有一位或两位小数；人数是复算的基础。
            for row in rows:
                if abs(row["count"] / base * 100 - row["display_percent"]) > 0.011:
                    raise ValueError("人数与公开显示比例不符")
                if row["count"] > base:
                    raise ValueError("选项人数超过分母")
            if kind == "单选" and sum(row["count"] for row in rows) != base:
                raise ValueError("单选总人数不等于分母")
        questions[int(match.group(1))] = {
            "question_type": kind, "denominator": base, "options": rows,
        }
    return questions


def count(questions, number, label):
    """根据实际选项标签取人数，避免用百分比反推人数。"""
    matches = [row["count"] for row in questions[number]["options"]
               if row["option"] == label]
    if len(matches) != 1:
        raise ValueError(f"第{number}题的标签匹配不唯一：{label}")
    return matches[0]


def main():
    """复算固定公开快照，另存新结果，不覆盖归档证据。"""
    OUTPUT.mkdir(parents=True, exist_ok=True)
    exploratory = parse_report("report-155")
    supplemental = parse_report("report-100")
    paid = count(exploratory, 9, "A.已开户并存入资金")
    unpaid = count(exploratory, 9, "B.已开户，暂未存钱")
    thinking = count(supplemental, 9, "考虑过，但没有进一步查资料或咨询")
    consulting = count(supplemental, 9, "查过资料或咨询过，但没有尝试办理")
    operational = sum(count(supplemental, 9, label) for label in [
        "找过缴存入口，但没有找到或没弄清怎么操作",
        "进入过缴存操作，但没有完成", "尝试提交或支付，但没有成功",
    ])
    needs_steps = count(supplemental, 16, "找到缴存入口并弄清步骤")
    union_counts = [count(supplemental, 12, label) for label in [
        "暂时没有可用于长期安排的闲钱", "近期有其他必要支出，资金另有用途",
        "不愿让这笔钱长期受到领取条件限制",
    ]]
    checks = {
        "unpaid_among_opened": {
            "numerator": unpaid, "denominator": paid + unpaid,
            "percent": unpaid / (paid + unpaid) * 100,
        },
        "unpaid_among_all": {
            "numerator": unpaid, "denominator": 155,
            "percent": unpaid / 155 * 100,
        },
        "supplemental_judgment_stage": thinking + consulting,
        "supplemental_operational_stage": operational,
        "q9_operational_and_q16_needs_steps_possible_overlap": [
            max(0, operational + needs_steps - 100),
            min(operational, needs_steps),
        ],
        "q12_three_fund_or_locking_options_possible_union": [
            max(union_counts), min(100, sum(union_counts)),
        ],
        "self_reported_no_bank_change": count(supplemental, 6, "没有"),
        "reported_bank_change": count(supplemental, 6, "有"),
        "bank_change_unknown": count(supplemental, 6, "不确定"),
        "note": "Possible ranges are logical bounds, not statistical intervals.",
    }
    assert paid == 16 and unpaid == 38
    assert checks["supplemental_judgment_stage"] == 49
    assert checks["supplemental_operational_stage"] == 32
    assert checks["q9_operational_and_q16_needs_steps_possible_overlap"] == [0, 30]
    result = {
        "sources": {
            "exploratory": "https://www.wjx.cn/report/384208131.aspx",
            "supplemental": "https://www.wjx.cn/report/387277515.aspx",
        },
        "scope": "Public aggregates only; no respondent-level export available",
        "exploratory_questions": exploratory,
        "supplemental_questions": supplemental,
        "recomputed_metrics": checks,
    }
    (OUTPUT / "问卷公开统计-核验结果.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    summary = {
        "exploratory_items": len(exploratory),
        "supplemental_items": len(supplemental),
        "choice_tables_checked": sum(bool(q["options"])
                                     for q in [*exploratory.values(), *supplemental.values()]),
        "recomputed_metrics": checks,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
