"""Small NYSED-specific helpers shared across datasets."""

from __future__ import annotations

import re
from typing import Optional, Tuple


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_")


def grade_dimension(assessment_name: str):
    """Grades 3-8 ASSESSMENT_NAME -> (code_suffix, name_suffix), or None to skip.

    NYSED mixes several row kinds in one table, so match the whole name rather
    than grabbing the first number (which used to fold the 3-8 aggregate onto
    grade 3 and the Regents/Combined rows onto grades 6-8):
      ELA6 / MATH8 / Science5          -> _g6          single grade
      ELA3_8 / MATH3_8 / Science5_8    -> _g3_8        all grades combined
      Combined6Math / CombinedScience  -> _g6_combined grade test + Regents takers
      RegentsMath7 / RegentsScience8   -> _g7_regents  Regents taken in that grade
      *_EST / *_SMALL / anything else  -> None         estimates, small-group rows
    """
    n = str(assessment_name).strip()
    m = re.fullmatch(r"(?:ELA|MATH|SCIENCE)(\d)", n, re.I)
    if m:
        g = m.group(1)
        return (f"_g{g}", f" — Grade {g}")
    m = re.fullmatch(r"(?:ELA|MATH|SCIENCE)(\d)_(\d)", n, re.I)
    if m:
        a, b = m.groups()
        return (f"_g{a}_{b}", f" — Grades {a}-{b} combined")
    m = re.fullmatch(r"Combined(\d)?(?:Math|Science)", n, re.I)
    if m:
        g = m.group(1) or "8"  # CombinedScience is the grade 8 measure
        return (f"_g{g}_combined", f" — Grade {g} (grade test + Regents takers)")
    m = re.fullmatch(r"Regents(?:Math|Science)(\d)", n, re.I)
    if m:
        g = m.group(1)
        return (f"_g{g}_regents", f" — Grade {g} Regents takers")
    return None


def label_dimension(label: str):
    """Fold an arbitrary label (subject, cohort class…) into the metric code."""
    s = str(label).strip()
    if not s:
        return None
    return (f"_{slugify(s)}", f" — {s}")


def cohort_dimension(desc: str) -> Optional[Tuple[str, str]]:
    """NYSED cohort `membership_desc` -> (code_suffix, name_suffix).

    Distinguishes 4/5/6-year outcomes and the June (default) vs August release.
    Returns None for anything unrecognized so the row is skipped.
    Shared by graduation rate and graduation/career pathways.
    """
    d = str(desc)
    if "4 Year" in d:
        length, label = "4yr", "4-year"
    elif "5 Year" in d:
        length, label = "5yr", "5-year"
    elif "6 Year" in d:
        length, label = "6yr", "6-year"
    else:
        return None
    if "August" in d:
        return (f"_{length}_aug", f" ({label} outcome, August)")
    return (f"_{length}", f" ({label} outcome, June)")
