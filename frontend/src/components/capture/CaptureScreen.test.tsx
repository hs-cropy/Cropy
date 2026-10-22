import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeSpeech } from "@/features/voice/testing/fakeSpeech";
import { fetchHistory } from "@/lib/api";
import type { DiagnosisSummary } from "@/types/diagnosis";
import { CaptureScreen } from "./CaptureScreen";
import { recentLabel } from "./RecentDiagnosisCard";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchHistory: vi.fn(),
}));

function history(items: DiagnosisSummary[]) {
  return {
    items,
    total: items.length,
    page: 1,
    size: 1,
    unfiltered_total: items.length,
    crop_total: 0,
  };
}

function fakeStream() {
  const track = { stop: vi.fn(), getSettings: () => ({ facingMode: "environment" }) };
  return {
    track,
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
  };
}

let getUserMedia: ReturnType<typeof vi.fn>;

function renderScreen(props: Partial<Parameters<typeof CaptureScreen>[0]> = {}) {
  const handlers = {
    onCapture: vi.fn(() => true),
    onCaptureError: vi.fn(),
    onPickGallery: vi.fn(),
    onDeviceCamera: vi.fn(),
    onSubmit: vi.fn(),
    onClearPhoto: vi.fn(),
  };
  const utils = render(
    <CaptureScreen visible preview={null} loading={false} {...handlers} {...props} />,
  );
  return { ...utils, handlers };
}

// 고정 행동 영역의 버튼
function action(name: string) {
  return within(screen.getByRole("group", { name: "화면 행동" })).getByRole("button", { name });
}

// 카메라 스위치를 누른다. 처음(사진 업로드, M-01-0)·새 진단 뒤에는 스위치가 없어 "카메라로 촬영"으로 켠다
async function toggleCamera() {
  const toggle = screen.queryByRole("switch", { name: "카메라" });
  await userEvent.click(toggle ?? action("카메라로 촬영"));
}

function refused(name = "NotAllowedError") {
  return Object.assign(new Error(name), { name });
}

