import { useEffect, useRef, type ReactNode } from 'react';
import { SECTIONS_STORE, useUiPref } from './uiPrefs';

/**
 * Panneau repliable. Remplace `<div className="panel"><h2>…</h2>` là où le
 * contenu est long mais rarement consulté : l'onglet Poids empilait 5 857 px
 * de panneaux tous dépliés, dont 3 058 px d'historique de pesées.
 *
 * Replié, le panneau garde une ligne de RÉSUMÉ : un titre seul obligerait à
 * déplier pour savoir s'il y a quelque chose à voir, ce qui coûte plus cher que
 * le défilement qu'on cherchait à éviter.
 *
 * L'état plié est une préférence d'affichage de CE navigateur (cf. uiPrefs.ts).
 */

export function Section({
  id,
  title,
  summary,
  defaultOpen = true,
  openSignal,
  head,
  children,
}: {
  /** Identifiant stable de la section (clé de mémorisation du repli). */
  id: string;
  title: string;
  /** Ligne affichée à droite du titre quand la section est repliée. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /**
   * Déplie la section quand la valeur change : sert aux liens internes (clic sur
   * un point de la courbe → la pesée correspondante, repliée dans l'historique).
   */
  openSignal?: number;
  /** Contenu posé sur la ligne de titre, visible seulement déplié (sélecteur de période…). */
  head?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useUiPref(SECTIONS_STORE, id, defaultOpen);

  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal == null || openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    setOpen(true);
  }, [openSignal, setOpen]);

  return (
    <div className="panel">
      <div className="sec-head">
        <button type="button" className="sec-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={`sec-chevron${open ? ' open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <h2>{title}</h2>
          {!open && summary != null && <span className="sec-summary">{summary}</span>}
        </button>
        {open && head}
      </div>
      {open && children}
    </div>
  );
}
