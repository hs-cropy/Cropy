// Next 의 "*.module.css" 선언이 항상 먼저 오게 한다 (먼저 선언된 쪽이 이긴다)
/// <reference types="next" />

// `import "./globals.css"` 처럼 불러오기만 하는 CSS.
// 최신 TypeScript(편집기 내장 버전 포함)는 형식 선언이 없는 불러오기를 오류로 표시한다.
// 본문을 비워 `import styles from "./a.css"` 처럼 값을 꺼내 쓰는 것은 허용하지 않는다
declare module "*.css" {}
