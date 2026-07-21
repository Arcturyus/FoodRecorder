import type { CSSProperties, KeyboardEventHandler } from 'react';

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
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric';
  autoFocus?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
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
  placeholder,
  inputMode = 'decimal',
  autoFocus,
  onKeyDown,
  style,
  title,
}: NumberFieldProps) {
  const bump = (dir: 1 | -1) => {
    const current = parseFloat(String(value).replace(',', '.'));
    const base = Number.isFinite(current) ? current : min ?? 0;
    let next = base + dir * step;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    const d = decimalsOf(step);
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
        step={step}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" tabIndex={-1} onClick={() => bump(1)} aria-label="Augmenter">
        +
      </button>
    </span>
  );
}
