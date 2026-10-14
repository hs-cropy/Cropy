
"use client";

import { Chip } from "@/components/Chip";

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

  // 작물별 전체 진단 기록 건수
  counts?: Record<string, number | null>;
}

export function FilterChips<T extends string>({
  title,
  options,
  value,
  onChange,
  variant = "crop",
  disabled = false,
  counts,
}: FilterChipsProps<T>) {
  const isCrop = variant === "crop";

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend
        className={
          isCrop
            ? "sr-only"
            : "mb-3 text-cropy-caption font-bold text-cropy-text-primary"
        }
      >
        {title}
      </legend>
      <div className="flex w-full gap-2 lg:flex-wrap">
        {options.map((option) => {
          const selected = value === option.value;
          const count = counts?.[option.value];

          return isCrop ? (
            <Chip
              key={option.value || "all"}
              kind="crop"
              selected={selected}
              disabled={disabled}
              count={count ?? undefined}
              onClick={() => onChange(option.value)}
              className="min-w-0 flex-1 lg:flex-none"
            >
              {option.label}
            </Chip>
          ) : (
            <Chip
              key={option.value || "all"}
              kind="grade"
              selected={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className="min-w-0 flex-1 lg:flex-none"
            >
              {option.label}
            </Chip>
          );
        })}
      </div>
    </fieldset>
  );
}
