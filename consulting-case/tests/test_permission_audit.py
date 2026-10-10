"""测试发送/撤回边界和坏数据，避免把缺证据误判为控制通过。"""

import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/audit-permission.py"
SPEC = importlib.util.spec_from_file_location("permission_audit", SCRIPT)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class PermissionAuditTests(unittest.TestCase):
    def record(self, **changes):
        """构造撤回前排队、撤回后发送的虚构记录，用覆盖字段测试不同边界。"""
        return {"case_id": "S01", "customer_id": "C001", "revoked_minute": "550",
                "queued_minute": "545", "sent_minute": "552", "status": "已发送",
                **changes}

    def classification(self, **changes):
        return AUDIT.audit_rows([self.record(**changes)])[0]["classification"]

    def test_queue_before_revoke_does_not_authorize_later_send(self):
        self.assertEqual(self.classification(), "CONTROL_FAILURE")

    def test_same_minute_uses_explicit_conservative_demo_rule(self):
        self.assertEqual(self.classification(sent_minute="550"), "CONTROL_FAILURE")

    def test_future_revoke_does_not_retroactively_fail_send(self):
        self.assertEqual(self.classification(sent_minute="548"), "NO_EXCEPTION_IN_DEMO")

    def test_missing_send_time_is_not_a_pass(self):
        self.assertEqual(self.classification(sent_minute=""), "EVIDENCE_GAP")

    def test_cancellation_requires_no_send_timestamp(self):
        self.assertEqual(self.classification(status="已取消"), "EVIDENCE_GAP")
        self.assertEqual(self.classification(status="已取消", sent_minute=""),
                         "CANCELLED_NOT_SENT")

    def test_invalid_time_values(self):
        for value in ("-1", "1440", "bad", "550.5"):
            with self.subTest(value=value):
                self.assertEqual(self.classification(sent_minute=value), "EVIDENCE_GAP")

    def test_time_sequence_conflict(self):
        self.assertEqual(self.classification(sent_minute="544"), "EVIDENCE_GAP")

    def test_duplicate_id_preserves_both_rows_as_gaps(self):
        results = AUDIT.audit_rows([self.record(), self.record()])
        self.assertEqual(len(results), 2)
        self.assertTrue(all(row["classification"] == "EVIDENCE_GAP" for row in results))

    def test_absent_revocation_is_only_a_demo_result(self):
        self.assertEqual(self.classification(revoked_minute=""), "NO_EXCEPTION_IN_DEMO")

    def test_empty_identifiers_and_unknown_status(self):
        self.assertEqual(self.classification(case_id=""), "EVIDENCE_GAP")
        self.assertEqual(self.classification(status="待发送"), "EVIDENCE_GAP")


if __name__ == "__main__":
    unittest.main()
