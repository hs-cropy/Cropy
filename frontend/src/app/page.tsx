import { DiagnosisPageShell } from "@/components/DiagnosisPageActions";
import { DiagnoseForm } from "@/components/DiagnoseForm";

export default function HomePage() {
  return (
    <DiagnosisPageShell scrollLabel="진단하기">
      <div className="mx-auto w-full max-w-[27.5rem] pt-5 md:max-w-[44rem] md:pt-8 lg:max-w-[60rem]">
        <DiagnoseForm />
      </div>
    </DiagnosisPageShell>
  );
}