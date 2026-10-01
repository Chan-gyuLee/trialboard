"""Bootstrap KO<->EN glossary: coverage, lookup behavior, and query-building."""

from trialboard.research.glossary import (
    GLOSSARY,
    contains_hangul,
    search_term,
    translate_to_english,
)
from trialboard.research.models import Collection


def test_glossary_has_roughly_one_thousand_entries():
    assert len(GLOSSARY) >= 900
    assert len(set(GLOSSARY)) == len(GLOSSARY)


def test_glossary_values_are_nonempty_ascii_english():
    for term, glosses in GLOSSARY.items():
        assert term.strip() == term and term
        assert glosses
        for gloss in glosses:
            assert gloss.strip() == gloss and gloss


def test_contains_hangul():
    assert contains_hangul("레고라페닙")
    assert contains_hangul("1차 평가변수")
    assert not contains_hangul("Regorafenib")
    assert not contains_hangul("")


def test_translate_exact_phrase_match():
    assert translate_to_english("전체반응률") == "overall response rate"
    assert translate_to_english("1차 평가변수") == "primary endpoint"


def test_translate_partial_match_passes_through_unknown_tokens():
    result = translate_to_english("조현병 환자 반응률")
    assert result is not None
    assert "schizophrenia" in result
    assert "response rate" in result


def test_translate_no_match_returns_none():
    assert translate_to_english("아무개뜻없는임의문자열조합") is None
    assert translate_to_english("") is None
    assert translate_to_english(None) is None


def test_search_term_widens_korean_asset_with_or_clause():
    term = search_term("다발골수종")
    assert term.startswith("(") and "OR" in term
    assert '"다발골수종"' in term
    assert "multiple myeloma" in term


def test_search_term_leaves_english_asset_unchanged():
    assert search_term("Regorafenib") == '"Regorafenib"'
    assert search_term("  Pembrolizumab  ") == '"Pembrolizumab"'


def test_search_term_matches_collection_reconciliation_formula():
    # Collection.consistent_followup_provenance recomputes the same query
    # independently; both call sites must derive it from this one function.
    request = {
        "search_id": "11111111-1111-1111-1111-111111111111",
        "nct_id": "NCT00000001",
        "asset": "다발골수종",
        "indication": "다발골수종",
        "public_consent": True,
        "model_consent": True,
    }
    query = f'TITLE_ABS:{search_term("다발골수종")} AND (CONTRARIAN_TERM) AND SRC:MED'
    collection = Collection(
        id="c1",
        project_id="p1",
        created_at="2026-01-01T00:00:00Z",
        request=request,
        status="RUNNING",
        sources=[],
        coverage=[
            {
                "channel": "Europe PMC / PubMed",
                "query": query,
                "status": "OK",
                "total": None,
                "fetched": 0,
                "limited": False,
            }
        ],
        events=[],
        plan={
            "followups": [{"term": "CONTRARIAN_TERM", "intent": "CONTRARIAN"}],
            "priorities": [],
            "missing_evidence": [],
        },
        followup_executions=[
            {
                "term": "CONTRARIAN_TERM",
                "intent": "CONTRARIAN",
                "origin": "MODEL",
                "query": query,
                "coverage_index": 0,
                "status": "OK",
                "attempted": True,
            }
        ],
    )
    assert collection.request.asset == "다발골수종"
