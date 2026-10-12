
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
  variant?: "crop" | "grade";
  disabled?: boolean;
}

export function FilterChips<T extends string>({
  title,
  options,
  value,
  onChange,
  variant = "crop",
  disabled = false,
}: FilterChipsProps<T>) {
  const isCrop = variant === "crop";

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend
        className={
          isCrop
            ? "sr-only"
            : "mb-3 text-[13px] font-bold text-[#191919]"
        }
      >
        {title}
      </legend>

      <div
        className={`grid gap-2 ${
          isCrop ? "grid-cols-3" : "grid-cols-4"
        }`}
      >
        {options.map((option) => {
          const active = value === option.value;

          return (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={[
                "flex w-full items-center justify-center",
                "border text-center transition-colors",
                "focus-visible:outline-2",
                "focus-visible:outline-offset-2",
                "focus-visible:outline-[#2E8B57]",
                "disabled:opacity-50",
                isCrop
                  ? "min-h-12 rounded-xl px-2 py-2 text-sm"
                  : "min-h-9 rounded-full px-1 py-2 text-xs",
                active
                  ? isCrop
                    ? "border-[#2E8B57] bg-[#EDF7F1] font-bold text-[#2E8B57]"
                    : "border-[#191919] bg-[#191919] font-bold text-white"
                  : "border-[#ECECEF] bg-white font-medium text-[#6B6B6B]",
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
