import { useEffect, useRef, useState } from 'react';
import { todayStr } from '../store/store';

/** Date locale N jours avant aujourd'hui. */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayStr(d);
}

/** « samedi 2 août » (long) ou « 2 août » (court). */
export function dayLabel(date: string, short = false): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(
    'fr-FR',
    short ? { day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long' },
  );
}

/** « aujourd'hui », « hier », sinon le jour écrit. */
export function relativeDayLabel(date: string): string {
  if (date === todayStr()) return "aujourd'hui";
  if (date === daysAgo(1)) return 'hier';
  if (date === daysAgo(2)) return 'avant-hier';
  return `le ${dayLabel(date, true)}`;
}

/**
 * Bouton qui ouvre un petit panneau de choix de jour : raccourcis (aujourd'hui,
 * hier, avant-hier) puis calendrier natif pour remonter plus loin. Jamais de
 * jour futur — le journal ne décrit que ce qui a déjà été mangé.
 *
 * Sert partout où une action doit viser un autre jour qu'aujourd'hui : recopier
 * un repas sur hier, dupliquer une journée, choisir le jour de saisie.
 */
export function DayPickerButton({
  label,
  tip,
  onPick,
  /** Jour à ne pas proposer (celui sur lequel on est déjà). */
  exclude,
  className = 'ghost small',
}: {
  label: string;
  tip?: string;
  onPick: (date: string) => void;
  exclude?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const today = todayStr();

  // Fermeture au clic à côté / Échap : un panneau flottant qui reste ouvert
  // masque les lignes du repas en dessous.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (date: string) => {
    setOpen(false);
    onPick(date);
  };

  const shortcuts = [
    { date: today, label: "Aujourd'hui" },
    { date: daysAgo(1), label: 'Hier' },
    { date: daysAgo(2), label: 'Avant-hier' },
  ].filter((s) => s.date !== exclude);

  return (
    <span className="day-pick" ref={box}>
      <button className={className} data-tip={tip} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className="day-pop" role="dialog" aria-label="Choisir un jour">
          <div className="day-pop-title">Vers quel jour ?</div>
          <div className="day-pop-shortcuts">
            {shortcuts.map((s) => (
              <button key={s.date} className="ghost small" onClick={() => pick(s.date)}>
                {s.label}
              </button>
            ))}
          </div>
          <label className="day-pop-date">
            Autre jour
            <input
              type="date"
              max={today}
              onChange={(e) => e.target.value && e.target.value <= today && pick(e.target.value)}
            />
          </label>
        </div>
      )}
    </span>
  );
}

/**
 * Bandeau « je saisis pour tel jour » : garde le cas normal (aujourd'hui) à zéro
 * clic, et permet de basculer toute la page sur un jour passé pour rattraper un
 * oubli sans passer par le calendrier de l'historique.
 */
export function DaySwitcher({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const today = todayStr();
  const isToday = date === today;

  return (
    <div className={`day-switch${isToday ? '' : ' past'}`}>
      <span className="day-switch-label">
        {isToday ? 'Journée du jour' : <>Vous consultez&nbsp;: <strong>{dayLabel(date)}</strong></>}
      </span>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {!isToday && (
          <button className="ghost small" onClick={() => onChange(today)}>
            ↩ Revenir à aujourd'hui
          </button>
        )}
        {isToday && (
          <button className="ghost small" onClick={() => onChange(daysAgo(1))}>
            Hier
          </button>
        )}
        <DayPickerButton
          label="📅 Un autre jour…"
          tip="Consulter et compléter un autre jour (oubli d'hier, saisie du lendemain…)"
          exclude={date}
          onPick={onChange}
        />
      </span>
    </div>
  );
}
