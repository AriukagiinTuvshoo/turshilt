import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, Page } from '@playwright/test';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

export function apiOrigin(): string {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return 'http://localhost:8000';
  }
}

export function verifyE2EUserEmail(email: string): void {
  const backendDir = path.resolve(process.cwd(), 'backend');
  const winPython = path.join(backendDir, '.venv', 'Scripts', 'python.exe');
  const nixPython = path.join(backendDir, '.venv', 'bin', 'python');
  const pythonBin = fs.existsSync(winPython)
    ? winPython
    : fs.existsSync(nixPython)
      ? nixPython
      : 'python3';

  execFileSync(pythonBin, ['scripts/verify_e2e_user.py', email], {
    cwd: backendDir,
    stdio: 'pipe',
    env: { ...process.env, PYTHONPATH: backendDir },
  });
}

export async function registerVerifiedAndLogin(
  page: Page,
  {
    email,
    password,
    displayName,
  }: {
    email: string;
    password: string;
    displayName: string;
  },
): Promise<void> {
  const regResp = await page.request.post(`${API_BASE}/auth/register`, {
    data: {
      email,
      password,
      display_name: displayName,
    },
  });
  expect(regResp.status()).toBe(201);
  verifyE2EUserEmail(email);

  await page.goto('/login');
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}