function title() {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

beforeEach(() => {
  // 앞 테스트가 촬영 가이드(#guide)에서 끝나도 처음 화면에서 시작한다
  window.history.replaceState(null, "", "#capture");
  installFakeSpeech();
  vi.mocked(fetchHistory).mockResolvedValue(history([]));
  getUserMedia = vi.fn();
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  // jsdom 은 영상을 재생하지 못한다
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

describe("CaptureScreen — 새 진단 · 사진 선택 (M-01-0)", () => {
  it("처음에는 카메라를 켜지 않고 사진 업로드와 사진 선택하기·카메라로 촬영 버튼을 보인다", async () => {
    const { handlers } = renderScreen();
    await act(async () => {});

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(title()).toBe("사진으로 작물 진단");
    expect(screen.queryByRole("switch", { name: "카메라" })).toBeNull();
    expect(screen.getByRole("heading", { name: "사진 업로드" })).toBeTruthy();
    expect(screen.getByText(/진단할 사진을 선택해주세요/)).toBeTruthy();

    // 업로드 영역과 행동 영역의 사진 선택하기 모두 사진을 고르게 한다
    await userEvent.click(action("사진 선택하기"));
    await userEvent.click(
      within(screen.getByRole("region", { name: "사진 업로드" })).getByRole("button"),
    );
    expect(handlers.onPickGallery).toHaveBeenCalledTimes(2);
    expect(action("카메라로 촬영")).toBeTruthy();
  });
});

describe("CaptureScreen — 카메라 꺼짐 (M-01-1)", () => {
  // 카메라를 켰다가 끄면 카메라 꺼짐 화면이다
  async function turnOff() {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const utils = renderScreen();
    await toggleCamera();
    await toggleCamera();
    return utils;
  }

  it("사진 찍기는 이유를 알려 주며 막아 둔다", async () => {
    await turnOff();

    expect(title()).toBe("작물 촬영");
    expect(screen.getByRole("switch", { name: "카메라" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    const shutter = action("사진 찍기") as HTMLButtonElement;
    expect(shutter.disabled).toBe(true);
    expect(document.getElementById(shutter.getAttribute("aria-describedby")!)?.textContent).toMatch(
      /위 토글을 켜면/,
    );
  });

  it("갤러리에서 선택은 카메라가 꺼져 있어도 누를 수 있다", async () => {
    const { handlers } = await turnOff();

    await userEvent.click(action("갤러리에서 선택"));

    expect(handlers.onPickGallery).toHaveBeenCalled();
  });
});

describe("CaptureScreen — 카메라 켜기와 권한 (M-01 · M-01-2 · M-01-3)", () => {
  it("스위치를 켜면 안내 없이 바로 권한을 묻고 실시간 프리뷰를 보여준다 (M-01)", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    renderScreen();

    await toggleCamera();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "카메라 사용을 허용해주세요" })).toBeNull();
    expect(screen.getByRole("heading", { name: "실시간 프리뷰" })).toBeTruthy();
    expect((action("사진 찍기") as HTMLButtonElement).disabled).toBe(false);
  });

  it("권한이 거부되면 카메라 권한 안내를 보여준다 (M-01-2)", async () => {
    getUserMedia.mockRejectedValue(refused());
    renderScreen();

    await toggleCamera();

    expect(title()).toBe("카메라 권한");
    expect(screen.getByRole("heading", { name: "카메라 사용을 허용해주세요" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(action("허용")).toBeTruthy();
    expect(action("허용 안 함")).toBeTruthy();
  });

  it("권한 안내에서 허용 안 함을 누르면 카메라를 사용할 수 없다는 화면으로 간다 (M-01-3)", async () => {
    getUserMedia.mockRejectedValue(refused());
    const { handlers } = renderScreen();
    await toggleCamera();

    await userEvent.click(action("허용 안 함"));

    expect(screen.getByRole("alert").textContent).toMatch(/카메라를 사용할 수 없어요/);
    // 다시 묻지 않는다
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await userEvent.click(action("갤러리에서 선택"));
    expect(handlers.onPickGallery).toHaveBeenCalled();
  });

  it("권한 안내에서 허용을 누르면 다시 묻고, 허용되면 프리뷰를 보여준다", async () => {
    getUserMedia.mockRejectedValueOnce(refused()).mockResolvedValueOnce(fakeStream().stream);
    renderScreen();
    await toggleCamera();

    await userEvent.click(action("허용"));

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "실시간 프리뷰" })).toBeTruthy();
  });

  it("허용을 눌렀는데도 또 거부되면(브라우저가 막아 둠) 설정 안내가 있는 사용 불가로 간다", async () => {
    getUserMedia.mockRejectedValue(refused());
    renderScreen();
    await toggleCamera();

    await userEvent.click(action("허용"));

    expect(screen.getByRole("alert").textContent).toMatch(/설정에서 카메라 권한을 허용한 뒤/);
    await userEvent.click(action("권한 허용 후 다시 시작"));
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it("다시 묻는 동안(응답 전)에는 사용 불가 경고를 잠깐도 띄우지 않는다", async () => {
    getUserMedia.mockRejectedValueOnce(refused()).mockReturnValueOnce(new Promise(() => {}));
    renderScreen();
    await toggleCamera();

    await userEvent.click(action("허용"));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("허용 안 함 뒤 사용 불가에서 다시 시작해 허용되면 프리뷰로 간다", async () => {
    getUserMedia.mockRejectedValueOnce(refused()).mockResolvedValueOnce(fakeStream().stream);
    renderScreen();
    await toggleCamera();
    await userEvent.click(action("허용 안 함"));

    await userEvent.click(action("권한 허용 후 다시 시작"));

    expect(screen.getByRole("heading", { name: "실시간 프리뷰" })).toBeTruthy();
  });

  it("카메라를 다시 켤 때는 처음처럼 거부되면 권한 안내부터 보여준다", async () => {
    getUserMedia.mockResolvedValueOnce(fakeStream().stream).mockRejectedValueOnce(refused());
    renderScreen();
    const toggle = toggleCamera;

    await toggle(); // 켬 (허용)
    await toggle(); // 끔
    await toggle(); // 다시 켬 (이번엔 거부)

    expect(screen.getByRole("heading", { name: "카메라 사용을 허용해주세요" })).toBeTruthy();
  });

  it("스위치를 끄면 카메라 스트림을 해제한다", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    renderScreen();

    await toggleCamera();
    await toggleCamera();

    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "카메라 꺼짐" })).toBeTruthy();
  });

  it("탭을 떠나면 카메라를 끈다", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { rerender } = renderScreen();
    await toggleCamera();

    rerender(
      <CaptureScreen
        visible={false}
        preview={null}
        loading={false}
        onCapture={vi.fn(() => true)}
        onCaptureError={vi.fn()}
        onPickGallery={vi.fn()}
        onDeviceCamera={vi.fn()}
        onSubmit={vi.fn()}
        onClearPhoto={vi.fn()}
      />,
    );

    expect(track.stop).toHaveBeenCalled();
  });

  it("카메라 API 가 없는 환경은 권한 안내 없이 사용 불가로 가고 기기 카메라로 찍게 한다", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { handlers } = renderScreen();

    await toggleCamera();
    expect(screen.queryByRole("heading", { name: "카메라 사용을 허용해주세요" })).toBeNull();
    await userEvent.click(action("기기 카메라로 촬영"));

    expect(handlers.onDeviceCamera).toHaveBeenCalled();
  });
});

