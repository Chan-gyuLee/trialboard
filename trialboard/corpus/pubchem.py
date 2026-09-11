"""PubChem PUG-REST compound identity lookup + RDKit cross-check."""

from __future__ import annotations

from typing import Any

from trialboard.core.hashing import short_id
from trialboard.core.schemas import Attribution, Source, SourceType
from trialboard.corpus.snapshot import SnapshotStore

PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PROPS = "MolecularFormula,MolecularWeight,InChIKey,ConnectivitySMILES,IsomericSMILES,IUPACName"


class PubChemClient:
    def __init__(self, store: SnapshotStore):
        self.store = store

    def compound(self, name: str) -> tuple[dict[str, Any], Source]:
        data, f = self.store.get_json(f"{PUG}/compound/name/{name}/property/{PROPS}/JSON")
        props = data["PropertyTable"]["Properties"][0]
        src = Source(
            source_id=short_id("src", f.url, f.content_hash),
            type=SourceType.COMPOUND_DB,
            url=f.url,
            title=f"PubChem CID {props.get('CID')} ({name})",
            issuer="PubChem",
            fetched_at=f.fetched_at,
            content_hash=f.content_hash,
            media_type=f.media_type,
            local_path=str(f.local_path),
            attribution_default=Attribution.REGISTRY,
            meta={"cid": props.get("CID")},
        )
        return props, src


def rdkit_check(smiles: str, expected_inchikey: str) -> dict[str, Any]:
    """Recompute InChIKey from SMILES and compare to PubChem's. Deterministic gate."""
    from rdkit import Chem
    from rdkit.Chem import Descriptors, rdMolDescriptors

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"ok": False, "reason": "SMILES parse failed"}
    ik = Chem.MolToInchiKey(mol)
    # Stereo layer may differ if ConnectivitySMILES was used; compare skeleton block.
    skeleton_match = ik.split("-")[0] == expected_inchikey.split("-")[0]
    return {
        "ok": skeleton_match,
        "inchikey_computed": ik,
        "inchikey_expected": expected_inchikey,
        "full_match": ik == expected_inchikey,
        "mw": round(Descriptors.MolWt(mol), 1),
        "logp": round(Descriptors.MolLogP(mol), 2),
        "hbd": rdMolDescriptors.CalcNumHBD(mol),
        "hba": rdMolDescriptors.CalcNumHBA(mol),
    }
