
"use client";

interface FilterOption<T extends string> {
  value: T;
  label: string;
}

interface FilterChipsProps<T extends string> {
  title: string;
  options: readonly FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function FilterChips<T extends string>({
  title,
  options,
  value,
  onChange,
  disabled = false,
}: FilterChipsProps<T>) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-3 text-base font-bold text-[#191919]">
        {title}
      </legend>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option.value;

          return (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={[
                "min-h-12 rounded-xl border px-4 py-2",
                "text-base font-semibold transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-[#2E8B57]",
                "disabled:opacity-50",
                selected
                  ? "border-[#2E8B57] bg-[#2E8B57] text-white"
                  : "border-[#ECECEF] bg-white text-[#191919] hover:border-[#2E8B57]",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
