import type { CSSProperties, FocusEventHandler, KeyboardEventHandler } from 'react';

function decimalsOf(step: number): number {
  const s = step.toString();
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

type NumberFieldProps = {
  value: string | number;
  onChange: (raw: string) => void;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Attribut `step` de l'input, indépendamment du pas des boutons +/−.
   * `'any'` sur les quantités d'aliment : 1,5 pièce est une saisie légitime, et
   * `step=1` la faisait passer en état `:invalid` silencieux.
   */
  inputStep?: number | 'any';
  /**
   * Pas qui grandit avec la valeur (quantités d'aliment). Avancer de 1 en 1
   * depuis 200 g de riz est interminable ; au-delà de 50 on monte de 5, au-delà
   * de 200 de 10, en retombant sur des nombres ronds. Hors quantités (poids,
   * taille, âge), le pas doit rester fixe — d'où l'option explicite.
   */
  adaptiveStep?: boolean;
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric';
  autoFocus?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  style?: CSSProperties;
  title?: string;
};

/**
 * Champ numérique avec vrais boutons +/- (le spinner natif est masqué :
 * son rendu diffère trop selon les navigateurs pour rester lisible sur ce thème).
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  inputStep,
  adaptiveStep = false,
  placeholder,
  inputMode = 'decimal',
  autoFocus,
  onKeyDown,
  onFocus,
  style,
  title,
}: NumberFieldProps) {
  /** Pas effectif à cette valeur (cf. `adaptiveStep`). */
  const stepAt = (v: number): number => {
    if (!adaptiveStep) return step;
    const a = Math.abs(v);
    if (a >= 200) return 10;
    if (a >= 50) return 5;
    return step;
  };

  const bump = (dir: 1 | -1) => {
    const current = parseFloat(String(value).replace(',', '.'));
    const base = Number.isFinite(current) ? current : min ?? 0;
    const s = stepAt(base);
    // Pas élargi : on retombe sur le multiple suivant (53 → 55 → 60), pas sur
    // 53 + 5. Pas nominal : incrément simple, pour ne pas déplacer une valeur
    // que l'utilisateur a saisie au dixième près.
    let next = s > step ? (dir > 0 ? Math.floor(base / s + 1) : Math.ceil(base / s - 1)) * s : base + dir * s;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    const d = decimalsOf(s);
    next = Math.round(next * 10 ** d) / 10 ** d;
    onChange(String(next));
  };

  return (
    <span className="number-field" style={style} data-tip={title}>
      <button type="button" tabIndex={-1} onClick={() => bump(-1)} aria-label="Diminuer">
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        step={inputStep ?? step}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" tabIndex={-1} onClick={() => bump(1)} aria-label="Augmenter">
        +
      </button>
    </span>
  );
}
