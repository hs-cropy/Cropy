import { cardClassName } from "@/components/Card";
import { cn } from "@/lib/cn";

// 예시 그림. Figma 의 Illustration/Capture/Leaf 와 Framing brackets 를 그대로 받은 SVG 다
const LEAF = "/guide/leaf.svg";
const LEAF_SMALL = "/guide/leaf-small.svg";
const LEAF_BLURRED = "/guide/leaf-blurred.svg";
const FRAME = "/guide/frame.svg";

// far: 작은 잎 + 촬영 틀 / framed: 큰 잎 + 촬영 틀 / dark: 어둡게 덮은 잎 / blurred: 흔들려 흐린 잎
type Art = "far" | "framed" | "dark" | "blurred";

interface Example {
  label: string;
  art: Art;
}

interface Step {
  title: string;
  body: string;
  /** 데스크탑 시안의 문구가 다를 때 */
  desktopTitle?: string;
  desktopBody?: string;
  bad: Example;
  good: Example;
}

// Figma M-03-2 · D-03-2 (기본 촬영 가이드)
const STEPS: Step[] = [
  {
    title: "잎이 화면을 채우게",
    body: "반점과 주변 잎이 함께 보이게 가까이 대세요. 잎이 틀 안에 크게 들어오면 좋아요.",
    bad: { label: "너무 멀어요", art: "far" },
    good: { label: "이 정도로 크게", art: "framed" },
  },
  {
    title: "색과 무늬가 보이게",
    body: "밝은 그늘이나 창가에서 찍어주세요. 검은 그림자와 하얀 빛 반사를 피해 주세요.",
    bad: { label: "어두워 안 보여요", art: "dark" },
    good: { label: "색이 잘 보여요", art: "framed" },
  },
  {
    title: "반점에 초점을 맞춰요",
    body: "화면의 반점을 눌러 초점을 맞춘 뒤, 손을 멈추고 찍어주세요.",
    desktopTitle: "반점의 경계가 선명하게",
    desktopBody:
      "카메라 초점을 맞춘 뒤 흔들리지 않게 찍어주세요. 사진을 올릴 때도 반점의 경계를 확인하세요.",
    bad: { label: "흔들려 흐려요", art: "blurred" },
    good: { label: "경계가 선명해요", art: "framed" },
  },
];

function Illustration({ art }: { art: Art }) {
  const leaf = art === "far" ? LEAF_SMALL : art === "blurred" ? LEAF_BLURRED : LEAF;
  return (
    // 그림은 아래 글(“너무 멀어요” 등)이 설명하므로 읽지 않는다
    <div
      aria-hidden
      className="relative h-[7.5rem] overflow-hidden rounded-xl bg-cropy-surface-canvas"
    >
      {/* Figma 칸(171×120)에서 잎은 높이의 90%·폭의 63%(멀리는 30%·21%)다. 칸이 좁아지거나
          큰글씨로 높아져도 이 비율 안에 맞춰 그려 촬영 틀(폭 15~85%) 밖으로 나가지 않는다 */}
      {/* eslint-disable-next-line @next/next/no-img-element -- 1KB 안팎의 장식 SVG */}
      <img
        src={leaf}
        alt=""
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain",
          art === "far" ? "h-[30%] w-[21%]" : "h-[90%] w-[63%]",
        )}
      />
      {/* 어두운 사진: 잎 위를 짙게 덮는다 (Illustration/Low light, 57%) */}
      {art === "dark" && <div className="absolute inset-0 bg-cropy-text-primary opacity-[0.57]" />}
      {/* 촬영 틀 모서리. Figma 처럼 칸 크기에 맞춰 늘린다 */}
      {(art === "far" || art === "framed") && (
        // eslint-disable-next-line @next/next/no-img-element -- 장식 SVG
        <img src={FRAME} alt="" className="absolute inset-0 size-full" />
      )}
    </div>
  );
}

function ExampleFigure({
  example,
  good,
  desktop,
}: {
  example: Example;
  good: boolean;
  desktop: boolean;
}) {
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Illustration art={example.art} />
      <figcaption
        className={cn(
          "break-keep text-center text-cropy-caption font-bold",
          desktop && "leading-6",
          good ? "text-cropy-status-low" : "text-cropy-text-secondary",
        )}
      >
        {/* 색만으로 구분하지 않게 좋은 예·나쁜 예를 함께 읽어 준다 */}
        <span className="sr-only">{good ? "좋은 예: " : "나쁜 예: "}</span>
        {example.label}
      </figcaption>
    </figure>
  );
}

/**
 * 기본 촬영 가이드의 본문 (모바일 M-03-2 · 데스크탑 D-03-2): 크기·밝기·초점을 나쁜 예/좋은 예 그림으로 비교한다.
 * 카드는 안쪽 16px·모서리 20px·간격 12px, 제목 18px, 설명 14px, 그림 칸 120px·모서리 12px.
 * 모바일은 카드를 세로로 쌓고 아래에 예시 안내를, 데스크탑은 세 장을 나란히 두고 아래에 "준비되셨나요?"를 둔다.
 */
export function CaptureGuide({ desktop = false }: { desktop?: boolean }) {
  return (
    <div className={cn("flex flex-col", desktop ? "gap-6" : "gap-4")}>
      <ol className={cn(desktop ? "grid grid-cols-3 gap-6" : "flex flex-col gap-4")}>
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className={cn(
              cardClassName({ radius: "lg", padding: "none" }),
              "flex min-w-0 flex-col gap-3 p-4",
            )}
          >
            <h2
              className={cn(
                "break-keep text-cropy-feedback-title text-cropy-text-primary",
                desktop && "leading-6",
              )}
            >
              {/* 띄어 써야 "03 반점에…"로 읽힌다 (붙이면 "03반점에…") */}
              <span className="mr-1">{String(index + 1).padStart(2, "0")}</span>{" "}
              {desktop ? (step.desktopTitle ?? step.title) : step.title}
            </h2>
            <p
              className={cn(
                "break-keep text-cropy-helper text-cropy-text-secondary",
                desktop && "leading-6",
              )}
            >
              {desktop ? (step.desktopBody ?? step.body) : step.body}
            </p>
            <div className="flex gap-2.5">
              <ExampleFigure example={step.bad} good={false} desktop={desktop} />
              <ExampleFigure example={step.good} good desktop={desktop} />
            </div>
          </li>
        ))}
      </ol>

      {desktop ? (
        <div className={cn(cardClassName({ padding: "none" }), "flex flex-col gap-1 p-6")}>
          <p className="text-cropy-heading-md text-cropy-text-primary">준비되셨나요?</p>
          <p className="text-cropy-helper text-cropy-text-secondary">
            증상이 잘 보이는 사진 한 장으로 시작해보세요.
          </p>
        </div>
      ) : (
        <p className="whitespace-pre-line break-keep text-cropy-caption text-cropy-text-secondary">
          {"그림은 촬영 방법을 설명하는 예시예요.\n병해를 구분하는 진단 사진은 아니에요."}
        </p>
      )}
    </div>
  );
}
