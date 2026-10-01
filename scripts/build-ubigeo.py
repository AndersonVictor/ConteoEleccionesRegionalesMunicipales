"""Genera data/ubigeo.json (departamento > provincia > distrito) a partir de
scripts/ubigeo_distrito.csv (dataset jmcastagnetto/ubigeo-peru-aumentado, INEI + RENIEC).

Cada distrito guarda su código INEI (c) y su código RENIEC (r). La API de
Voto Informado del JNE trabaja con la codificación RENIEC.

Uso: python3 scripts/build-ubigeo.py
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "ubigeo_distrito.csv"
OUT = ROOT / "data" / "ubigeo.json"

# Distritos nuevos que el dataset trae incompletos.
PARCHES_INEI = {("MOQUEGUA", "MARISCAL NIETO", "SAN ANTONIO"): "180107"}


def main():
    deps = {}
    for r in csv.DictReader(SRC.open(encoding="utf-8")):
        clave = (r["departamento"], r["provincia"], r["distrito"])
        inei = PARCHES_INEI.get(clave) or r["inei"]
        if not inei or inei == "NA":
            raise SystemExit(f"Distrito sin código INEI: {clave}")
        inei = inei.zfill(6)
        reniec = "" if r["reniec"] in ("", "NA") else r["reniec"].zfill(6)
        d = deps.setdefault(inei[:2], {"c": inei[:2], "n": r["departamento"], "p": {}})
        p = d["p"].setdefault(inei[:4], {"c": inei[:4], "n": r["provincia"], "d": []})
        p["d"].append({"c": inei, "n": r["distrito"], "r": reniec})

    out = []
    for d in sorted(deps.values(), key=lambda x: x["c"]):
        provs = sorted(d["p"].values(), key=lambda x: x["c"])
        for p in provs:
            p["d"].sort(key=lambda x: x["c"])
        out.append({"c": d["c"], "n": d["n"], "p": provs})
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_dist = sum(len(p["d"]) for d in out for p in d["p"])
    print(f"{len(out)} departamentos, {sum(len(d['p']) for d in out)} provincias, {n_dist} distritos -> {OUT}")


if __name__ == "__main__":
    main()
