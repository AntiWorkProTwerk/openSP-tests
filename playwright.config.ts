import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',
  testMatch:'**/*.spec.ts',
  fullyParallel:true,
  forbidOnly:!!process.env.CI,
  retries:process.env.CI?1:0,
  workers:process.env.CI?2:undefined,
  reporter:process.env.CI?'github':'list',
  use:{baseURL:process.env.OPENSP_TEST_URL||'http://127.0.0.1:4321',trace:'retain-on-failure',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}} ,
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer:process.env.OPENSP_TEST_URL?undefined:{command:'npm run preview -- --port 4321',url:'http://127.0.0.1:4321',reuseExistingServer:!process.env.CI},
});
