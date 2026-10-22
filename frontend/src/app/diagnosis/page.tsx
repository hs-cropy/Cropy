import { DiagnosisPage } from "@/components/diagnosis/DiagnosisPage";

// 진단 결과 화면. 진단 상태(고른 사진·진행 중인 요청·결과)는 앱 틀의 DiagnosisSessionProvider 가 갖는다
export default function DiagnosisRoute() {
  return <DiagnosisPage />;
}
