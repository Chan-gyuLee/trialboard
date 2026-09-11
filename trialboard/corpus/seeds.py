"""Curated seed documents that automatic discovery cannot reach.

Drugs@FDA lists letters/labels/reviews per submission, but advisory-committee
briefings, the original-NDA review PDFs (linked via a JS-built TOC page) and
guidance documents live elsewhere. We keep an explicit, reviewable list per
drug and a shared guidance list. Everything is still snapshot-pinned by hash.
"""

from __future__ import annotations

from trialboard.core.schemas import Attribution, SourceType

FDA_NDA_2021 = "https://www.accessdata.fda.gov/drugsatfda_docs/nda/2021/214665Orig1s000"

SEEDS: dict[str, list[dict]] = {
    "sotorasib": [
        {
            "url": "https://www.fda.gov/media/172698/download",
            "type": SourceType.ODAC_BRIEFING,
            "title": "ODAC Meeting Briefing Document: Sotorasib (Amgen), 05 Oct 2023",
            "issuer": "Amgen (submitted to FDA ODAC)",
            "doc_date": "2023-10-05",
            "attribution": Attribution.SPONSOR,
        },
        {
            "url": FDA_NDA_2021 + "MultidisciplineR.pdf",
            "type": SourceType.FDA_REVIEW,
            "title": "NDA 214665 Multi-Discipline Review (original approval)",
            "issuer": "FDA",
            "doc_date": "2021-05-28",
            "version": "ORIG-1",
            "attribution": Attribution.REVIEWER,
        },
    ],
    "adagrasib": [],
}

GUIDANCE: list[dict] = [
    {
        "url": "https://www.fda.gov/media/164555/download",
        "type": SourceType.GUIDANCE,
        "title": "FDA Guidance: Optimizing the Dosage of Human Prescription Drugs and Biological "
        "Products for the Treatment of Oncologic Diseases (Final, Aug 2024)",
        "issuer": "FDA OCE/CDER",
        "doc_date": "2024-08-01",
        "attribution": Attribution.AGENCY_GUIDANCE,
        "key": "FDA_DOSE_OPT_2024",
    },
    {
        "url": "https://database.ich.org/sites/default/files/ICH_E8-R1_Guideline_Step4_2021_1006.pdf",
        "type": SourceType.GUIDANCE,
        "title": "ICH E8(R1) General Considerations for Clinical Studies",
        "issuer": "ICH",
        "doc_date": "2021-10-06",
        "attribution": Attribution.AGENCY_GUIDANCE,
        "key": "ICH_E8R1",
    },
    {
        "url": "https://database.ich.org/sites/default/files/E9-R1_Step4_Guideline_2019_1203.pdf",
        "type": SourceType.GUIDANCE,
        "title": "ICH E9(R1) Estimands and Sensitivity Analysis in Clinical Trials",
        "issuer": "ICH",
        "doc_date": "2019-11-20",
        "attribution": Attribution.AGENCY_GUIDANCE,
        "key": "ICH_E9R1",
    },
    {
        "url": "https://database.ich.org/sites/default/files/E4_Guideline.pdf",
        "type": SourceType.GUIDANCE,
        "title": "ICH E4 Dose-Response Information to Support Drug Registration",
        "issuer": "ICH",
        "doc_date": "1994-03-10",
        "attribution": Attribution.AGENCY_GUIDANCE,
        "key": "ICH_E4",
    },
]

# Registry modules whose change counts as a design change (lineage tagging).
DESIGN_MODULES = {
    "Arms and Interventions",
    "Outcome Measures",
    "Eligibility",
    "Study Design",
    "Study Description",
}