describe("CaptureScreen — 새 진단 (resetKey)", () => {
  function screenWith(resetKey: number) {
    return (
      <CaptureScreen
        visible
        preview={null}
        loading={false}
        onCapture={vi.fn()}
        onCaptureError={vi.fn()}
        onPickGallery={vi.fn()}
        onDeviceCamera={vi.fn()}
        onSubmit={vi.fn()}
        onClearPhoto={vi.fn()}
        resetKey={resetKey}
      />
    );
  }

  it("권한 안내 화면에서 새 진단을 하면 같은 렌더에서 사진 업로드로 돌아가고, 다시 켜면 처음처럼 묻는다", async () => {
    getUserMedia.mockRejectedValue(refused());
    const { rerender } = render(screenWith(0));
    await toggleCamera();
    expect(title()).toBe("카메라 권한");

    rerender(screenWith(1));

    expect(title()).toBe("사진으로 작물 진단");

    // 권한 단계도 처음으로: 거부되면 다시 권한 안내부터
    await toggleCamera();
    expect(screen.getByRole("heading", { name: "카메라 사용을 허용해주세요" })).toBeTruthy();
  });

  it("켜 둔 카메라는 새 진단 때 끈다", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { rerender } = render(screenWith(0));
    await toggleCamera();

    rerender(screenWith(1));
    await act(async () => {});

    expect(track.stop).toHaveBeenCalled();
    expect(title()).toBe("사진으로 작물 진단");
  });

  it("새 진단 때 최근 진단을 다시 받는다 (방금 저장한 진단이 보이게)", async () => {
    const { rerender } = render(screenWith(0));
    await act(async () => {});
    expect(fetchHistory).toHaveBeenCalledTimes(1);

    rerender(screenWith(1));
    await act(async () => {});

    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });
});

describe("CaptureScreen — 고른 사진 확인 (M-01-4 · M-01-5)", () => {
  it("사진이 있으면 미리보기·안내와 진단 버튼을 보여주고, 작물 선택은 없다", async () => {
    const { handlers } = renderScreen({ preview: "blob:photo", photoSource: "gallery" });

    expect(title()).toBe("사진 확인");
    expect(screen.getByAltText("촬영한 작물 미리보기").getAttribute("src")).toBe("blob:photo");
    expect(screen.getByText("어둡거나 흐리면 사진을 바꿔주세요 !")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "자동 감지" })).toBeNull();

    await userEvent.click(action("이 사진으로 진단하기"));
    expect(handlers.onSubmit).toHaveBeenCalled();
  });

  it("갤러리에서 고른 사진은 다른 사진 선택하기로 다시 고른다 (사진은 새로 고를 때까지 둔다)", async () => {
    const { handlers } = renderScreen({ preview: "blob:photo", photoSource: "gallery" });

    await userEvent.click(action("다른 사진 선택하기"));

    expect(handlers.onPickGallery).toHaveBeenCalled();
    expect(handlers.onClearPhoto).not.toHaveBeenCalled();
  });

  it("카메라로 찍은 사진은 다른 사진 촬영하기로 사진을 지우고 카메라를 켠다", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const { handlers } = renderScreen({ preview: "blob:photo", photoSource: "camera" });

    await userEvent.click(action("다른 사진 촬영하기"));

    expect(handlers.onClearPhoto).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("브라우저 카메라를 못 쓰면(기기 카메라로 찍은 경우) 기기 카메라를 다시 연다", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { handlers } = renderScreen({ preview: "blob:photo", photoSource: "camera" });

    await userEvent.click(action("다른 사진 촬영하기"));

    expect(handlers.onDeviceCamera).toHaveBeenCalled();
    expect(handlers.onClearPhoto).not.toHaveBeenCalled();
  });

  it("셔터로 찍은 사진은 카메라에서 온 것으로 넘긴다", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(4);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(3);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) =>
      done(new Blob(["x"], { type: "image/jpeg" })),
    );
    const { handlers } = renderScreen();
    await toggleCamera();

    await userEvent.click(action("사진 찍기"));

    expect(handlers.onCapture).toHaveBeenCalledWith(expect.any(File), "camera");
  });

  it("진단 중에는 다시 시작하거나 다른 사진으로 바꿀 수 없다", () => {
    renderScreen({ preview: "blob:photo", photoSource: "camera", loading: true });

    expect((action("진단 중…") as HTMLButtonElement).disabled).toBe(true);
    expect((action("다른 사진 촬영하기") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("CaptureScreen — 데스크탑 사진 확인 (D-01-5 · D-01-6)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("데스크탑 제목·파일 이름·오른쪽 확인 안내를 보여준다", () => {
    renderScreen({ preview: "blob:photo", photoSource: "gallery", photoName: "crop_photo.jpg" });

    expect(title()).toBe("이 사진으로 진단할까요?");
    expect(screen.getByText("crop_photo.jpg")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "진단할 사진을 확인하세요" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "촬영 전 확인해주세요" })).toBeNull();
    expect(action("다른 사진 선택하기")).toBeTruthy();
  });
});

