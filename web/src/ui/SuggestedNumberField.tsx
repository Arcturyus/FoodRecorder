import type { ComponentProps } from 'react';
import { NumberField } from './NumberField';

type Props = Omit<ComponentProps<typeof NumberField>, 'placeholder' | 'onFocus'> & {
  suggestedValue?: number;
  accepted: boolean;
  onAccept: () => void;
};

/**
 * La dernière mesure reste une aide visuelle : elle ne devient une valeur
 * enregistrable qu'au premier focus. Effacer ensuite laisse vraiment le champ
 * vide, sans faire réapparaître la suggestion.
 */
export function SuggestedNumberField({ suggestedValue, accepted, onAccept, value, onChange, ...props }: Props) {
  const suggestion = suggestedValue == null ? undefined : String(suggestedValue).replace('.', ',');
  return (
    <NumberField
      {...props}
      value={value}
      placeholder={!accepted ? suggestion : undefined}
      onFocus={() => {
        if (accepted) return;
        onAccept();
        if (suggestedValue != null) onChange(String(suggestedValue));
      }}
      onChange={onChange}
    />
  );
}
