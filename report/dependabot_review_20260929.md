# Dependabot 전체 경고 검토 — 2026-09-29

## 조사 범위

GitHub API의 전체 페이지를 조회했다. 경고 46건 모두 open이며 Critical 2 / High 27 / Medium 13 / Low 4이다. 경고는 기본 브랜치 main 기준이다. 원격 main의 requirements.txt 및 package-lock.json과 대조했다. 로컬 작업 코드의 사용 경로도 검색했으나 원격 배포의 실행 버전·인터넷 노출·모든 간접 호출까지 검증한 것은 아니다. 공격 재현이나 패키지 변경은 수행하지 않았다.

Dependabot 번호는 이슈·PR 번호와 별개다. 예를 들어 보안 경고 #18과 PR #18은 다른 항목이다.

## 패키지별 정리

| 패키지 | 건수 | main 버전 | 해당 경고들을 위한 패치 기준 |
|---|---:|---|---|
| Next.js | 10 | 15.5.20 | 15.5.24 |
| sharp | 2 | 0.34.5 | 0.35.4 |
| Pillow | 17 | 11.0.0 | 12.3.0 |
| python-multipart | 7 | 0.0.20 | 0.0.31 |
| PostCSS | 4 | 8.5.16 / Next 내부 8.4.31 | 8.5.23 |
| nanoid | 2 | 3.3.15 | 3.3.18 |
| Browserslist | 2 | 4.28.4 | 4.28.7 |
| baseline-browser-mapping | 1 | 2.10.40 | 2.11.0 |
| torch | 1 | 2.12.1+cpu | 2.13.0 |

패치 기준은 조회 시점의 각 경고 first_patched_version 중 해당 버전 계열에서 필요한 상한이다. 무조건 설치 가능한 조합이나 이후 새 경고까지 안전함을 의미하지 않는다. sharp의 Next 의존 범위, PyTorch CPU wheel 및 torchvision 호환 조합은 업그레이드 전에 별도 확인해야 한다.

## 코드와 대조한 우선순위

1. **Next.js + sharp (우선)**: #44는 Windows 파일시스템에서 호스팅하는 서버의 원격 코드 실행 경고이다. 현재 개발 환경은 Windows이므로 우선 조치 대상으로 본다. 실제 서버 프로세스가 Windows에서 실행되는지는 별도 확인이 필요하다. #45는 AVIF 최적화의 libheif 경로이고 #46과 관련된다. 로컬 frontend/src에서는 next/image 사용을 찾지 못했지만 이것만으로 최적화 엔드포인트 비노출을 증명할 수 없다. Next와 sharp를 함께 점검한다.
2. **python-multipart (우선)**: #8은 FastAPI/Starlette의 multipart 헤더 파싱에서 CPU 고갈을 일으킬 수 있다. 업로드 라우트의 파일 크기 제한은 multipart 파싱 이후이므로 이것만으로 충분한 방어라고 볼 수 없다. #1의 임의 파일 쓰기는 라이브러리의 UPLOAD_KEEP_FILENAME=True 등 비기본 설정이 필요하며 로컬 앱에서 해당 설정은 발견하지 못했다. 앱의 UPLOAD_DIR 설정만 같다고 공격 조건이 충족되지는 않는다.
3. **Pillow**: 사용자 이미지 입력과 연결되어 있어 12.3.0 기준으로 갱신 검토가 필요하다. 현재 로컬 업로드 검증은 JPEG/PNG로 제한하지만 Image.open으로 형식을 식별한 뒤 거부한다. 모든 플러그인 파싱 위험이 제거됐다고 단정하지 않는다. ImageCms, RankFilter, PDF·폰트 등은 각기 다른 호출 조건이며 로컬 앱에서 직접 호출을 찾지 못한 항목도 있다. 17건 모두 업로드로 악용 가능하다고 주장하는 것은 부정확하다.
4. **PostCSS·nanoid·Browserslist·baseline-browser-mapping**: 주로 CSS 처리·빌드 의존 경로를 확인해야 한다. 외부 CSS/source map 또는 비신뢰 쿼리·통계 데이터가 입력되는지에 따라 영향이 달라진다. 사용자 이미지 업로드 취약점과 동일시하지 않는다. PostCSS는 루트 버전만 갱신하면 Next 내부 사본이 남을 수 있다.
5. **torch**: torch.jit.script 관련 Low 경고이다. 로컬 backend/app 및 ml 코드 검색에서 직접 호출을 찾지 못했다. 간접 호출 가능성은 남아 있다. CPU 및 torchvision 조합, 체크포인트 로딩과 추론 결과 검증을 포함하는 별도 변경으로 다룬다.