describe("CaptureScreen — 추가 촬영 (후보 혼동의 재촬영)", () => {
  const refine = { region: "잎 뒷면", instruction: "같은 잎을 뒤집어 뒷면이 보이도록 찍어주세요." };

  it("찍을 부위를 제목에, 안내를 설명에 두고 최근 진단·기기 진단 링크는 두지 않는다", async () => {
    vi.mocked(fetchHistory).mockResolvedValue(
      history([
        {
          id: "r1",
          disease_name: "고추 탄저병",
          crop_type: "고추",
          confidence: 0.9,
          created_at: "2026-10-13T00:00:00Z",
        },
      ]),
    );
    renderScreen({ refine });
    await act(async () => {});

    expect(title()).toBe("잎 뒷면 추가 촬영");
    expect(screen.getByText(refine.instruction)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /최근 진단/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /인터넷 없이/ })).toBeNull();
  });

  it("사진 확인은 다시 분석 문구다 (모바일·데스크탑)", async () => {
    const { handlers, unmount } = renderScreen({
      refine,
      preview: "blob:photo",
      photoSource: "gallery",
    });

    expect(title()).toBe("추가 사진 확인");
    await userEvent.click(action("이 사진으로 다시 분석"));
    expect(handlers.onSubmit).toHaveBeenCalled();
    unmount();

    stubDesktop();
    renderScreen({ refine, preview: "blob:photo", photoSource: "gallery", loading: true });
    expect(title()).toBe("이 사진으로 다시 분석할까요?");
    expect(action("재분석 중…")).toBeTruthy();
  });
});

describe("CaptureScreen — 최근 진단", () => {
  const record: DiagnosisSummary = {
    id: "r1",
    disease_name: "고추 탄저병",
    crop_type: "고추",
    confidence: 0.9,
    created_at: "2026-10-13T00:00:00Z",
  };

  it("가장 최근 기록을 보여주고 상세로 연결한다", async () => {
    vi.mocked(fetchHistory).mockResolvedValue(history([record]));
    renderScreen();

    const link = await screen.findByRole("link", { name: "최근 진단 고추 · 탄저병 보기" });

    expect(link.getAttribute("href")).toBe("/history/r1");
  });

  it("기록이 없거나 불러오지 못하면 카드를 숨긴다", async () => {
    vi.mocked(fetchHistory).mockRejectedValue(new Error("offline"));
    renderScreen();
    await act(async () => {});

    expect(screen.queryByRole("link", { name: /최근 진단/ })).toBeNull();
  });

  it.each([
    [{ crop_type: "고추", disease_name: "고추 탄저병" }, "고추 · 탄저병"],
    [{ crop_type: "무", disease_name: "검은무늬병" }, "무 · 검은무늬병"],
    [{ crop_type: undefined, disease_name: "고추 탄저병" }, "고추 탄저병"],
  ])("%o 는 %s 로 적는다", (fields, expected) => {
    expect(recentLabel({ ...record, ...fields })).toBe(expected);
  });
});

