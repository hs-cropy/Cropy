"""음성 기능 호출 API의 요청 계약. 기능 선택 모델이 어디서 돌았든 결과 문자열은 같다."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.llm import DiagnosisLLMInput

# 어느 기능 선택기가 문자열을 만들었는지. 동작은 같고 로그·통계에만 쓴다.
FunctionCallSource = Literal["server", "web_qwen", "ios_clf", "board_rkllm", "test"]


class VoiceFunctionCallRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "diagnosis_id": "2ad7851e-375d-4099-b24b-872aa6a0ad04",
                    "function_call": "<hs_0>(topic=1)<hs_end>",
                    "source": "ios_clf",
                }
            ]
        },
    )

    # 둘 중 하나만 보낸다. diagnosis_id는 이 기기의 저장된 진단, context는 브라우저 오프라인 진단처럼
    # 서버에 기록이 없는 경우의 LLM 입력 계약(DiagnosisLLMInput)이다.
    diagnosis_id: str | None = Field(default=None, min_length=1, max_length=64)
    context: DiagnosisLLMInput | None = None
    # 기능 선택 모델의 출력 한 줄. 예: <hs_4>(topic=2, product=1)<hs_end>
    function_call: str = Field(min_length=1, max_length=512)
    source: FunctionCallSource = "server"

    @model_validator(mode="after")
    def _exactly_one_context(self):
        if (self.diagnosis_id is None) == (self.context is None):
            raise ValueError("diagnosis_id 또는 context 중 하나만 보내 주세요.")
        return self
