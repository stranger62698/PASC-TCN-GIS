from __future__ import annotations

import json
import unittest
from datetime import date, timedelta

from pasc_tcn_service.api import dispatch


def request_payload(count=40):
    start = date(2020, 1, 1)
    record = {"fid": "p1", "xpos": 110.3, "ypos": 20.1}
    for index in range(count):
        record["D" + (start + timedelta(days=index * 12)).strftime("%Y%m%d")] = -index
    return {
        "mapping": {"pointId": "fid", "longitude": "xpos", "latitude": "ypos"},
        "settings": {
            "displacementUnit": "mm",
            "signConvention": "model_native",
            "preprocessingState": "already_smoothed",
        },
        "records": [record],
    }


class ApiTests(unittest.TestCase):
    def call(self, method, path, body=None):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else b""
        return dispatch(method, path, raw)

    def test_models_declares_preprocessing_only(self):
        status, body = self.call("GET", "/v1/models")
        self.assertEqual(status, 200)
        self.assertEqual(body["contractVersion"], "pasc-contract-v1")
        self.assertTrue(body["models"][0]["preprocessingAvailable"])
        self.assertFalse(body["models"][0]["inferenceAvailable"])

    def test_validate_returns_report_not_checkpoint_output(self):
        status, body = self.call("POST", "/v1/validate", request_payload())
        self.assertEqual(status, 200)
        self.assertTrue(body["valid"])
        self.assertEqual(body["compatibility"]["counts"]["experimental"], 1)
        self.assertNotIn("modelVersion", body)

    def test_preprocess_returns_contract_and_no_inference(self):
        status, body = self.call("POST", "/v1/preprocess", request_payload())
        self.assertEqual(status, 200)
        self.assertEqual(body["operation"], "preprocess_only")
        self.assertFalse(body["inferenceAvailable"])
        self.assertNotIn("predictions", body)
        self.assertEqual(len(body["points"][0]["normalizedSeries"]), 40)
        self.assertEqual(body["points"][0]["quality"]["cadenceDays"], 12)

    def test_preprocess_validation_error_has_machine_code_and_chinese_message(self):
        payload = request_payload()
        payload["settings"].pop("signConvention")
        status, body = self.call("POST", "/v1/preprocess", payload)
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "PASC_SIGN_CONFIRMATION_REQUIRED")
        self.assertTrue(body["error"]["message"])

    def test_bad_json_and_unknown_route(self):
        status, body = dispatch("POST", "/v1/validate", b"{")
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "PASC_BAD_REQUEST")
        status, body = self.call("GET", "/v1/infer")
        self.assertEqual(status, 405)
        self.assertEqual(body["error"]["code"], "PASC_METHOD_NOT_ALLOWED")



    def test_unsupported_contract_version_fails_closed(self):
        payload = request_payload()
        payload["contractVersion"] = "pasc-contract-v999"
        status, body = self.call("POST", "/v1/preprocess", payload)
        self.assertEqual(status, 422)
        self.assertEqual(
            body["error"]["code"], "PASC_CONTRACT_VERSION_UNSUPPORTED"
        )
if __name__ == "__main__":
    unittest.main()
