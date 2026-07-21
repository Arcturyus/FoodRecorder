import { useState } from 'react';
import type { KcalUncertainty } from '../nutrition/uncertainty';
import { fmt } from './format';

/**
 * Indicateur discret d'imprécision sur un total kcal : le chiffre reste seul,
 * un petit « ~ » cliquable révèle la fourchette estimée et les items qui la
 * creusent le plus (pour savoir quoi peser la prochaine fois).
 */
export function UncertaintyBadge({ kcal, unc }: { kcal: number; unc: KcalUncertainty }) {
  const [open, setOpen] = useState(false);
  const pm = Math.round(unc.pm / 10) * 10;
  // Sous ce seuil, la journée est précise : pas de bruit visuel.
  if (pm < 20) return null;
  return (
    <span className="unc-wrap">
      <button
        type="button"
        className={`unc-badge${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        data-tip="Précision estimée — cliquez pour voir la fourchette"
        aria-label="Afficher la fourchette d'incertitude des calories"
      >
        ~
      </button>
      {open && (
        <span className="unc-pop">
          <span className="mono unc-range">
            {fmt(Math.max(0, kcal - pm))} – {fmt(kcal + pm)} kcal <span className="unc-pm">(± {fmt(pm)})</span>
          </span>
          <span>
            Fourchette estimée d'après les quantités approximatives (bols, assiettes, photos…) et les aliments
            estimés par l'IA.
          </span>
          {unc.top.length > 0 && (
            <span>
              Les plus incertains : {unc.top.map((t) => `${t.nom} (±${fmt(t.pm)} kcal)`).join(' · ')}.
            </span>
          )}
        </span>
      )}
    </span>
  );
}
