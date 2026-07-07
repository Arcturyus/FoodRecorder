import type { Nutrients } from '../nutrition/types';
import { RDA } from '../nutrition/rda';
import { fmt } from './format';

/** Bandeau macros + grille des micronutriments avec % des apports de référence. */
export function Totals({ totals }: { totals: Nutrients }) {
  const macros: { key: keyof Nutrients; label: string; unit: string }[] = [
    { key: 'proteines', label: 'Protéines', unit: 'g' },
    { key: 'glucides', label: 'Glucides', unit: 'g' },
    { key: 'lipides', label: 'Lipides', unit: 'g' },
    { key: 'fibres', label: 'Fibres', unit: 'g' },
  ];

  const micros = RDA.filter(
    (r) => !['kcal', 'proteines', 'glucides', 'lipides', 'fibres'].includes(r.key),
  );

  return (
    <div className="panel">
      <div className="macro-summary">
        <div className="m">
          <span className="v mono">{fmt(totals.kcal)}</span>
          <span className="l">kcal</span>
        </div>
        {macros.map((m) => (
          <div className="m" key={m.key}>
            <span className="v mono">
              {fmt(totals[m.key])}
              <span style={{ fontSize: 13 }}> {m.unit}</span>
            </span>
            <span className="l">{m.label}</span>
          </div>
        ))}
      </div>

      <div className="totals-grid" style={{ marginTop: 14 }}>
        {micros.map((r) => {
          const value = totals[r.key];
          const pct = r.rda > 0 ? (value / r.rda) * 100 : 0;
          const barClass = r.upperLimit ? (pct > 100 ? 'over' : '') : pct >= 100 ? 'good' : '';
          return (
            <div className="stat" key={r.key}>
              <div className="label">{r.label}</div>
              <div className="value mono">
                {fmt(value, value < 10 ? 1 : 0)} <small>{r.unit}</small>
              </div>
              <div className={`bar ${barClass}`}>
                <span style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="small mono">
                {fmt(pct)}% {r.upperLimit ? 'de la limite' : 'AJR'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
