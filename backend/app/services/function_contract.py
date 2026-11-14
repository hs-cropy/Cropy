"""기능 선택 모델의 함수 계약(cropy_prompt.json 형식)을 설정 경로에서 읽어 둔다.

계약은 모델 폴더의 `cropy_prompt.json`과 같은 형식이다. 기본값은 `app/data/function_contract.json`으로,
`ml/qwen/spec_v2.py`에서 만든 hs-call-v2 계약이다. 모델이 어디서 돌든(서버·브라우저·보드) 같은
계약을 쓰므로, 배포 모델을 바꿀 때는 LLM_FUNCTION_CONTRACT_PATH를 그 모델 폴더의 파일로 바꾼다.
"""

import logging
import threading
from pathlib import Path

from app.core.config import settings
from app.services.llm_function_parser import (
    FunctionContract,
    InvalidFunctionContract,
    load_function_contract,
)

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_cache: dict[Path, FunctionContract] = {}


class FunctionContractUnavailable(RuntimeError):
    """계약 파일이 없거나 형식이 맞지 않아 기능 호출을 처리할 수 없다."""


def contract_path() -> Path:
    return Path(settings.llm_function_contract_path)


def get_function_contract() -> FunctionContract:
    """경로별로 한 번만 읽는다. 파일이 바뀌면 설정 경로를 바꾸거나 프로세스를 다시 띄운다."""
    path = contract_path().resolve()
    with _lock:
        contract = _cache.get(path)
        if contract is None:
            try:
                contract = load_function_contract(path)
            except (OSError, InvalidFunctionContract) as error:
                logger.error("function contract unavailable: %s (%s)", path, error)
                raise FunctionContractUnavailable(str(error)) from error
            _cache[path] = contract
    return contract


def is_function_contract_available() -> bool:
    try:
        get_function_contract()
    except FunctionContractUnavailable:
        return False
    return True


def reset_cache() -> None:
    """테스트에서 설정 경로를 바꾼 뒤 다시 읽게 한다."""
    with _lock:
        _cache.clear()
