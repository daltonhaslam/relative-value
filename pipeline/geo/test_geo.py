"""Checks for the county -> locality mapping and the map file. Run: python -I pipeline/geo/test_geo.py"""
from __future__ import annotations

import json
import sys
import unittest
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "npi"))
sys.path.insert(0, str(HERE))
import common as c  # noqa: E402
import county_locality as cl  # noqa: E402

MAP = c.DOCS_DATA / "map" / "counties.json"


class TestGeo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assign, cls.problems = cl.build()
        cls.gpci = c.load_gpci()
        cls.counties = cl.load_counties()

    def test_every_county_one_locality(self):
        self.assertEqual(self.problems, [])
        self.assertEqual(set(self.assign), set(self.counties))
        self.assertEqual(len(self.counties), 3142)
        self.assertTrue(set(self.assign.values()) <= set(self.gpci))

    def test_every_locality_has_a_county_except_territories(self):
        unused = set(self.gpci) - set(self.assign.values())
        self.assertEqual(unused, {"09202-20", "09202-50"})  # Puerto Rico, Virgin Islands
        self.assertEqual(len(self.gpci), 109)

    def test_tricky_assignments(self):
        want = {"24031": "12202-01", "24510": "12302-01", "24005": "12302-01", "24001": "12302-99",
                "51059": "12202-01", "51600": "12202-01", "51610": "12202-01", "51510": "12202-01",
                "51760": "11302-00", "36081": "13292-04", "36061": "13202-01", "36047": "13202-02",
                "36001": "13282-99", "12086": "09102-04", "06059": "01182-18", "06037": "01182-18",
                "29510": "05302-01", "29189": "05302-01", "22051": "07202-01", "48245": "04412-20",
                "15001": "01212-01", "11001": "12202-01", "06015": "01112-75"}
        for fips, key in want.items():
            self.assertEqual(self.assign[fips], key, fips)

    def test_map_file(self):
        t = json.loads(MAP.read_text())
        geoms = t["objects"]["counties"]["geometries"]
        self.assertEqual(len(geoms), 3142)
        self.assertEqual({g["id"]: g["properties"]["l"] for g in geoms}, self.assign)
        for k in ("nation", "statesMesh", "localityMesh"):
            self.assertIn(k, t["objects"])
        self.assertLess(MAP.stat().st_size, 1_000_000)
        self.assertIn("(none)", (HERE / "unmatched.txt").read_text())

    def test_locality_counts(self):
        n = Counter(self.assign.values())
        self.assertEqual(n["10112-00"], 67)   # Alabama statewide
        self.assertEqual(n["01182-18"], 2)    # LA + Orange


if __name__ == "__main__":
    unittest.main(verbosity=2)
