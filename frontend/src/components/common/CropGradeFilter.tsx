"use client";

import type { Severity } from "@/types/diagnosis";

type Crop = "" | "고추" | "무" | "배추";

export type Grade = Severity | "";

interface Props {
  crop: Crop;
  grade: Grade;
  onCropChange: (value: Crop) => void;
  onGradeChange: (value: Grade) => void;
}

const crops: { value: Crop; label: string }[] = [
  { value: "", label: "전체 작물" },
  { value: "고추", label: "고추" },
  { value: "무", label: "무" },
  { value: "배추", label: "배추" },
];

const grades: { value: Grade; label: string }[] = [
  { value: "", label: "전체" },
  { value: "high", label: "위험" },
  { value: "medium", label: "주의" },
  { value: "low", label: "낮음" },
];

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-base font-bold text-[#191919]">{label}</legend>
      <div className="grid grid-cols-4 gap-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={[
                "min-h-11 min-w-0 rounded-xl border px-1 py-2 text-sm font-semibold transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E8B57]",
                selected
                  ? "border-[#2E8B57] bg-[#EDF7F1] text-[#1F633D]"
                  : "border-[#ECECEF] bg-white text-[#6B6B6B] hover:bg-[#F7F7F8]",
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

export function CropGradeFilter({ crop, grade, onCropChange, onGradeChange }: Props) {
  return (
    <section aria-label="진단 이력 필터" className="space-y-5 rounded-2xl border border-[#ECECEF] bg-white p-4 sm:p-5">
      <FilterGroup label="작물" options={crops} value={crop} onChange={onCropChange} />
      <div className="border-t border-[#ECECEF] pt-5">
        <FilterGroup label="위험 등급" options={grades} value={grade} onChange={onGradeChange} />
      </div>
    </section>
  );
}
