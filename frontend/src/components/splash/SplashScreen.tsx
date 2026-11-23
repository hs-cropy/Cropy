
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useInstalledApp } from "@/hooks/useInstalledApp";
import styles from "./SplashScreen.module.css";

const TAGLINE = "작물의 오늘을 살피고, 건강한 내일을 키워요";
const TAGLINE_CHARS = Array.from(TAGLINE);

export function SplashScreen() {
  const [typedCount, setTypedCount] = useState(0);
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const installed = useInstalledApp();

  useEffect(() => {
    // 애니메이션 감소 설정이 켜져 있으면 문구 바로 표시
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTypedCount(TAGLINE_CHARS.length);
      setIsTypingComplete(true);
      return;
    }

    let count = 0;
    let typingTimer: ReturnType<typeof setInterval> | undefined;

    // 처음 1초: 커서만 깜빡임
    const startTimer = setTimeout(() => {
      // 이후 65ms마다 한 글자씩 표시
      typingTimer = setInterval(() => {
        count += 1;
        setTypedCount(count);

        if (count >= TAGLINE_CHARS.length) {
          clearInterval(typingTimer);
          setIsTypingComplete(true);
        }
      }, 65);
    }, 1000);

    return () => {
      clearTimeout(startTimer);

      if (typingTimer !== undefined) {
        clearInterval(typingTimer);
      }
    };
  }, []);

  return (
    <main className={styles.splash}>
      {/* 농장 배경 */}
      <div className={styles.background} aria-hidden="true" />

      {/* Figma Shade */}
      <div className={styles.shade} aria-hidden="true" />

      {/* 햇빛 */}
      <div className={styles.sunlight} aria-hidden="true" />

      {/* 움직이는 구름 */}
      <div className={styles.clouds} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/splash/cloud-a.webp"
          alt=""
          className={`${styles.cloud} ${styles.cloudA}`}
        />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/splash/cloud-b.webp"
          alt=""
          className={`${styles.cloud} ${styles.cloudB}`}
        />
      </div>

      {/* 로고와 브랜드 문구 */}
      <div className={styles.brand}>
        {/* 로고 + 금빛 섬광 */}
        <div className={styles.logoWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/cropy-splash-logo.svg"
            alt="Cropy"
            className={styles.logo}
          />

          <span className={styles.logoShine} aria-hidden="true" />
        </div>

        {/* 스크린리더에는 전체 문구를 한 번에 제공 */}
        <p className="sr-only">{TAGLINE}</p>

        {/* 화면에는 타이핑 애니메이션 표시 */}
        <p className={styles.tagline} aria-hidden="true">
          <span className={styles.typingFrame}>
            <span className={styles.typingPlaceholder}>
              {TAGLINE}
            </span>

            {/* 실제로 입력되는 글자 + 따라가는 커서 */}
            <span className={styles.typingText}>
              {TAGLINE_CHARS.slice(0, typedCount).join("")}

              {!isTypingComplete && (
                <span className={styles.cursor} />
              )}
            </span>
          </span>
        </p>
      </div>

      {/* 하단 버튼 */}
      <div className={styles.actions}>
        <Link href="/home" className={styles.startButton}>
          시작하기
        </Link>

        {/* 설치 안내는 인터넷 없이도 열리는 정적 페이지라 Link 가 아닌 전체 페이지 이동이다.
            이미 설치한 앱으로 열었으면 보이지 않는다 (하이드레이션 전에는 CSS 미디어 쿼리가 숨긴다) */}
        {!installed && (
          <a href="/offline/install.html" className={styles.installButton}>
            앱 설치하기
          </a>
        )}
      </div>
    </main>
  );
}
