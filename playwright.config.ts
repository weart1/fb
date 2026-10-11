import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      // the SDK (correctly) ignores automated browsers; tests opt out of the webdriver flag
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },
  webServer: {
    command: 'python3 -m http.server 5173 --directory examples',
    port: 5173,
    reuseExistingServer: true,
  },
});
