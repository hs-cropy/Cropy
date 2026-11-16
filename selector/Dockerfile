# CropCare AI - 기능 선택 서버 (소형 분류기 mobile_clf, onnxruntime CPU)
#
# 모델 파일은 이미지에 굽지 않는다. docker-compose 가 frontend/public/offline-assets 를 /offline-assets 로
# 마운트하고, 서버는 function-models.json 이 가리키는 mobile_clf 묶음을 읽는다(휴대폰이 받는 것과 같은 파일).
# 묶음이 없으면 /health 가 error 이고 음성 질문만 503 이다. 진단은 영향이 없다.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    OFFLINE_ASSETS=/offline-assets

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.1 \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8300

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8300"]
