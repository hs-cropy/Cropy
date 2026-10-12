
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const origin =
  process.env.TEST_ORIGIN || "http://localhost:3000";

const headed = process.env.TEST_HEADED === "1";

const browser = await chromium.launch({
  channel: "chrome",
  headless: !headed,
  slowMo: headed ? 300 : 0,
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});

const page = await context.newPage();

const pageErrors = [];

page.on("pageerror", (error) => {
  pageErrors.push(error.message);
});

let diagnosisCalls = 0;
let refineCalls = 0;
let imageUrl = "";

// 테스트용 진단 데이터
function createResult(overrides = {}) {
  return {
    id: "recapture-test-001",

    disease_name: "고추 탄저병",
    crop_type: "고추",
    category: "disease",
    severity: "medium",

    confidence: 0.46,

    prediction_mode: "mock",

    top_predictions: [
      {
        name: "고추 탄저병",
        confidence: 0.46,
      },
      {
        name: "고추 세균점무늬병",
        confidence: 0.44,
      },
    ],

    description: "재촬영 UI 테스트용 진단 결과입니다.",
    causes: [],
    prevention: [],
    pesticides: [],
    management_actions: [],

    created_at: new Date().toISOString(),

    image_url: imageUrl,
    refined_image_url: null,

    save_status: "saved",

    decision_status: "ambiguous",
    decision_reasons: [
      "low_confidence",
      "confusion",
    ],

    recapture: {
      region: "잎 뒷면",
      instruction:
        "잎을 뒤집어 얼룩과 병징이 잘 보이도록 촬영해 주세요.",
      margin: 0.02,

      candidates: [
        {
          name: "고추 탄저병",
          cue: "갈색 병반과 주변 색 변화를 확인하세요.",
        },
        {
          name: "고추 세균점무늬병",
          cue: "작은 반점과 병반 경계를 확인하세요.",
        },
      ],
    },

    ...overrides,
  };
}

// 프론트의 실제 API 요청을 가로채
// 백엔드 대신 테스트 응답을 전달한다.
await page.route(
  /\/api\/v1\/diagnose(?:\/[^/?]+\/refine)?(?:\?.*)?$/,
  async (route) => {
    const request = route.request();

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Idempotency-Key",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers,
      });
      return;
    }

    const isRefine =
      /\/diagnose\/[^/?]+\/refine/.test(request.url());

    if (isRefine) {
      refineCalls += 1;

      // 첫 번째 재촬영 분석은 강제로 실패
      if (refineCalls === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            code: "TEST_REFINE_FAILED",
            detail:
              "재촬영 분석 서버가 응답하지 않았어요.",
            retryable: true,
          }),
        });

        return;
      }

      // 두 번째 요청(재시도)은 성공
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers,
        body: JSON.stringify(
          createResult({
            disease_name: "고추 세균점무늬병",
            confidence: 0.91,
            severity: "low",

            top_predictions: [
              {
                name: "고추 세균점무늬병",
                confidence: 0.91,
              },
              {
                name: "고추 탄저병",
                confidence: 0.09,
              },
            ],

            decision_status: "confirmed",
            decision_reasons: [],

            recapture: null,

            is_refined: true,
            refined_image_url: imageUrl,
          })
        ),
      });

      return;
    }

    // 최초 AI 진단: 낮은 신뢰도 + 후보 혼동
    diagnosisCalls += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers,
      body: JSON.stringify(createResult()),
    });
  }
);

try {
  await page.goto(`${origin}/#capture`);

  // 실제 이미지 검증에 통과할 PNG 생성
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");

    canvas.width = 512;
    canvas.height = 512;

    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#579447";
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = "#86633c";
    ctx.fillRect(160, 180, 130, 110);

    return canvas
      .toDataURL("image/png")
      .split(",")[1];
  });

  imageUrl = `data:image/png;base64,${pngBase64}`;

  const photo = {
    name: "test-leaf.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngBase64, "base64"),
  };

  // ==============================
  // TEST 1. 최초 진단
  // ==============================

  await page
    .locator('input[aria-label="갤러리 사진 선택"]')
    .setInputFiles(photo);

  await page
    .getByRole("button", {
      name: /AI 진단 시작/,
    })
    .click();

  // 진단 성공 시 재촬영 안내가 표시되어야 함
  await page
    .getByRole("heading", {
      name: "비슷한 증상이 보여요",
    })
    .waitFor();

  assert.equal(diagnosisCalls, 1);

  assert.equal(
    await page.getByText("잎 뒷면", {
      exact: true,
    }).count() > 0,
    true
  );

  console.log("PASS 1: 낮은 신뢰도 / 혼동 후보 안내");
  // 브라우저에서 재촬영 화면을 직접 확인하기 위해 일시정지
    if (headed) {
        await page.pause();
    }

  // ==============================
  // TEST 2. 촬영 가이드 펼치기
  // ==============================

  await page
    .getByRole("button", {
      name: "촬영 방법 보기",
    })
    .click();

  await page
    .getByRole("heading", {
      name: "추가 촬영 방법",
    })
    .waitFor();

  console.log("PASS 2: 추가 촬영 가이드 표시");

  // ==============================
  // TEST 3. 잘못된 파일
  // ==============================

  await page
    .locator(
      'input[aria-label="갤러리에서 추가 사진 선택"]'
    )
    .setInputFiles({
      name: "invalid.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });

  await page
    .getByRole("alert")
    .filter({
      hasText: "사진을 분석하지 못했어요",
    })
    .waitFor();

  // 잘못된 파일은 서버에 보내지 않아야 함
  assert.equal(refineCalls, 0);

  console.log("PASS 3: 유효하지 않은 파일 차단");

  // ==============================
  // TEST 4. 재촬영 분석 실패
  // ==============================

  await page
    .locator(
      'input[aria-label="갤러리에서 추가 사진 선택"]'
    )
    .setInputFiles(photo);

  await page
    .getByRole("alert")
    .filter({
      hasText:
        "재촬영 분석 서버가 응답하지 않았어요.",
    })
    .waitFor();

  assert.equal(refineCalls, 1);

  // 재촬영 실패 시 원래 진단 결과가 유지돼야 함
  assert.equal(
    await page.getByRole("heading", {
      name: "고추 탄저병",
    }).count(),
    1
  );

  console.log("PASS 4: 재촬영 실패 / 기존 결과 유지");

  // ==============================
  // TEST 5. 같은 사진으로 재시도
  // ==============================

  await page
    .getByRole("button", {
      name: "같은 사진으로 다시 시도",
    })
    .click();

  // 갱신 결과가 화면에 표시되는지 확인
  await page
    .getByRole("heading", {
      name: "고추 세균점무늬병",
    })
    .waitFor();

  assert.equal(refineCalls, 2);

  // 2차 사진 분석 결과 표시
  await page
    .getByText("사진 2장 분석", {
      exact: true,
    })
    .waitFor();

  // 성공 후 재촬영 안내는 사라져야 함
  assert.equal(
    await page.getByRole("heading", {
      name: "비슷한 증상이 보여요",
    }).count(),
    0
  );

  console.log("PASS 5: 재시도 성공 / 결과 갱신");

  // ==============================
  // TEST 6. 브라우저 오류 확인
  // ==============================

  assert.deepEqual(pageErrors, []);

  console.log("PASS 6: 브라우저 실행 오류 없음");

  console.log(
    "\n재촬영 프론트엔드 테스트 전체 통과!"
  );

  if (headed) {
    await page.waitForTimeout(4000);
  }
} finally {
  await browser.close();
}
