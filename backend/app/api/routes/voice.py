"""음성 기능 호출: 기능 선택 모델의 출력 한 줄을 받아 저장된 진단 근거로 답변 문장을 만든다.

모델은 서버·브라우저(Qwen q4f16, 소형 분류기)·보드(RKLLM) 어디서 돌아도 같은 문자열을 내므로,
이 엔드포인트 하나가 모든 배포의 공통 출구다. 모델 실행·STT·TTS는 여기서 하지 않는다.
"""

import logging

from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool

from app.api.documentation import DATABASE_ERROR, error_response
from app.core.database import SessionLocal
from app.core.device import device_id as current_device
from app.core.errors import APIError
from app.schemas.llm_function_response import LLMFunctionResponse
from app.schemas.voice import VoiceFunctionCallRequest
from app.services import diagnosis_service
from app.services.function_contract import FunctionContractUnavailable, get_function_contract
from app.services.llm_context import build_llm_input
from app.services.llm_function_handler import FunctionHandlerNotImplemented, handle_function_output
from app.services.llm_function_parser import InvalidFunctionContract, InvalidFunctionOutput

router = APIRouter()
logger = logging.getLogger(__name__)


def _detail_with_session(diagnosis_id: str, device: str):
    db = SessionLocal()
    try:
        return diagnosis_service.get_diagnosis_detail(db, diagnosis_id, device)
    finally:
        db.close()


@router.post(
    "/voice/function-call",
    response_model=LLMFunctionResponse,
    summary="기능 호출 문자열로 답변 문장 만들기",
    description=(
        "기능 선택 모델이 낸 `<hs_번호>(인자=값, ...)<hs_end>` 한 줄과 진단 문맥을 받아, 저장된 진단 근거로 "
        "읽어 줄 답변 문장을 돌려줍니다. 문맥은 이 기기의 `diagnosis_id` 또는 브라우저 오프라인 진단의 "
        "`context`(LLM 입력 계약) 중 하나로 줍니다. 모델이 서버·브라우저·보드 어디서 돌았는지는 `source`로만 "
        "구분하고 동작은 같습니다. 형식이 틀리거나 계약 범위를 벗어난 호출은 400, 아직 handler가 없는 기능은 501입니다."
    ),
    responses={
        400: error_response("기능 호출 문자열이 계약과 맞지 않음", "FUNCTION_CALL_INVALID",
                            example_detail="기능 호출 형식이 올바르지 않습니다."),
        404: error_response("진단 기록을 찾을 수 없습니다.", "DIAGNOSIS_NOT_FOUND"),
        501: error_response("형식은 유효하지만 아직 답변을 만들 수 없는 기능", "FUNCTION_NOT_IMPLEMENTED",
                            example_detail="아직 답변을 준비하지 못한 기능입니다."),
        503: error_response("함수 계약 파일을 읽을 수 없음(FUNCTION_CONTRACT_UNAVAILABLE) 또는 DB(DATABASE_UNAVAILABLE)",
                            "FUNCTION_CONTRACT_UNAVAILABLE", True,
                            example_detail="음성 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."),
    },
)
async def voice_function_call(body: VoiceFunctionCallRequest, device: str = Depends(current_device)) -> LLMFunctionResponse:
    try:
        contract = get_function_contract()
    except FunctionContractUnavailable:
        raise APIError(503, "FUNCTION_CONTRACT_UNAVAILABLE", "음성 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", True)

    if body.diagnosis_id is not None:
        result = await run_in_threadpool(_detail_with_session, body.diagnosis_id, device)
        if not result:
            raise APIError(404, "DIAGNOSIS_NOT_FOUND", "진단 기록을 찾을 수 없습니다.")
        context = build_llm_input(result)
    else:
        context = body.context

    try:
        response = handle_function_output(body.function_call, context, contract, ui_stage=body.ui_stage)
    except InvalidFunctionOutput as error:
        logger.info("voice function call rejected (%s): %s", body.source, error)
        raise APIError(400, "FUNCTION_CALL_INVALID", "기능 호출 형식이 올바르지 않습니다.")
    except FunctionHandlerNotImplemented as error:
        logger.info("voice function call not implemented (%s): %s", body.source, error)
        raise APIError(501, "FUNCTION_NOT_IMPLEMENTED", "아직 답변을 준비하지 못한 기능입니다.")
    except InvalidFunctionContract as error:
        # 계약 파일과 handler 구현이 어긋난 경우(배포 설정 문제). 요청 탓이 아니다.
        logger.error("function contract does not match handlers: %s", error)
        raise APIError(503, "FUNCTION_CONTRACT_UNAVAILABLE", "음성 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", True)

    logger.info("voice function call %s -> %s/%s", body.source, response.function_name, response.status)
    return response
