
"use client";

import { useState } from "react";

import type { DiagnoseResponse } from "@/types/diagnosis";
import { Accordion } from "@/components/ui/Accordion";

interface DiagnosisDetailsProps {
  result: DiagnoseResponse;
  isRecord?: boolean;
}

type DetailKey =
  | "symptoms"
  | "causes"
  | "prevention"
  | "pesticides";

function MissingInformation({
  message = "현재 확인할 수 있는 정보가 없어요.",
}: {
  message?: string;
}) {
  return (
    <p
      role="note"
      className="rounded-xl bg-[#F7F7F8] p-4 text-base leading-6 text-[#6B6B6B]"
    >
      {message}
    </p>
  );
}

export function DiagnosisDetails({
  result,
  isRecord = false,
}: DiagnosisDetailsProps) {
  // 한 번에 하나의 항목만 펼친다.
  const [openKey, setOpenKey] = useState<DetailKey | null>(null);

  const toggle = (key: DetailKey) => {
    setOpenKey((previous) =>
      previous === key ? null : key
    );
  };

  // 이력 상세에서는 현재 카탈로그 정보와
  // 저장 당시 조회 제품을 구분한다.
  const pesticides = isRecord
    ? result.current_pesticides ?? []
    : result.pesticides;

  return (
    <section
      aria-label="진단 상세 정보"
      className="space-y-3"
    >
      <div className="mb-4">
        <h2 className="text-xl font-extrabold text-[#191919]">
          상세 정보
        </h2>
        <p className="mt-1 text-base leading-6 text-[#6B6B6B]">
          필요한 항목을 눌러 자세한 내용을 확인하세요.
        </p>
      </div>

      {/* 1. 증상 */}
      <Accordion
        title="증상"
        open={openKey === "symptoms"}
        onToggle={() => toggle("symptoms")}
      >
        {result.description ? (
          <div className="space-y-3">
            <p className="whitespace-pre-line text-base leading-7 text-[#191919]">
              {result.description}
            </p>

            <p className="text-sm leading-6 text-[#6B6B6B]">
              사진 속 증상과 비교해 주세요.
              AI 진단은 참고용입니다.
            </p>
          </div>
        ) : (
          <MissingInformation message="이 병해의 증상 설명을 확인할 수 없어요." />
        )}
      </Accordion>

      {/* 2. 원인 */}
      <Accordion
        title="원인"
        open={openKey === "causes"}
        onToggle={() => toggle("causes")}
      >
        {result.causes?.length > 0 ? (
          <ul className="space-y-3">
            {result.causes.map((cause, index) => (
              <li
                key={index}
                className="flex items-start gap-3 text-base leading-7 text-[#191919]"
              >
                <span
                  aria-hidden="true"
                  className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2E8B57]"
                />
                <span>{cause}</span>
              </li>
            ))}
          </ul>
        ) : (
          <MissingInformation message="이 병해의 발병 원인 정보를 확인할 수 없어요." />
        )}
      </Accordion>

      {/* 3. 예방법 */}
      <Accordion
        title="예방법"
        open={openKey === "prevention"}
        onToggle={() => toggle("prevention")}
      >
        {result.prevention?.length > 0 ? (
          <ol className="space-y-4">
            {result.prevention.map((item, index) => (
              <li
                key={index}
                className="flex items-start gap-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EDF7F1] text-sm font-bold text-[#2E8B57]">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <p className="pt-0.5 text-base leading-7 text-[#191919]">
                  {item}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <MissingInformation message="이 병해의 예방법 정보를 확인할 수 없어요." />
        )}
      </Accordion>

      {/* 4. 등록 농약 */}
      <Accordion
        title="등록 농약"
        open={openKey === "pesticides"}
        onToggle={() => toggle("pesticides")}
      >
        <div className="space-y-4">
          <p className="text-base font-semibold leading-6 text-[#191919]">
            작물·병해에 맞는 등록 정보 확인
          </p>

          {isRecord && result.pesticides.length > 0 && (
            <div className="rounded-xl bg-[#F7F7F8] p-4">
              <p className="text-sm font-semibold text-[#191919]">
                저장 당시 조회한 제품
              </p>

              <p className="mt-1 break-words text-base leading-6 text-[#6B6B6B]">
                {result.pesticides
                  .map((p) => p.name)
                  .join(", ")}
              </p>

              <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
                아래 사용 조건은 저장 당시 정보가 아닌
                현재 조회 가능한 카탈로그 정보예요.
              </p>
            </div>
          )}

          {pesticides.length === 0 ? (
            <MissingInformation
              message={
                isRecord
                  ? "현재 카탈로그에서 확인할 수 있는 등록 농약 정보가 없어요. 최신 등록정보와 제품 라벨을 확인해 주세요."
                  : "현재 연결된 등록 농약 정보가 없어요. 확인되지 않은 제품명이나 사용량은 표시하지 않습니다."
              }
            />
          ) : (
            <div className="space-y-3">
              {pesticides.map((p, index) => {
                const verified =
                  p.verification_status === "verified";

                const phiDays = verified
                  ? p.safety?.phi_days
                  : null;

                const reentryHours = verified
                  ? p.safety?.reentry_hours
                  : null;

                return (
                  <div
                    key={`${p.usage_id ?? p.name}-${index}`}
                    className="rounded-xl border border-[#ECECEF] bg-[#F7F7F8] p-4"
                  >
                    <h4 className="text-base font-bold text-[#191919]">
                      {p.name}
                    </h4>

                    {p.active_ingredient && (
                      <p className="mt-2 text-sm leading-6 text-[#6B6B6B]">
                        유효성분: {p.active_ingredient}
                      </p>
                    )}

                    {!verified && (
                      <p className="mt-3 rounded-lg bg-[#FFF1F0] p-3 text-sm leading-6 text-[#B42318]">
                        이 작물·병해에 대한 사용 조건이
                        검증되지 않았어요. 희석비·사용법·
                        안전사용기준을 표시하지 않습니다.
                      </p>
                    )}

                    {/* 검증된 사용 조건만 표시 */}
                    {verified && (
                      <dl className="mt-4 space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <dt className="w-24 shrink-0 text-sm font-semibold text-[#6B6B6B]">
                            작물 / 병해
                          </dt>
                          <dd className="flex-1 text-sm text-[#191919]">
                            {result.crop_type || "확인 필요"}
                            {" / "}
                            {result.disease_name}
                          </dd>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <dt className="w-24 shrink-0 text-sm font-semibold text-[#6B6B6B]">
                            희석비
                          </dt>
                          <dd className="flex-1 text-sm font-semibold text-[#191919]">
                            {p.dilution ?? "제품 라벨 확인"}
                          </dd>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <dt className="w-24 shrink-0 text-sm font-semibold text-[#6B6B6B]">
                            사용법
                          </dt>
                          <dd className="flex-1 whitespace-pre-line text-sm leading-6 text-[#191919]">
                            {p.usage ?? "제품 라벨 확인"}
                          </dd>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <dt className="w-24 shrink-0 text-sm font-semibold text-[#6B6B6B]">
                            수확 전 일수
                          </dt>
                          <dd className="flex-1 text-sm font-semibold text-[#191919]">
                            {phiDays != null
                              ? `${phiDays}일`
                              : "제품 라벨 확인"}
                          </dd>
                        </div>

                        {reentryHours != null && (
                          <div className="flex flex-wrap gap-2">
                            <dt className="w-24 shrink-0 text-sm font-semibold text-[#6B6B6B]">
                              재입장
                            </dt>
                            <dd className="flex-1 text-sm font-semibold text-[#191919]">
                              {reentryHours}시간
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {verified && p.safety_notes && (
                      <p className="mt-3 rounded-lg bg-[#FFF1F0] p-3 text-sm leading-6 text-[#B42318]">
                        {p.safety_notes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="rounded-xl bg-[#EDF7F1] p-4 text-sm font-semibold leading-6 text-[#26784B]">
            농약 사용 전 해당 작물과 병해의 최신 등록 여부,
            제품 라벨 및 안전사용기준을 반드시 확인하세요.
          </p>
        </div>
      </Accordion>
    </section>
  );
}
