from __future__ import annotations

import unittest
from datetime import date, timedelta

from pasc_tcn_service.schema import parse_date_field, validate_payload


def payload_for(count: int, *, interval_days=12):
    start = date(2020, 1, 1)
    record = {"fid": "p1", "xpos": 110.3, "ypos": 20.1}
    for index in range(count):
        record["D" + (start + timedelta(days=index * interval_days)).strftime("%Y%m%d")] = -index
    return {
        "mapping": {"pointId": "fid", "longitude": "xpos", "latitude": "ypos"},
        "settings": {
            "displacementUnit": "mm",
            "signConvention": "model_native",
            "preprocessingState": "already_smoothed",
        },
        "records": [record],
    }


class SchemaTests(unittest.TestCase):
    def test_all_five_date_formats(self):
        cases = {
            "D20170322": "2017-03-22",
            "20170322": "2017-03-22",
            "2017-03-22": "2017-03-22",
            "2017_03_22": "2017-03-22",
            "2017/03/22": "2017-03-22",
        }
        for source, canonical in cases.items():
            with self.subTest(source=source):
                self.assertEqual(parse_date_field(source)[0], canonical)

    def test_19_20_and_248_capability_states(self):
        expected = {
            19: ("unsupported", 19),
            20: ("adapted_experimental", 20),
            248: ("native_248", 248),
        }
        for count, (status, effective) in expected.items():
            with self.subTest(count=count):
                report = validate_payload(payload_for(count))
                point = report["compatibility"]["points"][0]
                self.assertTrue(report["valid"])
                self.assertEqual(point["status"], status)
                self.assertEqual(point["effectiveEpochs"], effective)

    def test_248_non_12_day_cadence_is_experimental(self):
        report = validate_payload(payload_for(248, interval_days=24))
        point = report["compatibility"]["points"][0]
        self.assertEqual(point["status"], "adapted_experimental")
    def test_aliases_and_mapping_methods(self):
        payload = payload_for(40)
        source = payload["records"][0]
        source["FID"] = source.pop("fid")
        source["X"] = source.pop("xpos")
        source["Y"] = source.pop("ypos")
        payload["mapping"] = {}
        report = validate_payload(payload)
        self.assertTrue(report["valid"])
        self.assertEqual(report["mapping"]["pointId"]["method"], "exact_alias")
        self.assertEqual(report["mapping"]["longitude"]["source"], "X")
        self.assertEqual(report["mapping"]["latitude"]["source"], "Y")

    def test_heuristic_mapping_requires_confirmation(self):
        payload = payload_for(40)
        source = payload["records"][0]
        source["longitude_estimate"] = source.pop("xpos")
        payload["mapping"].pop("longitude")
        report = validate_payload(payload)
        self.assertFalse(report["valid"])
        self.assertEqual(report["mapping"]["longitude"]["method"], "heuristic")
        self.assertIn("PASC_SCHEMA_UNRESOLVED", {i["code"] for i in report["issues"]})

    def test_identical_duplicate_date_is_merged(self):
        payload = payload_for(40)
        payload["records"][0]["2020-01-01"] = payload["records"][0]["D20200101"]
        report = validate_payload(payload)
        self.assertTrue(report["valid"])
        self.assertEqual(report["dates"]["count"], 40)
        self.assertEqual(report["dates"]["duplicates"][0]["conflictRows"], [])

    def test_conflicting_duplicate_date_fails_closed(self):
        payload = payload_for(40)
        payload["records"][0]["2020-01-01"] = 999
        report = validate_payload(payload)
        self.assertFalse(report["valid"])
        self.assertIn(
            "PASC_DUPLICATE_DATE_CONFLICT",
            {item["code"] for item in report["issues"]},
        )

    def test_confirmations_are_required(self):
        payload = payload_for(40)
        payload["settings"] = {}
        report = validate_payload(payload)
        codes = {item["code"] for item in report["issues"]}
        self.assertIn("PASC_UNIT_CONFIRMATION_REQUIRED", codes)
        self.assertIn("PASC_SIGN_CONFIRMATION_REQUIRED", codes)
        self.assertIn("PASC_PREPROCESSING_STATE_REQUIRED", codes)

    def test_invalid_date_is_reported(self):
        payload = payload_for(40)
        payload["records"][0]["D20200230"] = 0
        report = validate_payload(payload)
        self.assertFalse(report["valid"])
        self.assertIn("D20200230", report["dates"]["parseFailures"])


    def test_optional_ambiguous_mapping_requires_confirmation(self):
        payload = payload_for(40)
        payload["records"][0]["Vel"] = -1
        payload["records"][0]["velocity"] = -1
        report = validate_payload(payload)
        self.assertFalse(report["valid"])
        self.assertIn("PASC_SCHEMA_UNRESOLVED", {i["code"] for i in report["issues"]})

    def test_explicit_date_column_must_exist(self):
        payload = payload_for(40)
        payload["mapping"]["dateColumns"] = ["D20200101", "D20990101"]
        report = validate_payload(payload)
        self.assertFalse(report["valid"])
        self.assertEqual(report["dates"]["missingSelected"], ["D20990101"])

if __name__ == "__main__":
    unittest.main()
