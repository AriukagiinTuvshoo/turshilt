import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

function verifyE2EUserEmail(email: string) {
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

test.describe('Guulingiinhan Core E2E User Journey', () => {
  test('renders landing page without uncaught runtime errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await expect(page).toHaveTitle(/Гуулингийнхан/i);
    await expect(page.locator('body')).toContainText(/Гуулингийнхан/i);
    expect(pageErrors).toEqual([]);
  });

  test('full journey: register -> login -> create family -> add people -> tree -> kinship calculator', async ({ page }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `e2e-${uniqueSuffix}@example.com`;
    const password = 'E2E-Strong-Password-2026!';

    // 1. Register via API & verify test account email
    const regResp = await page.request.post(`${API_BASE}/auth/register`, {
      data: {
        email,
        password,
        display_name: 'E2E Туршигч',
      },
    });
    expect(regResp.status()).toBe(201);
    verifyE2EUserEmail(email);

    // 2. Log in through the real /login UI
    await page.goto('/login');
    await page.locator('input[name="email"], input[type="email"]').first().fill(email);
    await page.locator('input[name="password"], input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"]').first().click();

    // Wait for authenticated redirect away from /login
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });

    // 3. Create family + 2 related people (Father & Son) using authenticated browser session cookies
    const famResp = await page.request.post(`${API_BASE}/families`, {
      data: { name: `E2E Боржигон ураг ${uniqueSuffix}` },
    });
    expect(famResp.status()).toBe(201);
    const family = await famResp.json();
    const familyId = family.id as string;

    const fatherResp = await page.request.post(`${API_BASE}/families/${familyId}/persons`, {
      data: {
        first_name: 'Дорж',
        last_name: 'Боржигон',
        gender: 'male',
        birth_date: '1960-05-10',
        is_alive: true,
      },
    });
    expect(fatherResp.status()).toBe(201);
    const father = await fatherResp.json();

    const sonResp = await page.request.post(`${API_BASE}/families/${familyId}/persons`, {
      data: {
        first_name: 'Тэмүүлэн',
        last_name: 'Дорж',
        gender: 'male',
        birth_date: '1992-08-15',
        is_alive: true,
      },
    });
    expect(sonResp.status()).toBe(201);
    const son = await sonResp.json();

    const relResp = await page.request.post(
      `${API_BASE}/families/${familyId}/relationships/parent-child`,
      {
        data: {
          parent_id: father.id,
          child_id: son.id,
          relationship_type: 'biological',
        },
      },
    );
    expect(relResp.status()).toBe(201);

    // 4. Open /tree and verify both people render on the interactive family tree
    await page.goto(`/tree?family=${encodeURIComponent(familyId)}`);
    await expect(page.locator('body')).toContainText('Дорж');
    await expect(page.locator('body')).toContainText('Тэмүүлэн');

    // 5. Open unified Kinship Calculator modal, verify Mongolian kinship term, swap A <-> B, and close with Escape
    await page.getByRole('button', { name: /Хамаарал тооцоолох/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Монгол Ургийн Хамаарлын Тооцоолуур');

    // Initial pair (Father <-> Son) must show either "Хүү" or "Аав"
    await expect(dialog).toContainText(/(Хүү|Аав)/);

    // Click swap (⇄ Солих) and verify the reciprocal term appears
    const initialText = await dialog.innerText();
    const hadSon = initialText.includes('Хүү');
    await dialog.getByRole('button', { name: /Солих/i }).click();
    await expect(dialog).toContainText(hadSon ? 'Аав' : 'Хүү');

    // Escape closes the modal cleanly
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