describe("CaptureScreen — 리뷰에서 짚은 경로", () => {
  it("카메라가 없으면 권한 안내 없이 원인에 맞는 사용 불가 문구를 쓴다", async () => {
    getUserMedia.mockRejectedValue(refused("NotFoundError"));
    renderScreen();

    await toggleCamera();

    expect(screen.getByRole("alert").textContent).toMatch(/카메라를 찾지 못했어요/);
    expect(screen.queryByRole("heading", { name: "카메라 사용을 허용해주세요" })).toBeNull();
    expect(action("다시 시도")).toBeTruthy();
  });

  it("영상 재생만 막히면 카메라 카드에 남아 다시 시도에서 바로 재생한다", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValue(new Error("blocked"));
    renderScreen();

    await toggleCamera();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/카메라 화면을 띄우지 못했어요/);
    // 스트림은 다시 시도를 위해 남겨 둔다
    expect(track.stop).not.toHaveBeenCalled();

    play.mockResolvedValue(undefined);
    await userEvent.click(action("다시 시도"));

    // getUserMedia 를 다시 기다리지 않고 열린 스트림을 재생한다
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect((action("사진 찍기") as HTMLButtonElement).disabled).toBe(false);
  });

  it("카메라가 열리는 중에 스위치를 끄면 늦게 열린 스트림을 바로 해제한다", async () => {
    const { stream, track } = fakeStream();
    let open!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise((resolve) => (open = resolve)));
    renderScreen();

    await toggleCamera();
    await toggleCamera();
    await act(async () => open(stream));

    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "카메라 꺼짐" })).toBeTruthy();
  });

  it("사진을 만들지 못하면 알리고 카메라는 켜 둔다", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const { handlers } = renderScreen();
    await toggleCamera();

    // jsdom 의 video 는 크기가 0 이라 프레임을 만들 수 없다
    await userEvent.click(action("사진 찍기"));

    expect(handlers.onCapture).not.toHaveBeenCalled();
    expect(handlers.onCaptureError).toHaveBeenCalledWith(
      "사진을 만들지 못했어요. 다시 찍어 주세요",
    );
    expect(screen.getByRole("heading", { name: "실시간 프리뷰" })).toBeTruthy();
  });

  it("누른 스위치가 화면 전환으로 사라지면 초점을 새 화면의 제목으로 옮긴다", async () => {
    getUserMedia.mockRejectedValue(refused());
    renderScreen();

    // 거부되어 넘어간 권한 안내 화면에는 카메라 카드(스위치)가 없다
    await toggleCamera();

    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
    expect(document.activeElement?.textContent).toBe("카메라 권한");
  });

  it("같은 자리의 버튼으로 바뀌면 초점을 그대로 둔다 (허용 안 함 → 갤러리에서 선택)", async () => {
    getUserMedia.mockRejectedValue(refused());
    renderScreen();

    await toggleCamera();
    await userEvent.click(action("허용 안 함"));

    expect(document.activeElement).toBe(action("갤러리에서 선택"));
  });

  it("허용 버튼은 다음 화면의 첫 버튼으로 그대로 남아 초점을 잃지 않는다", async () => {
    getUserMedia.mockRejectedValueOnce(refused()).mockResolvedValueOnce(fakeStream().stream);
    renderScreen();

    await toggleCamera();
    await userEvent.click(action("허용"));

    expect(document.activeElement).toBe(action("사진 찍기"));
  });
});

// 업로드 영역: 이름은 하는 일(사진 선택하기), 형식은 설명이다
function dropzone() {
  return screen.getByRole("button", {
    name: "사진 선택하기",
    description: "JPG, PNG · 최대 100 MB",
  });
}

