"""LLM 안내 응답과 템플릿 대체 여부를 구분하는 계약."""
from typing import Literal

from pydantic import BaseModel


class LLMGuidanceResponse(BaseModel):
    text: str
    source: Literal["llm", "template"]
    fallback_reason: Literal["unavailable", "timeout", "error", "invalid_response"] | None = None
