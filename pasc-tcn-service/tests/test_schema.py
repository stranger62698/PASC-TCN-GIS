from __future__ import annotations

import unittest
from copy import deepcopy
from datetime import date, timedelta

from pasc_tcn_service.schema import inspect_payload, parse_date_field, validate_payload


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
    def test_complete_date_formats_and_known_observation_prefixes(self):
        dates = ["20240229", "2024-2-29", "2024/2/29", "2024_2_29", "2024.2.29"]
        prefixes = [""] + [prefix + separator for prefix in ("D", "d", "Date", "TIME", "T") for separator in ("", " ", "_", ".", "-", "/")]
        for prefix in prefixes:
            for value in dates:
                source = f" {prefix}{value} "
                with self.subTest(source=source):
                    parsed = parse_date_field(source)
                    self.assertIsNotNone(parsed)
                    self.assertEqual(parsed[0], "2024-02-29")
        self.assertEqual(parse_date_field("d_19991231")[0], "1999-12-31")

    def test_date_parser_requires_complete_real_calendar_dates_in_19xx_or_20xx(self):
        invalid = ["D_20240230", "Date 2023-2-29", "T_2024/13/1", "Time-2024.1.0",
                   "18991231", "21000101", "2024011", "2024-1", "D_2024-01",
                   "FID20240101", "project_2024-01-01", "2024-01-01_note", "202401-01"]
        for source in invalid:
            with self.subTest(source=source):
                self.assertIsNone(parse_date_field(source))

    def test_original_selected_fields_are_retained_while_dates_are_sorted(self):
        payload = payload_for(40)
        record = payload["records"][0]
        original_fields = [field for field in record if field.startswith("D")]
        renamed_fields = []
        for index, field in enumerate(original_fields):
            canonical, _ = parse_date_field(field)
            renamed = ("D_", "Date ", "Time-", "T.")[index % 4] + canonical
            record[renamed] = record.pop(field)
            renamed_fields.append(renamed)
        payload["mapping"]["dateColumns"] = list(reversed(renamed_fields))
        before = deepcopy(payload)
        validated = inspect_payload(payload)
        self.assertTrue(validated.report["valid"])
        self.assertEqual([group[0].source for group in validated.date_groups], renamed_fields)
        self.assertEqual(validated.report["compatibility"]["points"][0]["effectiveEpochs"], 40)
        self.assertEqual(payload, before)

    def test_invalid_prefixed_observation_dates_remain_visible(self):
        for field in ("D_20240230", "Date 2024-2-30", "Time.2024/13/1", "T-2024_1_0"):
            with self.subTest(field=field):
                payload = payload_for(40)
                payload["records"][0][field] = 0
                report = validate_payload(payload)
                self.assertFalse(report["valid"])
                self.assertIn(field, report["dates"]["parseFailures"])

    def test_explicitly_selected_non_date_is_reported_instead_of_ignored(self):
        payload = payload_for(40)
        fields = [field for field in payload["records"][0] if field.startswith("D")]
        payload["records"][0]["observation_note"] = "not a date column"
        payload["mapping"]["dateColumns"] = fields + ["observation_note"]
        report = validate_payload(payload)
        self.assertFalse(report["valid"])
        self.assertIn("observation_note", report["dates"]["parseFailures"])

    def test_new_prefix_aliases_keep_same_day_merge_and_conflict_guards(self):
        for field in ("D_20200101", "Date 2020-1-1", "Time_2020/01/01", "T.2020_1_1"):
            for conflicting in (False, True):
                with self.subTest(field=field, conflicting=conflicting):
                    payload = payload_for(40)
                    payload["records"][0][field] = 999 if conflicting else payload["records"][0]["D20200101"]
                    report = validate_payload(payload)
                    self.assertEqual(report["valid"], not conflicting)
                    self.assertEqual(report["dates"]["count"], 40)
                    self.assertEqual(set(report["dates"]["duplicates"][0]["fields"]), {"D20200101", field})
                    conflicts = [item for item in report["issues"] if item["code"] == "PASC_DUPLICATE_DATE_CONFLICT"]
                    self.assertEqual(bool(conflicts), conflicting)

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