describe("CaptureScreen — 데스크탑 (D-01 · 촬영 · 카메라 권한)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("사진 업로드로 시작하고 사진 선택·카메라로 촬영 버튼과 촬영 안내를 보여준다 (D-01)", async () => {
    const { handlers } = renderScreen();
    await act(async () => {});

    expect(title()).toBe("사진으로 작물 상태를 확인하세요");
    expect(screen.getByRole("heading", { name: "사진 업로드" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "촬영 전 확인해주세요" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "카메라" })).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();

    await userEvent.click(action("사진 선택하기"));
    expect(handlers.onPickGallery).toHaveBeenCalledTimes(1);

    // 업로드 영역을 눌러도 파일 선택 창을 연다
    await userEvent.click(dropzone());
    expect(handlers.onPickGallery).toHaveBeenCalledTimes(2);
  });

  it("사진을 끌어다 놓으면 그 파일을 넘긴다", () => {
    const { handlers } = renderScreen();
    const file = new File(["x"], "leaf.jpg", { type: "image/jpeg" });

    const zone = dropzone();
    fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    expect(handlers.onCapture).toHaveBeenCalledWith(file, "gallery");
  });

  it("카메라로 촬영 → 거부되면 권한 안내(D-01-3) → 허용 안 함이면 사용 불가(D-01-4)", async () => {
    getUserMedia.mockRejectedValue(refused());
    renderScreen();

    await userEvent.click(action("카메라로 촬영"));
    expect(title()).toBe("카메라 접근을 허용해주세요");
    expect(screen.getByRole("heading", { name: "카메라는 촬영할 때만 사용해요" })).toBeTruthy();

    await userEvent.click(action("허용 안 함"));
    expect(title()).toBe("카메라를 사용할 수 없어요");
    expect(screen.getByRole("alert").textContent).toMatch(/주소창의 사이트 설정에서/);
    expect(action("권한 허용 후 다시 시작")).toBeTruthy();
  });

  it("허용되면 카메라 프리뷰(D-01-1)가 되고, 끄면 꺼짐(D-01-2)이 된다", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    renderScreen();

    await userEvent.click(action("카메라로 촬영"));

    expect(title()).toBe("카메라로 촬영하기");
    expect(screen.getByRole("heading", { name: "카메라 프리뷰" })).toBeTruthy();
    expect((action("사진 찍기") as HTMLButtonElement).disabled).toBe(false);

    await toggleCamera();

    expect(screen.getByRole("heading", { name: "카메라가 꺼져 있어요" })).toBeTruthy();
    expect((action("사진 찍기") as HTMLButtonElement).disabled).toBe(true);
    expect(action("갤러리에서 선택")).toBeTruthy();
  });

  it("권한 안내에서 허용해도 또 거부되면 사용 불가(D-01-4)의 데스크탑 안내를 보여준다", async () => {
    getUserMedia.mockRejectedValue(refused());
    renderScreen();

    await userEvent.click(action("카메라로 촬영"));
    await userEvent.click(action("허용"));

    expect(title()).toBe("카메라를 사용할 수 없어요");
    expect(screen.getByRole("alert").textContent).toMatch(/주소창의 사이트 설정에서/);
    expect(action("권한 허용 후 다시 시작")).toBeTruthy();
  });

  it("웹캠이 없는 PC 는 권한이 아니라 카메라를 찾지 못했다고 안내한다", async () => {
    getUserMedia.mockRejectedValue(refused("NotFoundError"));
    renderScreen();

    await userEvent.click(action("카메라로 촬영"));

    expect(screen.getByRole("heading", { name: "카메라를 찾지 못했어요" })).toBeTruthy();
    expect(screen.queryByText(/권한을 확인해주세요/)).toBeNull();
    expect(action("다시 시도")).toBeTruthy();
  });

  it("카메라를 못 쓰는 브라우저는 기기 카메라 대신 사진 선택 하나만 둔다", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { handlers } = renderScreen();

    await userEvent.click(action("카메라로 촬영"));

    expect(
      screen.getByRole("heading", { name: "이 브라우저에서는 카메라를 쓸 수 없어요" }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "화면 행동" })).getAllByRole("button"),
    ).toHaveLength(1);
    await userEvent.click(action("사진 선택하기"));
    expect(handlers.onPickGallery).toHaveBeenCalled();
    expect(handlers.onDeviceCamera).not.toHaveBeenCalled();
  });

  it("카메라로 촬영을 빠르게 두 번 눌러도 바뀐 자리의 갤러리 선택이 눌리지 않는다", async () => {
    // 권한을 묻는 동안(응답 전) 화면은 카메라 화면으로 바뀌어 있다
    getUserMedia.mockReturnValue(new Promise(() => {}));
    const { handlers } = renderScreen();

    await userEvent.dblClick(action("카메라로 촬영"));

    expect(title()).toBe("카메라로 촬영하기");
    expect(handlers.onPickGallery).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("끌어다 놓는 동안 안쪽 문구 위를 지나도 강조가 꺼지지 않는다", () => {
    renderScreen();
    const zone = dropzone();
    const inner = within(zone).getByText("사진을 여기에 놓아주세요");

    // jsdom 의 DragEvent 는 relatedTarget 을 싣지 못해 같은 모양의 MouseEvent 로 보낸다
    const leave = (relatedTarget: Element) =>
      act(() => {
        zone.dispatchEvent(new MouseEvent("dragleave", { bubbles: true, relatedTarget }));
      });

    fireEvent.dragOver(zone);
    leave(inner);
    expect(zone.className).toContain("bg-cropy-action-subtle");

    leave(document.body);
    expect(zone.className).not.toContain("bg-cropy-action-subtle");
  });

  it("최근 진단은 날짜·등급·기록 보기와 함께 한 줄로 보여준다", async () => {
    vi.mocked(fetchHistory).mockResolvedValue(
      history([
        {
          id: "r1",
          disease_name: "고추 탄저병",
          crop_type: "고추",
          confidence: 0.9,
          severity: "medium",
          created_at: "2026-10-06T14:18:00",
        },
      ]),
    );
    renderScreen();

    const link = await screen.findByRole("link", {
      name: "최근 진단 고추 · 탄저병, 2026.10.06 · 14:18, 주의 등급, 기록 보기",
    });

    expect(link.textContent).toContain("2026.10.06 · 14:18");
    expect(link.textContent).toContain("주의");
    expect(link.getAttribute("href")).toBe("/history/r1");
  });
});

