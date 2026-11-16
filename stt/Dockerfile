# CropCare AI - STT 서버 (sherpa-onnx + SenseVoice-Small int8, CPU)
#
# 모델 파일(약 240MB)은 빌드할 때 download_models.py 가 받아 SHA-256 을 확인한 뒤 이미지에 굽는다.
# 해시가 틀리면 빌드가 실패하므로, 서버에서는 이전 이미지가 그대로 돈다 (deploy/remote-update.sh).
# 백엔드가 STT_ENGINE=http, STT_SERVER_URL=http://stt:8200 으로 부른다. 외부에는 포트를 열지 않는다.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    STT_MODEL_DIR=/app/models

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.1 \
    && python -m pip install --no-cache-dir -r requirements.txt

# 모델은 코드보다 덜 바뀌므로 먼저 받아 레이어 캐시를 살린다
COPY download_models.py .
RUN python download_models.py

COPY server.py lexicon.py terms.txt ./

EXPOSE 8200

# 인식은 한 번에 하나씩 한다(server.py 의 _lock). 워커를 늘리면 모델이 워커 수만큼 메모리에 올라간다
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8200"]
