import { defineConfig, devices } from '@playwright/test'

// VITE_MOCK=1 로 빌드된 dist 를 preview 로 띄우고 4페르소나를 검증한다(서버 불필요).
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
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_MOCK: '1' },
  },
})