function stubDesktop() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1024px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

// 링크를 누른 것처럼 기록을 남기고 해시를 바꾼다 (jsdom 은 hashchange 를 나중에 보내 직접 알린다)
async function openGuide() {
  await act(async () => {
    window.history.pushState(null, "", "#guide");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

describe("CaptureScreen — 기본 촬영 가이드 (M-03-2 · D-03-2)", () => {
  it("데스크탑 오른쪽 카드의 그림으로 촬영 방법 보기는 가이드로 가는 링크다", () => {
    stubDesktop();
    renderScreen();

    expect(screen.getByRole("link", { name: "그림으로 촬영 방법 보기" }).getAttribute("href")).toBe(
      "#guide",
    );
  });

  it("데스크탑 가이드: 제목, 비교 카드 세 장, 준비되셨나요, 사진 찍기·갤러리 버튼", async () => {
    stubDesktop();
    renderScreen();

    await openGuide();

    expect(title()).toBe("사진은 이렇게 찍어주세요");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "03 반점의 경계가 선명하게" })).toBeTruthy();
    expect(screen.getByText("준비되셨나요?")).toBeTruthy();
    expect(screen.getByText("너무 멀어요").closest("figcaption")?.textContent).toBe(
      "나쁜 예: 너무 멀어요",
    );
    expect(action("사진 찍기")).toBeTruthy();
    expect(action("갤러리에서 선택")).toBeTruthy();
    // 가이드 안에는 다시 가이드로 가는 링크를 두지 않는다
    expect(screen.queryByRole("link", { name: "그림으로 촬영 방법 보기" })).toBeNull();
  });

  it("모바일 가이드: 제목과 아래 예시 안내 (준비되셨나요는 데스크탑에만)", async () => {
    renderScreen();

    await openGuide();

    expect(title()).toBe("촬영 방법");
    expect(screen.getByRole("heading", { name: "03 반점에 초점을 맞춰요" })).toBeTruthy();
    expect(screen.getByText(/그림은 촬영 방법을 설명하는 예시예요/)).toBeTruthy();
    expect(screen.queryByText("준비되셨나요?")).toBeNull();
  });

  it("가이드의 사진 찍기는 가이드를 닫고 카메라를 켠다 (뒤로 가기로 가이드에 돌아오지 않는다)", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    renderScreen();
    await openGuide();
    const historyLength = window.history.length;

    await userEvent.click(action("사진 찍기"));

    expect(window.location.hash).toBe("#capture");
    expect(window.history.length).toBe(historyLength);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "실시간 프리뷰" })).toBeTruthy();
  });

  it("고른 사진이 있을 때 가이드로 가도 사진을 지우지 않고, 사진 찍기를 누르면 그때 지운다", async () => {
    stubDesktop();
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const { handlers } = renderScreen({ preview: "blob:photo", photoSource: "gallery" });
    expect(screen.getByRole("link", { name: "촬영 방법 보기" }).getAttribute("href")).toBe(
      "#guide",
    );

    await openGuide();
    expect(handlers.onClearPhoto).not.toHaveBeenCalled();

    await userEvent.click(action("사진 찍기"));
    expect(handlers.onClearPhoto).toHaveBeenCalled();
  });

  it("앱 안의 링크로 연 가이드는 닫을 때 뒤로 가기로 #guide 기록을 지우고, 카메라는 켜진 채로 둔다", async () => {
    stubDesktop();
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    // 뒤로 가기: 앞 기록(#capture)으로 돌아가 popstate·hashchange 를 보낸다
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {
      setTimeout(() => {
        window.history.replaceState(null, "", "#capture");
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
    });
    renderScreen();

    fireEvent.click(screen.getByRole("link", { name: "그림으로 촬영 방법 보기" }));
    await openGuide();
    await userEvent.click(action("사진 찍기"));
    // 카메라는 클릭 안에서 바로 켠다
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve));
    });

    expect(back).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#capture");
    expect(screen.getByRole("heading", { name: "카메라 프리뷰" })).toBeTruthy();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("Ctrl 을 누르고 연 링크(새 탭)는 이 탭의 기록을 되돌리지 않는다", async () => {
    stubDesktop();
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const back = vi.spyOn(window.history, "back");
    renderScreen();

    fireEvent.click(screen.getByRole("link", { name: "그림으로 촬영 방법 보기" }), {
      ctrlKey: true,
    });
    await openGuide();
    await userEvent.click(action("사진 찍기"));

    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#capture");
  });

  it("주소로 바로 들어온 가이드는 닫을 때 뒤로 가지 않고 해시만 바꾼다", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const back = vi.spyOn(window.history, "back");
    renderScreen();
    await openGuide();

    await userEvent.click(action("사진 찍기"));

    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#capture");
  });

  it("진단 중에는 가이드 링크를 숨기고, 가이드의 사진 찍기·갤러리도 누를 수 없다", async () => {
    stubDesktop();
    const { handlers } = renderScreen({
      preview: "blob:photo",
      photoSource: "gallery",
      loading: true,
    });
    expect(screen.queryByRole("link", { name: "촬영 방법 보기" })).toBeNull();

    await openGuide();
    const shoot = action("사진 찍기") as HTMLButtonElement;
    expect(shoot.disabled).toBe(true);
    expect((action("갤러리에서 선택") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(shoot);

    expect(handlers.onClearPhoto).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("브라우저 카메라를 못 쓰면 가이드의 사진 찍기는 사진을 지우지 않고 기기 카메라를 연다", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { handlers } = renderScreen({ preview: "blob:photo", photoSource: "gallery" });
    await openGuide();

    await userEvent.click(action("사진 찍기"));

    expect(handlers.onDeviceCamera).toHaveBeenCalledTimes(1);
    expect(handlers.onClearPhoto).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#capture");
  });

  it("가이드에서 갤러리로 새 사진을 고르면 가이드를 닫고 사진 확인으로 간다", async () => {
    const onPickGallery = vi.fn();
    const props = {
      visible: true,
      loading: false,
      onCapture: vi.fn(),
      onCaptureError: vi.fn(),
      onPickGallery,
      onDeviceCamera: vi.fn(),
      onSubmit: vi.fn(),
      onClearPhoto: vi.fn(),
    };
    const { rerender } = render(<CaptureScreen {...props} preview={null} />);
    await openGuide();

    await userEvent.click(action("갤러리에서 선택"));
    expect(onPickGallery).toHaveBeenCalled();

    rerender(<CaptureScreen {...props} preview="blob:new" photoSource="gallery" />);

    expect(window.location.hash).toBe("#capture");
    expect(title()).toBe("사진 확인");
  });

  it("권한 안내·사용 불가 화면의 오른쪽 카드에는 가이드 링크가 없다 (D-01-3·D-01-4)", async () => {
    stubDesktop();
    getUserMedia.mockRejectedValue(refused());
    renderScreen();

    await userEvent.click(action("카메라로 촬영"));

    expect(title()).toBe("카메라 접근을 허용해주세요");
    expect(screen.queryByRole("link", { name: "그림으로 촬영 방법 보기" })).toBeNull();
  });
});
