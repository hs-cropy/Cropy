"""검증된 기능 선택을 처리한 결과."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LLMFunctionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    function_name: str
    status: Literal[
        "ok",
        "insufficient_information",
        "needs_clarification",
        "unsupported_scope",
    ]
    text: str = Field(min_length=1)