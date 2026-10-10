"""核对许可测试底稿的虚构发送记录，输出逐笔结果和汇总。

输入：CSV，同日分钟数、执行状态和案例ID；输出：JSON及逐笔CSV。
原理：比较实际发送与撤回时刻，而非仅比较排队时刻。缺失不能算通过。
边界：假设入队前已有有效同渠道许可；不能验证真实许可、取消回执或银行控制。
"""

import argparse
import csv
from collections import Counter
import json
from pathlib import Path

CASE_ROOT = Path(__file__).resolve().parents[1]
FIELDS = ("case_id", "customer_id", "revoked_minute", "queued_minute",
          "sent_minute", "status")


def minute(value):
    """将空值转为None；合法分钟为0至1439的整数，异常值保留为证据问题。"""
    if value == "":
        return None
    if value is None:
        raise ValueError("CSV记录字段不完整")
    number = int(value)
    if not 0 <= number <= 1439:
        raise ValueError("时间不在同日分钟范围内")
    return number


def audit_rows(rows):
    """输入记录列表，输出原字段加分类及原因；保留全部记录，不静默去重。"""
    counts = Counter(row["case_id"] for row in rows)
    results = []
    for row in rows:
        code, reason = "EVIDENCE_GAP", ""
        try:
            revoked, queued, sent = (minute(row[key]) for key in FIELDS[2:5])
            if not row["case_id"] or not row["customer_id"]:
                reason = "缺案例或客户标识"
            elif counts[row["case_id"]] > 1:
                reason = "案例ID重复，需确认重发或重复导出；不能自行删行"
            elif queued is None:
                reason = "缺排队时间，无法核对记录序列"
            elif sent is not None and sent < queued:
                reason = "发送早于排队，时间序列冲突"
            elif row["status"] == "已取消" and sent is not None:
                reason = "取消状态与发送时间冲突，需回执核验"
            elif row["status"] == "已取消":
                code, reason = "CANCELLED_NOT_SENT", "记录显示取消；取消回执仍需另取证"
            elif row["status"] != "已发送":
                reason = "未知执行状态"
            elif sent is None:
                reason = "已发送但缺发送时刻，不能判定符合"
            elif revoked is not None and sent >= revoked:
                code = "CONTROL_FAILURE"
                reason = "发送发生在撤回同分钟或之后；演示按撤回已生效处理"
            else:
                code = "NO_EXCEPTION_IN_DEMO"
                reason = "演示时间比较未见例外；前置有效许可尚未独立验证"
        except ValueError as error:
            reason = "时间字段无效：" + str(error)
        results.append({**row, "classification": code, "reason": reason})
    return results


def main():
    """读取CSV，检查字段后输出；拒绝结构缺列，避免生成误导性结果。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path,
                        default=CASE_ROOT / "data/synthetic/permission-cases.csv")
    parser.add_argument("--output", type=Path,
                        default=CASE_ROOT / "reproduced/permission-audit")
    args = parser.parse_args()
    with args.input.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not set(FIELDS).issubset(reader.fieldnames or []):
            parser.error("CSV缺少字段：" + ", ".join(FIELDS))
        rows = [{key: row[key] for key in FIELDS} for row in reader]
    results = audit_rows(rows)
    summary = {
        "data_status": "SYNTHETIC_TEACHING_CASES",
        "source": "风险控制矩阵的许可测试底稿；同日分钟数",
        "row_count": len(results),
        "counts": dict(Counter(row["classification"] for row in results)),
        "limitation": "不证明真实客户许可、取消回执或银行生产控制有效；同分钟先后需真实事件序列",
        "results": results,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "results.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    with (args.output / "workpaper.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=[*FIELDS, "classification", "reason"])
        writer.writeheader()
        writer.writerows(results)
    print(json.dumps({"rows": len(results), "counts": summary["counts"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
