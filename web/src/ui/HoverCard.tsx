import type { ReactNode } from 'react';

/**
 * Info-bulle riche (remplace les `title` natifs) : un contenu quelconque
 * affiché dans un popover stylé au survol OU au focus/tap (mobile). Purement
 * CSS pour la visibilité ; `align` évite le débordement près des bords.
 */
export function HoverCard({
  children,
  card,
  align = 'center',
  className,
}: {
  children: ReactNode;
  card: ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
}) {
  return (
    <span className={`hovercard ${className ?? ''}`} tabIndex={0}>
      {children}
      <span className={`hovercard-pop hc-${align}`} role="tooltip">
        {card}
      </span>
    </span>
  );
}
