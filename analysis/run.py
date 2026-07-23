"""Exécute le notebook de bout en bout et le réenregistre AVEC ses sorties (graphes),
sans avoir à ouvrir Jupyter. Usage : `python run.py` (depuis analysis/, venv activé)."""
import nbformat
from nbclient import NotebookClient

nb = nbformat.read("pca_course.ipynb", as_version=4)
NotebookClient(nb, timeout=180, kernel_name="python3").execute()
nbformat.write(nb, "pca_course.ipynb")

errors = [
    (i, o.get("ename"), o.get("evalue"))
    for i, c in enumerate(nb.cells) if c.cell_type == "code"
    for o in c.get("outputs", []) if o.get("output_type") == "error"
]
print("Erreurs :", errors or "aucune", "— notebook réenregistré avec les graphes.")
