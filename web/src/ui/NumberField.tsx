import { useEffect, useRef } from 'react';
import type { CSSProperties, FocusEventHandler, KeyboardEventHandler, PointerEvent } from 'react';

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
  /** Valeur de départ des boutons lorsque le champ est vide. */
  suggestedBase?: number;
  repeatOnHold?: boolean;
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
  suggestedBase,
  repeatOnHold = false,
  placeholder,
  inputMode = 'decimal',
  autoFocus,
  onKeyDown,
  onFocus,
  style,
  title,
}: NumberFieldProps) {
  const repeatTimer = useRef<ReturnType<typeof setTimeout>>();
  const stopRepeat = () => {
    clearTimeout(repeatTimer.current);
    repeatTimer.current = undefined;
  };
  useEffect(() => {
    window.addEventListener('blur', stopRepeat);
    return () => {
      stopRepeat();
      window.removeEventListener('blur', stopRepeat);
    };
  }, []);
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
    const base = Number.isFinite(current) ? current : suggestedBase ?? min ?? 0;
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
  const latestBump = useRef(bump);
  latestBump.current = bump;

  const startRepeat = (event: PointerEvent<HTMLButtonElement>, dir: 1 | -1) => {
    if (!repeatOnHold || event.button !== 0) return;
    event.preventDefault();
    stopRepeat();
    event.currentTarget.setPointerCapture(event.pointerId);
    bump(dir);
    const repeat = () => {
      latestBump.current(dir);
      repeatTimer.current = setTimeout(repeat, 100);
    };
    repeatTimer.current = setTimeout(repeat, 400);
  };

  const buttonProps = (dir: 1 | -1) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => startRepeat(event, dir),
    onPointerUp: stopRepeat,
    onPointerCancel: stopRepeat,
    onLostPointerCapture: stopRepeat,
    onPointerLeave: stopRepeat,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!repeatOnHold || event.detail === 0) bump(dir);
    },
    style: repeatOnHold ? { touchAction: 'none', userSelect: 'none' } as CSSProperties : undefined,
    onContextMenu: repeatOnHold ? (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault() : undefined,
  });

  return (
    <span className="number-field" style={style} data-tip={title}>
      <button type="button" tabIndex={-1} {...buttonProps(-1)} aria-label="Diminuer">
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
      <button type="button" tabIndex={-1} {...buttonProps(1)} aria-label="Augmenter">
        +
      </button>
    </span>
  );
}
