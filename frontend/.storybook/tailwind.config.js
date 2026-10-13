const base = require("../tailwind.config.js");

// 앱 설정과 같되 스토리 파일도 스캔한다. 앱 설정은 스토리에만 나오는 클래스가
// 앱 CSS에 섞이지 않게 스토리를 빼는데, 여기서도 빼면 스토리 전용 클래스와
// 아이콘이 Storybook 화면에서 사라진다.
// content 경로는 실행 위치 기준이라 Storybook은 frontend 에서 띄워야 한다 (npm 스크립트)
/** @type {import('tailwindcss').Config} */
module.exports = {
  ...base,
  content: base.content.filter((pattern) => !pattern.includes(".stories.")),
};
