export interface RadioOption<TValue extends string | number> {
  label: string;
  description?: string;
  value: TValue;
}

export interface RadioGroupProps<TValue extends string | number> {
  name: string;
  legend: string;
  helperText?: string;
  value: TValue | null;
  options: ReadonlyArray<RadioOption<TValue>>;
  onChange: (value: TValue) => void;
}

export function RadioGroup<TValue extends string | number>({
  name,
  legend,
  helperText,
  value,
  options,
  onChange,
}: RadioGroupProps<TValue>) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{legend}</legend>
      {helperText ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0 0 0.5rem' }}>
          {helperText}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: '0.375rem' }}>
        {options.map((option) => (
          <label
            key={String(option.value)}
            style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}
          >
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              {option.description ? (
                <span style={{ color: '#6b7280', display: 'block', fontSize: '0.875rem' }}>
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
