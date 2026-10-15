# 모바일 사진 업로드

서버 진단·재촬영·오프라인 기록 동기화 API에서 JPEG, PNG, HEIC/HEIF,
DNG(RAW), WebP, AVIF를 받는다. 확장자/MIME만으로 허용하지 않고 실제 파일을
디코딩한다. MIME 누락 및 application/octet-stream도 같은 검증을 거친다.

- HEIC/HEIF는 pillow-heif, DNG는 rawpy/LibRaw, 나머지는 Pillow로 읽는다.
- 새 형식은 JPEG로 저장한다. RAW는 카메라 화이트밸런스와 sRGB를 사용해 현상한다.
- 긴 변 4096픽셀 초과 사진은 비율을 유지해 축소하고 JPEG로 저장한다.
- 변환 사진은 방향을 적용하고 EXIF/GPS를 복사하지 않는다. ICC가 있으면 sRGB로 변환한다.
- 기존의 작은 JPEG/PNG는 모델 입력 호환성을 위해 원본 바이트를 유지한다.
- 기본 업로드 한도는 파일당 100 MiB, 원본 해상도 210,000,000픽셀이다.
  큰 HEIF/RAW 디코딩에는 수백 MB 이상의 메모리가 필요할 수 있다.
  동시 진단 기본값 1을 유지하고 배포 기기 메모리에 맞게 한도를 조정한다.

## 배포

`backend/requirements.txt`를 다시 설치하거나 Docker 이미지를 다시 빌드한다.
기존 `.env`에 MAX_UPLOAD_MB/MAX_IMAGE_PIXELS가 있으면 새 기본값보다 우선하므로
필요한 한도로 갱신한다. 프록시에도 100 MiB 이상(두 사진 동기화는 200 MiB 이상)의
요청 본문을 허용해야 한다. 실제 설정은 `/api/v1/capabilities`에서 확인한다.

## 지원 범위와 검증

RAW는 하나의 코덱이 아니다. ProRAW/Expert RAW의 DNG도 압축 방식·기종에 따라
LibRaw 지원 여부가 다르며, 특히 JPEG XL 압축 DNG를 모두 지원한다고 보장하지 않는다.
읽을 수 없는 RAW는 오류를 반환한다. Live Photo/Motion Photo는 정지 사진 파일을
입력하며 동영상 파일은 받지 않는다.

HEIC·DNG를 표시할 수 없는 브라우저에서는 선택 완료 안내를 표시하고 진단을 허용한다.
진단 결과에는 서버에서 변환한 JPEG가 표시된다.

`/offline/`은 별도 브라우저 추론 기능으로 JPEG/PNG만 처리한다. 서버 디코더를
사용하지 않으므로 HEIC/DNG 등은 서버 진단 화면을 이용해야 한다.
`/mobile-prototype/`은 서버 업로드를 하지 않는 별도 시연 화면이다.

자동 테스트는 HEIF, AVIF, WebP, 실제 Bayer DNG 구조를 생성해 디코딩·저장·재촬영,
해상도 제한 및 JPEG/PNG 기존 동작을 검증한다. 실제 갤럭시·아이폰의 다양한
HDR/ProRAW/Expert RAW 파일과 200MP 사진의 기기별 실측은 별도로 필요하다.
