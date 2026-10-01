"""Persisted illustrative design exploration, strictly separate from clinical evidence."""

import json
import platform
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

from trialboard.api.team_auth import TeamDataPath
from trialboard.research.models import Collection
from trialboard.research.result_tables import registry_results
from trialboard.research.source_policy import existing_connection, require_content_con, tables
from trialboard.research.store import ResearchStore
from trialboard.review.engine import simulate
from trialboard.review.models import Design, Scenario
from trialboard.serialization import sha256_json

POLICY = "illustrative-designs/1"
PROVENANCE = "RULE_LIBRARY_HYPOTHETICAL"


def build_exploration(run, tables):
    """Never map generic A/B to registry doses or estimate truth from reported results."""
    scenarios = [
        Scenario(
            id=key,
            label=label,
            arms=("A", "B"),
            response=response,
            adverse_event=adverse,
            adverse_event_penalty=0.5,
            maximum_adverse_event_rate=0.35,
            rationale="설계 민감도를 설명하기 위한 고정 합성 가정. 실제 약물 추정치 아님.",
        )
        for key, label, response, adverse in [
            ("equal", "효능·안전성이 같은 경우", (0.3, 0.3), (0.2, 0.2)),
            ("tradeoff", "효능 증가와 이상반응 증가가 함께 있는 경우", (0.3, 0.4), (0.15, 0.3)),
            ("unsafe", "두 군 모두 가정한 한계를 넘는 경우", (0.3, 0.4), (0.5, 0.6)),
        ]
    ]
    plans = [Design(id=f"n{n}", label=f"군당 {n}명", per_arm=n) for n in (20, 40, 60)]
    simulations = [
        simulate(s, p, seed=42, repetitions=2000).model_dump(mode="json")
        for s in scenarios
        for p in plans
    ]
    return {
        "schema": "research-exploration/1",
        "policy": POLICY,
        "runId": run.id,
        "nctId": run.request.nct_id,
        "asset": run.request.asset,
        "createdAt": datetime.now(UTC).isoformat(),
        "status": "ILLUSTRATIVE_ONLY",
        "provenance": PROVENANCE,
        "clinicalApproved": False,
        "userApproved": False,
        "recommendedPlanId": None,
        "modelCalls": 0,
        "simulationExecuted": True,
        "evidenceUsedAsParameters": False,
        "armMapping": "UNMAPPED_GENERIC_A_B",
        "snapshotDigest": tables["snapshotDigest"] if tables else None,
        "evidenceStatus": tables["readiness"]["status"] if tables else "NO_REGISTRY_RESULTS",
        "questions": [
            *(
                tables["readiness"]["questions"]
                if tables
                else ["동일 시험의 용량별 효능·안전성 결과와 분석집단을 확보해야 합니다."]
            ),
            "실제 용량·투여 일정과 가상 A/B를 어떻게 연결할 것인가? 현재 연결하지 않았습니다.",
            "확률·효용 가중치·한계·표본수의 임상적 근거와 민감도 범위를 누가 확인할 것인가?",
            "모집·탈락·결측·평가 시점과 확증적 검정 설계를 별도로 어떻게 검토할 것인가?",
        ],
        "plans": [p.model_dump() for p in plans],
        "scenarios": [s.model_dump(mode="json") for s in scenarios],
        "simulations": simulations,
        "runtime": {"python": platform.python_version(), "numpy": version("numpy"), "rng": "PCG64"},
        "engineDigest": sha256_json(
            {
                "proposal": Path(__file__).read_text(encoding="utf-8"),
                "simulation": Path(__file__)
                .parents[1]
                .joinpath("review/engine.py")
                .read_text(encoding="utf-8"),
            }
        ),
        "limitations": [
            "MOC · 모든 계산 입력은 고정 합성 가정. 실제 근거 수치·AI 제안·사용자 선언이 아닙니다.",
            "세 표본수는 시연용 대안이며 권장 표본수·검정력 산출이 아닙니다.",
            "반응과 이상반응은 독립 Bernoulli 가정. "
            "결측·탈락·중간중단·시간 결과를 포함하지 않습니다.",
            "가정 규칙상 선택/보류 빈도와 Monte Carlo 오차이지 임상 성공·허가 확률이 아닙니다.",
            "두 군이 모두 한계를 넘으면 올바른 선택/보류는 어떤 군도 선택하지 않는 경우입니다.",
            "가상 계산은 실제 근거 부족을 해소하거나 임상 승인을 부여하지 않습니다.",
        ],
    }


class ExplorationStore(ResearchStore):
    def connect(self):
        con = super().connect()
        con.execute("""CREATE TABLE IF NOT EXISTS research_exploration (
            run_id TEXT PRIMARY KEY REFERENCES research_runs(id),
            digest TEXT NOT NULL, data TEXT NOT NULL)""")
        return con

    def get(self, run_id):
        team = isinstance(self.path, TeamDataPath)
        con = existing_connection(self.path) if team else self.connect()
        try:
            if team:
                con.execute("BEGIN")
                require_content_con(con, run_id)
                if "research_exploration" not in tables(con):
                    return None
            row = con.execute(
                "SELECT digest, data FROM research_exploration WHERE run_id=?", (run_id,)
            ).fetchone()
            if not row:
                return None
            value = json.loads(row[1])
            if sha256_json(value) != row[0] or value.get("runId") != run_id:
                raise ValueError("EXPLORATION_INTEGRITY")
            return value
        finally:
            con.close()

    def create(self, run_id):
        run = self.get_run(run_id)
        if not run or run.status not in ("COMPLETE", "PARTIAL"):
            raise ValueError("TERMINAL_RESEARCH_REQUIRED")
        previous = self.get(run_id)
        if previous is not None:
            return previous
        # Trusted stored snapshot only; client cannot submit evidence, probabilities or approvals.
        value = build_exploration(run, registry_results(self, run_id, run=run))
        con = self.connect()
        try:
            with con:
                if isinstance(self.path, TeamDataPath):
                    con.execute("BEGIN IMMEDIATE")
                    require_content_con(con, run_id)
                    current = Collection.model_validate_json(con.execute(
                        "SELECT data FROM research_runs WHERE id=?", (run_id,)).fetchone()[0])
                    if current != run:
                        raise ValueError("EXPLORATION_VERSION_MISMATCH")
                con.execute(
                    "INSERT OR IGNORE INTO research_exploration VALUES (?,?,?)",
                    (
                        run_id,
                        sha256_json(value),
                        json.dumps(value, ensure_ascii=False),
                    ),
                )
        finally:
            con.close()
        return self.get(run_id)