Next의 #31은 요청 값으로 외부 목적지 hostname을 만드는 rewrite가 조건이다. 로컬 next.config.js는 BACKEND_ORIGIN 또는 고정 127.0.0.1을 사용하므로 해당 조건은 현재 설정에서 발견하지 못했다. Server Actions 관련 경고는 로컬 소스에서 use server 선언을 찾지 못했지만 프레임워크 자체 노출 여부를 별도 검증해야 한다.

## 경고 46건 전체 목록

아래 제목은 GitHub 경고에 표시된 내용이다. 영향 범위와 패치 버전은 각 원문 링크에서 확인할 수 있다.

| 번호 | 심각도 | 패키지 | 내용 | 최초 패치 |
|---|---|---|---|---|
| [#1](https://github.com/hs-cropy/Cropy/security/dependabot/1) | high | python-multipart | Python-Multipart has Arbitrary File Write via Non-Default Configuration | 0.0.22 |
| [#2](https://github.com/hs-cropy/Cropy/security/dependabot/2) | high | pillow | Pillow affected by out-of-bounds write when loading PSD images | 12.1.1 |
| [#3](https://github.com/hs-cropy/Cropy/security/dependabot/3) | high | pillow | FITS GZIP decompression bomb in Pillow | 12.2.0 |
| [#4](https://github.com/hs-cropy/Cropy/security/dependabot/4) | medium | python-multipart | python-multipart affected by Denial of Service via large multipart preamble or epilogue data | 0.0.26 |
| [#5](https://github.com/hs-cropy/Cropy/security/dependabot/5) | medium | pillow | Pillow has an integer overflow when processing fonts | 12.2.0 |
| [#6](https://github.com/hs-cropy/Cropy/security/dependabot/6) | medium | pillow | Pillow has a PDF Parsing Trailer Infinite Loop (DoS) | 12.2.0 |
| [#7](https://github.com/hs-cropy/Cropy/security/dependabot/7) | high | pillow | Pillow has an OOB Write with Invalid PSD Tile Extents (Integer Overflow) | 12.2.0 |
| [#8](https://github.com/hs-cropy/Cropy/security/dependabot/8) | high | python-multipart | python-multipart has Denial of Service via unbounded multipart part headers | 0.0.27 |
| [#9](https://github.com/hs-cropy/Cropy/security/dependabot/9) | low | python-multipart | python-multipart: Content-Disposition parameter smuggling via RFC 2231/5987 extended parameters | 0.0.30 |
| [#10](https://github.com/hs-cropy/Cropy/security/dependabot/10) | low | python-multipart | python-multipart: Semicolon treated as querystring field separator enables parameter smuggling | 0.0.30 |
| [#11](https://github.com/hs-cropy/Cropy/security/dependabot/11) | low | python-multipart | python-multipart: Negative Content-Length in parse_form buffers the entire body in memory | 0.0.31 |
| [#12](https://github.com/hs-cropy/Cropy/security/dependabot/12) | high | python-multipart | python-multipart: Quadratic-time querystring parsing with semicolon separators causes CPU denial of service | 0.0.30 |
| [#13](https://github.com/hs-cropy/Cropy/security/dependabot/13) | low | torch | PyTorch is vulnerable to memory corruption through its torch.jit.script function | 2.13.0 |
| [#14](https://github.com/hs-cropy/Cropy/security/dependabot/14) | high | pillow | Pillow: Out-of-bounds read via attacker-controlled row stride on Pillow's mmap path (McIdas AREA files) | 12.3.0 |
| [#15](https://github.com/hs-cropy/Cropy/security/dependabot/15) | high | pillow | Pillow `PcfFontFile._load_bitmaps()`: `Image.frombytes()` called without `_decompression_bomb_check()` — bomb protection bypass via PCF font loading | 12.3.0 |
| [#16](https://github.com/hs-cropy/Cropy/security/dependabot/16) | high | pillow | Pillow: `FontFile.compile()`: `Image.new()` called without `_decompression_bomb_check()` | 12.3.0 |
| [#17](https://github.com/hs-cropy/Cropy/security/dependabot/17) | high | pillow | Pillow `BdfFontFile`: `Image.new()` called without `_decompression_bomb_check()` — bomb protection bypass via font loading | 12.3.0 |
| [#18](https://github.com/hs-cropy/Cropy/security/dependabot/18) | high | pillow | Pillow `GdImageFile._open()`: image dimensions accepted without `_decompression_bomb_check()` | 12.3.0 |
| [#19](https://github.com/hs-cropy/Cropy/security/dependabot/19) | medium | Pillow | Pillow: WindowsViewer.get_command() OS command injection via unescaped shell path | 12.3.0 |
| [#20](https://github.com/hs-cropy/Cropy/security/dependabot/20) | high | Pillow | Pillow: Heap out-of-bounds write in `ImageFilter.RankFilter` via integer overflow in `ImagingExpand` | 12.3.0 |
| [#21](https://github.com/hs-cropy/Cropy/security/dependabot/21) | medium | Pillow | Pillow TGA RLE encoder can serialize up to ~57 KB of adjacent heap data into generated images | 12.3.0 |
| [#22](https://github.com/hs-cropy/Cropy/security/dependabot/22) | high | Pillow | Pillow: Heap out-of-bounds write `Image.paste()` / `Image.crop()` via signed coordinate overflow | 12.3.0 |
| [#23](https://github.com/hs-cropy/Cropy/security/dependabot/23) | high | Pillow | Pillow: Decompression Bomb DoS via PdfParser.PdfStream.decode() | 12.3.0 |
| [#24](https://github.com/hs-cropy/Cropy/security/dependabot/24) | high | pillow | Pillow JPEG2000 tiled decode retains a growing scratch buffer and can be used for denial of service | 12.3.0 |
| [#25](https://github.com/hs-cropy/Cropy/security/dependabot/25) | high | pillow | Pillow: Controlled heap out-of-bounds write in Pillow `ImageCmsTransform.apply()` via output mode mismatch | 12.3.0 |
| [#26](https://github.com/hs-cropy/Cropy/security/dependabot/26) | medium | postcss | PostCSS has XSS via Unescaped </style> in its CSS Stringify Output | 8.5.10 |
| [#27](https://github.com/hs-cropy/Cropy/security/dependabot/27) | high | sharp | sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 | 0.35.0 |
| [#28](https://github.com/hs-cropy/Cropy/security/dependabot/28) | high | next | Next.js: Denial of Service in App Router using Server Actions | 15.5.21 |
| [#29](https://github.com/hs-cropy/Cropy/security/dependabot/29) | medium | next | Next.js: Unauthenticated disclosure of internal Server Function endpoints | 15.5.21 |
| [#30](https://github.com/hs-cropy/Cropy/security/dependabot/30) | medium | next | Next.js: Denial of Service in the Image Optimization API using SVGs | 15.5.21 |
| [#31](https://github.com/hs-cropy/Cropy/security/dependabot/31) | high | next | Next.js: Server-Side Request Forgery in rewrites via attacker-controlled destination hostname | 15.5.21 |
| [#32](https://github.com/hs-cropy/Cropy/security/dependabot/32) | medium | next | Next.js: Unbounded Server Action payload in Edge runtime | 15.5.21 |
| [#33](https://github.com/hs-cropy/Cropy/security/dependabot/33) | medium | next | Next.js: Cache confusion of response bodies for requests with bodies containing invalid UTF-8 byte sequences | 15.5.21 |
| [#34](https://github.com/hs-cropy/Cropy/security/dependabot/34) | medium | next | Next.js: Cache confusion of response bodies for requests with bodies | 15.5.21 |
| [#35](https://github.com/hs-cropy/Cropy/security/dependabot/35) | high | next | Next.js: Server-Side Request Forgery in Server Actions on custom servers | 15.5.21 |
| [#36](https://github.com/hs-cropy/Cropy/security/dependabot/36) | high | postcss | PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments | 8.5.12 |
| [#37](https://github.com/hs-cropy/Cropy/security/dependabot/37) | high | postcss | PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure | 8.5.18 |
| [#38](https://github.com/hs-cropy/Cropy/security/dependabot/38) | medium | postcss | PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset | 8.5.23 |
| [#39](https://github.com/hs-cropy/Cropy/security/dependabot/39) | high | nanoid | nanoid: non-secure generators can loop indefinitely with negative size | 3.3.16 |
| [#40](https://github.com/hs-cropy/Cropy/security/dependabot/40) | high | nanoid | nanoid: custom generators can loop indefinitely when size is zero | 3.3.18 |
| [#41](https://github.com/hs-cropy/Cropy/security/dependabot/41) | high | browserslist | Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) | 4.28.7 |
| [#42](https://github.com/hs-cropy/Cropy/security/dependabot/42) | high | browserslist | Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM | 4.28.7 |
| [#43](https://github.com/hs-cropy/Cropy/security/dependabot/43) | medium | baseline-browser-mapping | baseline-browser-mapping process termination on invalid input causes denial of service | 2.11.0 |
| [#44](https://github.com/hs-cropy/Cropy/security/dependabot/44) | critical | next | Next.js: Unauthenticated Remote Code Execution on windows-hosted servers | 15.5.24 |
| [#45](https://github.com/hs-cropy/Cropy/security/dependabot/45) | critical | next | Next.js: Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used | 15.5.24 |
| [#46](https://github.com/hs-cropy/Cropy/security/dependabot/46) | high | sharp | sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545 | 0.35.4 |

## 처리 단위와 완료 조건

- 프론트 보안 업데이트: Next/sharp와 하위 의존성 lockfile을 함께 검토하고 lint/build, 페이지 접근, API proxy, 이미지 표시를 확인한다.
- 백엔드 업로드 의존성 업데이트: Pillow/python-multipart를 갱신하고 정상 JPEG/PNG, 손상 파일, 크기·픽셀 상한, 재촬영 및 기존 이력 테스트를 확인한다.
- ML 런타임 업데이트: torch/torchvision CPU 호환 조합을 확인하고 실제 체크포인트 로딩, 전처리, 추론 회귀를 검증한다.
- 위 변경을 main까지 반영하고 Dependabot 재스캔 결과를 확인해야 경고 해소를 확인할 수 있다. develop 또는 기능 브랜치 수정만으로 main 경고가 닫혔다고 판단하지 않는다.
- 이번 작업은 조사만 수행했다. 패키지 설치·업그레이드, 경고 dismiss, 이슈/PR 생성, 원격 댓글은 하지 않았다.

## 버전 대조 근거

```text
node_modules/baseline-browser-mapping = 2.10.40
node_modules/browserslist = 4.28.4
node_modules/nanoid = 3.3.15
node_modules/next = 15.5.20
node_modules/next/node_modules/postcss = 8.4.31
node_modules/postcss = 8.5.16
node_modules/sharp = 0.34.5
```

[GitHub Dependabot 전체 목록](https://github.com/hs-cropy/Cropy/security/dependabot)
