"""음성 질문: 문장 받아 적기 → 기능 고르기 → 저장된 진단 근거로 답변 문장.

세 단계는 따로 호출한다. 기능 선택 모델은 기기에 따라 다른 곳에서 돌기 때문이다
(서버 경유 /voice/select-function, 브라우저 안 Qwen q4f16·소형 분류기, 오렌지파이 RKLLM). 어디서 골랐든
결과 문자열은 같고, /voice/function-call 하나가 모든 배포의 공통 출구다. TTS는 하지 않는다.
"""

import logging

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app.api.documentation import DATABASE_ERROR, error_response
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.device import device_id as current_device
from app.core.errors import APIError
from app.schemas.llm_function_response import LLMFunctionResponse
from app.schemas.voice import SelectFunctionRequest, SelectFunctionResponse, TranscriptResponse, VoiceFunctionCallRequest
from app.services import diagnosis_service, function_selector, stt_service
from app.services.function_contract import FunctionContractUnavailable, get_function_contract
from app.services.llm_context import build_llm_input
from app.services.llm_function_handler import FunctionHandlerNotImplemented, handle_function_output
from app.services.llm_function_parser import InvalidFunctionContract, InvalidFunctionOutput
from app.services.voice_context import compact_context

router = APIRouter()
logger = logging.getLogger(__name__)

_NOT_FOUND = ("DIAGNOSIS_NOT_FOUND", "진단 기록을 찾을 수 없습니다.")


def _detail_with_session(diagnosis_id: str, device: str):
    db = SessionLocal()
    try:
        return diagnosis_service.get_diagnosis_detail(db, diagnosis_id, device)
    finally:
        db.close()


async def _diagnosis_or_404(diagnosis_id: str, device: str):
    result = await run_in_threadpool(_detail_with_session, diagnosis_id, device)
    if not result:
        raise APIError(404, *_NOT_FOUND)
    return result


@router.post(
    "/voice/transcribe",
    response_model=TranscriptResponse,
    summary="음성(wav) 받아 적기",
    description=(
        "16비트 PCM wav 본문(`Content-Type: audio/wav`)을 STT 서버로 넘겨 문장을 돌려줍니다. 브라우저 녹음(webm·mp4)은 "
        "클라이언트에서 16kHz 모노 wav로 바꿔 보냅니다. 학습 문장에 맞춰 문장부호는 지웁니다. 말소리가 없으면 빈 문자열입니다. "
        "STT_ENGINE이 off이거나 STT 서버가 응답하지 않으면 503 STT_UNAVAILABLE입니다."
    ),
    responses={
        400: error_response("wav가 아니거나 비어 있음", "AUDIO_INVALID", example_detail="음성 파일을 읽을 수 없습니다."),
        413: error_response("음성이 STT_MAX_AUDIO_MB(기본 5MB)를 넘음", "AUDIO_TOO_LARGE", example_detail="음성이 너무 깁니다."),
        503: error_response("음성 인식을 사용할 수 없음", "STT_UNAVAILABLE", True, example_detail="음성 인식을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."),
    },
)
async def voice_transcribe(request: Request) -> TranscriptResponse:
    limit = settings.stt_max_audio_mb * 1024 * 1024
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > limit:
        raise APIError(413, "AUDIO_TOO_LARGE", "음성이 너무 깁니다.")
    audio = await request.body()
    if not audio:
        raise APIError(400, "AUDIO_INVALID", "음성 파일을 읽을 수 없습니다.")
    if len(audio) > limit:
        raise APIError(413, "AUDIO_TOO_LARGE", "음성이 너무 깁니다.")
    if not audio.startswith(b"RIFF"):
        raise APIError(400, "AUDIO_INVALID", "16비트 PCM wav만 받습니다.")

    try:
        text = await run_in_threadpool(stt_service.transcribe, audio)
    except stt_service.InvalidAudioError as error:
        raise APIError(400, "AUDIO_INVALID", str(error))
    except stt_service.STTUnavailableError:
        raise APIError(503, "STT_UNAVAILABLE", "음성 인식을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", True)
    return TranscriptResponse(text=text)


@router.post(
    "/voice/select-function",
    response_model=SelectFunctionResponse,
    summary="발화와 화면 상태로 기능 고르기 (서버 경유)",
    description=(
        "발화와 보고 있는 진단(`diagnosis_id`, 선택)·화면 단계(`ui_stage`)로 학습 때와 같은 화면 상태를 만들어 "
        "기능 선택 모델 서버에 넘기고, 결과 호출 문자열과 모델에 넣은 화면 상태를 돌려줍니다. 결과는 그대로 "
        "`/voice/function-call`에 보냅니다. 브라우저·보드에서 모델을 직접 돌리는 기기는 이 단계를 건너뜁니다. "
        "FUNCTION_SELECTOR_ENGINE이 off이거나 모델 서버가 응답하지 않으면 503 FUNCTION_SELECTOR_UNAVAILABLE입니다."
    ),
    responses={
        404: error_response("진단 기록을 찾을 수 없습니다.", "DIAGNOSIS_NOT_FOUND"),
        503: error_response("기능 선택 모델 서버 사용 불가(FUNCTION_SELECTOR_UNAVAILABLE) 또는 DB(DATABASE_UNAVAILABLE)",
                            "FUNCTION_SELECTOR_UNAVAILABLE", True,
                            example_detail="질문을 알아듣는 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."),
    },
)
async def voice_select_function(body: SelectFunctionRequest, device: str = Depends(current_device)) -> SelectFunctionResponse:
    diagnosis = await _diagnosis_or_404(body.diagnosis_id, device) if body.diagnosis_id else None
    context = compact_context(diagnosis, body.ui_stage)
    try:
        call = await run_in_threadpool(function_selector.select, body.utterance.strip(), context)
    except function_selector.FunctionSelectorUnavailableError:
        raise APIError(503, "FUNCTION_SELECTOR_UNAVAILABLE", "질문을 알아듣는 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", True)
    logger.info("voice select-function -> %s", call)
    return SelectFunctionResponse(function_call=call, context=context)


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
        context = build_llm_input(await _diagnosis_or_404(body.diagnosis_id, device))
    else:
        context = body.context

    try:
        response = handle_function_output(body.function_call, context, contract)
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
