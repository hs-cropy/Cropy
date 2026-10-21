import { DiagnoseForm } from "@/components/DiagnoseForm";

// 화면 틀(DiagnosisPageShell)은 DiagnoseForm 이 그린다. 촬영 화면의 제목·버튼을
// 틀의 고정 영역에 서버 렌더 때부터 넣어야 하기 때문이다
export default function HomePage() {
  return <DiagnoseForm />;
}
