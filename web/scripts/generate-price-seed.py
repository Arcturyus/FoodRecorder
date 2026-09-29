"""Convert the reviewed Markdown estimates into the checked-in price seed.

Run from web/: python scripts/generate-price-seed.py
Only the Estimation France and Confiance columns are imported.
"""
from pathlib import Path
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "banque-produits-prix-2026-09-29.md"
TARGET = ROOT / "web/src/nutrition/priceSeedData.ts"


def key(name: str) -> str:
    return " ".join("".join(c for c in unicodedata.normalize("NFD", name.lower())
                    if unicodedata.category(c) != "Mn").split())


def main() -> None:
    scope = "bank"
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for line in SOURCE.read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("## Catalogue non rangé"):
            scope = "catalogue"
        if line.startswith("## Méthode de relevé"):
            break
        if not line.startswith("| "):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) != 11 or cells[0] in {"Produit", "Catégorie"} or cells[0].startswith("---"):
            continue
        name = cells[0 if scope == "bank" else 1]
        match = re.match(r"^(\d+(?:,\d+)?) €/kg", cells[7])
        if not match:
            raise ValueError(f"Missing or invalid estimate: {name}")
        confidence = {"Faible": "faible", "Moyenne": "moyenne", "Forte": "forte", "Élevée": "forte"}.get(cells[8])
        if not confidence:
            raise ValueError(f"Invalid confidence: {name}: {cells[8]}")
        identity = (scope, key(name))
        if identity in seen:
            raise ValueError(f"Ambiguous duplicate: {scope}: {name}")
        seen.add(identity)
        rows.append({"scope": scope, "name": name, "eurPerKg": float(match.group(1).replace(",", ".")), "confidence": confidence})
    counts = {scope: sum(row["scope"] == scope for row in rows) for scope in ("bank", "catalogue")}
    if counts != {"bank": 206, "catalogue": 72}:
        raise ValueError(f"Unexpected number of rows: {counts}")
    lines = [
        "// Generated from banque-produits-prix-2026-09-29.md by scripts/generate-price-seed.py.",
        "// Review the Markdown before regenerating. These are indicative prices, not live offers.",
        "export interface PriceSeedRow { scope: 'bank' | 'catalogue'; name: string; eurPerKg: number; confidence: 'faible' | 'moyenne' | 'forte' }",
        "export const PRICE_SEED_DATE = '2026-09-29';",
        "export const PRICE_SEED: PriceSeedRow[] = [",
    ]
    for row in rows:
        fields = ", ".join(f"{name}: {json.dumps(value, ensure_ascii=True)}" for name, value in row.items())
        lines.append(f"  {{ {fields} }},")
    lines.append("];")
    TARGET.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} prices to {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
