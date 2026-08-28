import { defineConfig, devices } from '@playwright/test'

// VITE_MOCK=1 로 빌드된 dist 를 preview 로 띄우고 챗 UI(v2)를 검증한다 — 서버·LLM 불필요.
// 목 모드 = "LLM off" 와 동등(부팅 즉시 칩 모드) → 릴리스 게이트 9의 P1~P5 칩 완주가 여기서 돈다.
// e2e/helpers.ts 는 공용 앵커 모듈이라 testMatch(*.spec.ts) 에 걸리지 않는다.
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 390, height: 844 }, // 모바일 우선(심사위원 폰)
    // 실패했을 때만 남긴다(전부 test-results/ · gitignore).
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: {
    // 산출물은 dist-e2e/ 로 분리 — 배포(deploy.sh)가 같은 시각에 web/dist 를 다시 빌드해도
    // 프리뷰가 서빙 중인 파일이 바뀌지 않는다(2026-08-28: 겹쳐서 48개 헛실패).
    command: 'npm run build -- --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_MOCK: '1' },
  },
})
