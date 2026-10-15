import {defineConfig,devices} from '@playwright/test';
const testPort=process.env.OPENSP_TEST_PORT||'4332';
const testURL=`http://127.0.0.1:${testPort}`;
export default defineConfig({
  testDir:'./tests',
  testMatch:'**/*.spec.ts',
  fullyParallel:true,
  forbidOnly:!!process.env.CI,
  retries:process.env.CI?1:0,
  workers:process.env.CI?2:undefined,
  reporter:process.env.CI?'github':'list',
  use:{baseURL:process.env.OPENSP_TEST_URL||testURL,trace:'retain-on-failure',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}} ,
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer:process.env.OPENSP_TEST_URL?undefined:{command:`npm run preview -- --port ${testPort}`,url:testURL,reuseExistingServer:false},
});
