"""Modifier guess for PC/TC-split codes (PCTC IND 1: global, -26 and -TC rows all exist).

The Provider-and-Service file does not carry modifiers. For each provider line on a PCTC 1 code,
price global, -26 and -TC with CY2026 RVUs x GPCI2026 (work GPCI with 1.0 floor) x CF 33.4009 at
the provider's locality (facility PE for POS F, non-facility PE for POS O; national GPCI 1.0 if no
locality), scale by the practitioner type's statutory share (PAYMENT_PCT, e.g. 85% for NPs and PAs),
then pick the variant with the smallest |ln(avg_allowed / price)|.

Note: the claims are CY2024 (paid with 2024 RVUs, GPCIs and CF); the three variants differ by a
factor of ~2-10, so 2026 values separate them fine. Lines whose avg allowed is a blend of variants
(e.g. a provider billing both global and -26) get the nearest single one.
"""
from __future__ import annotations

import math

from common import CF_2026_NONQP, load_gpci, load_rvu

MODS = ("", "26", "TC")

# Statutory share of the fee schedule paid to these practitioner types (SSA 1833(a)(1)(O), (F), (S), (FF), (BB)
# etc.); checked in the data: their office E/M allowed sits at 0.85 / 0.75 of the physician ratio.
PAYMENT_PCT = {
    "Nurse Practitioner": 0.85,
    "Physician Assistant": 0.85,
    "Certified Clinical Nurse Specialist": 0.85,
    "Registered Dietitian or Nutrition Professional": 0.85,
    "Licensed Clinical Social Worker": 0.75,
    "Licensed Professional Counselor": 0.75,
    "Marriage and Family Therapist": 0.75,
}


def price(rvu: dict, g: dict, pos: str, cf: float = CF_2026_NONQP) -> float:
    pe = rvu["pe_f"] if pos == "F" else rvu["pe_nf"]
    return (rvu["work"] * g["pw"] + pe * g["pe"] + rvu["mp"] * g["mp"]) * cf


class ModGuesser:
    def __init__(self):
        self.rvu = load_rvu()
        self.gpci = load_gpci()
        self.national = {"pw": 1.0, "pe": 1.0, "mp": 1.0}
        self.split = {h for (h, m), v in self.rvu.items() if m == "" and v["pctc"] == "1"
                      and (h, "26") in self.rvu and (h, "TC") in self.rvu}

    def guess(self, hcpcs: str, pos: str, loc: str | None, avg_allowed: float, ptype: str = "") -> str:
        """Return "", "26" or "TC". Non-split codes always return ""."""
        if hcpcs not in self.split or not avg_allowed or avg_allowed <= 0:
            return ""
        g = self.gpci.get(loc or "", self.national)
        avg_allowed = avg_allowed / PAYMENT_PCT.get(ptype, 1.0)
        best, best_d = "", math.inf
        for m in MODS:
            p = price(self.rvu[(hcpcs, m)], g, pos)
            if p <= 0:
                continue
            d = abs(math.log(avg_allowed / p))
            if d < best_d:
                best, best_d = m, d
        return best
