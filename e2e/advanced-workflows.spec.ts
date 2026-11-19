import { expect, test } from '@playwright/test';
import { API_BASE, apiOrigin, registerVerifiedAndLogin } from './helpers';

test.describe('Guulingiinhan Advanced & Production Workflows', () => {
  test('mobile 390x844 responsive layout has zero horizontal overflow across core pages', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await registerVerifiedAndLogin(page, {
      email: `e2e-mobile-${suffix}@example.com`,
      password: 'E2E-Strong-Password-2026!',
      displayName: 'Гар утас Туршигч',
    });

    const famResp = await page.request.post(`${API_BASE}/families`, {
      data: { name: `Гар утас Ураг ${suffix}` },
    });
    expect(famResp.status()).toBe(201);
    const familyId = (await famResp.json()).id as string;

    const pResp = await page.request.post(`${API_BASE}/families/${familyId}/persons`, {
      data: { first_name: 'Сарнай', last_name: 'Боржигон', gender: 'female', is_alive: true },
    });
    expect(pResp.status()).toBe(201);

    const routes = [
      `/dashboard?family=${encodeURIComponent(familyId)}`,
      `/people?family=${encodeURIComponent(familyId)}`,
      `/tree?family=${encodeURIComponent(familyId)}`,
      `/activities?family=${encodeURIComponent(familyId)}`,
      `/chat?family=${encodeURIComponent(familyId)}`,
      `/admin?family=${encodeURIComponent(familyId)}`,
      `/admin/admins?family=${encodeURIComponent(familyId)}`,
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).toContainText(/\S/);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `Horizontal overflow detected on ${route}`).toBeLessThanOrEqual(394);
    }

    expect(pageErrors).toEqual([]);
  });

  test('invite acceptance UI, minor redaction boundary, and 2-user real-time Chat SSE push', async ({ browser }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const ownerEmail = `e2e-sse-owner-${suffix}@example.com`;
    const memberEmail = `e2e-sse-member-${suffix}@example.com`;
    const password = 'E2E-Strong-Password-2026!';

    const ownerCtx = await browser.newContext();
    const memberCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    const memberPage = await memberCtx.newPage();

    try {
      await registerVerifiedAndLogin(ownerPage, {
        email: ownerEmail,
        password,
        displayName: 'Ургийн Эзэн',
      });

      const famResp = await ownerPage.request.post(`${API_BASE}/families`, {
        data: { name: `SSE Ураг ${suffix}` },
      });
      expect(famResp.status()).toBe(201);
      const familyId = (await famResp.json()).id as string;

      // Create minor person with sensitive fields that must be redacted from non-guardian members
      const minorResp = await ownerPage.request.post(`${API_BASE}/families/${familyId}/persons`, {
        data: {
          first_name: 'Бяцхан',
          last_name: 'Энх',
          gender: 'male',
          birth_date: '2019-06-01',
          birth_place: 'Хөвсгөл аймаг',
          short_description: 'Нууцлагдсан бага насны намтар',
          is_alive: true,
        },
      });
      expect(minorResp.status()).toBe(201);
      const minorPerson = await minorResp.json();

      // Create email invitation for memberEmail
      const invResp = await ownerPage.request.post(`${API_BASE}/families/${familyId}/invitations`, {
        data: { email: memberEmail, role: 'member' },
      });
      expect(invResp.status()).toBe(201);
      const invJson = await invResp.json();
      const inviteUrl = String(invJson.invite_url || '');
      const inviteToken = inviteUrl.split('#token=')[1] ?? '';
      expect(inviteToken.length).toBeGreaterThan(10);

      // Register & log in second user inside isolated browser context, then accept invitation via UI
      await registerVerifiedAndLogin(memberPage, {
        email: memberEmail,
        password,
        displayName: 'Уригдсан Гишүүн',
      });

      await memberPage.goto(`/invite#token=${encodeURIComponent(inviteToken)}`);
      await expect(memberPage.locator('body')).toContainText(`SSE Ураг ${suffix}`);
      await memberPage.getByRole('button', { name: /Зөвшөөрч гэр бүлд нэгдэх/i }).click();
      await memberPage.waitForURL((url) => url.pathname.startsWith('/tree'), { timeout: 20_000 });

      // Verify minor privacy redaction for non-guardian member
      const minorViewResp = await memberPage.request.get(
        `${API_BASE}/families/${familyId}/persons/${minorPerson.id}`,
      );
      expect(minorViewResp.status()).toBe(200);
      const minorView = await minorViewResp.json();
      expect(minorView.is_minor).toBe(true);
      expect(minorView.birth_date).toBeNull();
      expect(minorView.birth_place).toBeNull();
      expect(minorView.short_description).toBeNull();

      // Open /chat in both browsers, confirm EventSource connects on memberPage, then push live SSE message
      const sseResponsePromise = memberPage.waitForResponse(
        (res) => res.url().includes(`/families/${familyId}/chat/stream`) && res.status() === 200,
        { timeout: 15_000 },
      );
      await Promise.all([
        ownerPage.goto(`/chat?family=${encodeURIComponent(familyId)}`),
        memberPage.goto(`/chat?family=${encodeURIComponent(familyId)}`),
      ]);
      await sseResponsePromise;
      await expect(ownerPage.getByPlaceholder(/Гэр бүлийнхэндээ зурвас бичих/i)).toBeVisible();
      await expect(memberPage.getByPlaceholder(/Гэр бүлийнхэндээ зурвас бичих/i)).toBeVisible();

      const liveMessage = `Бодит цагийн SSE зурвас ${suffix}`;
      await ownerPage.getByPlaceholder(/Гэр бүлийнхэндээ зурвас бичих/i).fill(liveMessage);
      await ownerPage.getByRole('button', { name: /Илгээх/i }).click();

      // Member browser receives live update via SSE without reload (< 8s vs 30s fallback interval)
      await expect(memberPage.locator('body')).toContainText(liveMessage, { timeout: 8_000 });
    } finally {
      await ownerCtx.close();
      await memberCtx.close();
    }
  });

  test('trash bin soft-delete/restore and duplicate person merge', async ({ page }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await registerVerifiedAndLogin(page, {
      email: `e2e-trash-${suffix}@example.com`,
      password: 'E2E-Strong-Password-2026!',
      displayName: 'Архив Зохицуулагч',
    });

    const famResp = await page.request.post(`${API_BASE}/families`, {
      data: { name: `Хогийн сав Ураг ${suffix}` },
    });
    expect(famResp.status()).toBe(201);
    const familyId = (await famResp.json()).id as string;

    const tempPerson = await (
      await page.request.post(`${API_BASE}/families/${familyId}/persons`, {
        data: { first_name: 'ТүрСэргээх', last_name: 'Ураг', gender: 'male', is_alive: true },
      })
    ).json();

    const dupA = await (
      await page.request.post(`${API_BASE}/families/${familyId}/persons`, {
        data: {
          first_name: 'Бат-Эрдэнэ',
          last_name: 'Сүх',
          gender: 'male',
          birth_place: 'Архангай',
          is_alive: true,
        },
      })
    ).json();

    const dupB = await (
      await page.request.post(`${API_BASE}/families/${familyId}/persons`, {
        data: {
          first_name: 'Бат-Эрдэнэ',
          last_name: 'Сүх',
          gender: 'male',
          short_description: 'Нэгтгэсэн намтар',
          is_alive: true,
        },
      })
    ).json();

    // Soft-delete -> verify in trash -> restore -> verify back in family
    const delResp = await page.request.delete(`${API_BASE}/families/${familyId}/persons/${tempPerson.id}`);
    expect(delResp.status()).toBe(204);

    const trashList = await (await page.request.get(`${API_BASE}/families/${familyId}/trash`)).json();
    const trashItem = trashList.find((item: { person_id: string }) => item.person_id === tempPerson.id);
    expect(trashItem).toBeDefined();

    const restoreResp = await page.request.post(
      `${API_BASE}/families/${familyId}/trash/${trashItem.id}/restore`,
    );
    expect(restoreResp.status()).toBe(200);
    expect((await page.request.get(`${API_BASE}/families/${familyId}/persons/${tempPerson.id}`)).status()).toBe(200);

    // Duplicate merge B -> A
    const mergeResp = await page.request.post(
      `${API_BASE}/families/${familyId}/persons/${dupA.id}/merge/${dupB.id}`,
    );
    expect(mergeResp.status()).toBe(200);
    expect((await mergeResp.json()).merged).toBe(true);

    const mergedA = await (await page.request.get(`${API_BASE}/families/${familyId}/persons/${dupA.id}`)).json();
    expect(mergedA.birth_place).toBe('Архангай');
    expect(mergedA.short_description).toBe('Нэгтгэсэн намтар');
    expect((await page.request.get(`${API_BASE}/families/${familyId}/persons/${dupB.id}`)).status()).toBe(404);
  });

  test('family fund net balance ledger UI and Prometheus /metrics exposition', async ({ page }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await registerVerifiedAndLogin(page, {
      email: `e2e-fund-${suffix}@example.com`,
      password: 'E2E-Strong-Password-2026!',
      displayName: 'Сангийн Нярав',
    });

    const familyId = (
      await (
        await page.request.post(`${API_BASE}/families`, {
          data: { name: `Сантай Ураг ${suffix}` },
        })
      ).json()
    ).id as string;

    const fund = await (
      await page.request.post(`${API_BASE}/families/${familyId}/funds`, {
        data: {
          title: 'Хөгжлийн Сан',
          purpose: 'Зуны наадам',
          currency: 'MNT',
          payment_instruction: 'Хаан Банк 5000999888',
          visibility: 'family',
        },
      })
    ).json();

    const donation = await (
      await page.request.post(`${API_BASE}/families/${familyId}/funds/${fund.id}/donations`, {
        data: { amount_minor: 5_000_000, private_donor: false },
      })
    ).json();

    expect(
      (await page.request.post(`${API_BASE}/families/${familyId}/funds/${fund.id}/donations/${donation.id}/report`)).status(),
    ).toBe(200);
    expect(
      (await page.request.post(`${API_BASE}/families/${familyId}/funds/${fund.id}/donations/${donation.id}/confirm`)).status(),
    ).toBe(200);

    const expenseResp = await page.request.post(`${API_BASE}/families/${familyId}/funds/${fund.id}/expenses`, {
      data: {
        title: 'Хэвлэлийн зардал',
        amount_minor: 1_500_000,
        note: 'Брошюр хэвлэлт',
      },
    });
    expect(expenseResp.status()).toBe(201);

    await page.goto(`/activities?family=${encodeURIComponent(familyId)}`);
    await expect(page.locator('body')).toContainText('Хэвлэлийн зардал');
    const balanceStrip = page.locator('.activities-balance-grid').first();
    await expect(balanceStrip).toContainText(/50[,\s\u00a0]000\s*₮/);
    await expect(balanceStrip).toContainText(/15[,\s\u00a0]000\s*₮/);
    await expect(balanceStrip).toContainText(/35[,\s\u00a0]000\s*₮/);

    // Verify backend Prometheus /metrics endpoint
    const metricsResp = await page.request.get(`${apiOrigin()}/metrics`);
    expect(metricsResp.status()).toBe(200);
    const metricsBody = await metricsResp.text();
    expect(metricsBody).toContain('guulin_http_requests_total');
    expect(metricsBody).toContain('guulin_chat_sse_active_connections');
  });

  test('multi-page admin cockpit, sub-admin promotion/permissions UI, and data refresh', async ({ browser }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const ownerEmail = `e2e-adm-owner-${suffix}@example.com`;
    const helperEmail = `e2e-adm-helper-${suffix}@example.com`;
    const password = 'E2E-Strong-Password-2026!';

    const ownerCtx = await browser.newContext();
    const helperCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    const helperPage = await helperCtx.newPage();

    try {
      await registerVerifiedAndLogin(ownerPage, {
        email: ownerEmail,
        password,
        displayName: 'Ерөнхий Эзэн',
      });

      const familyId = (
        await (
          await ownerPage.request.post(`${API_BASE}/families`, {
            data: { name: `Админ Төв Ураг ${suffix}` },
          })
        ).json()
      ).id as string;

      // Add a person with extra spaces so data refresh normalizes it cleanly
      const personResp = await ownerPage.request.post(`${API_BASE}/families/${familyId}/persons`, {
        data: { first_name: '  Төмөр  ', last_name: '  Алт  ', gender: 'male', is_alive: true },
      });
      expect(personResp.status()).toBe(201);

      // Invite and join helper member
      const invResp = await ownerPage.request.post(`${API_BASE}/families/${familyId}/invitations`, {
        data: { email: helperEmail, role: 'member' },
      });
      expect(invResp.status()).toBe(201);
      const token = String((await invResp.json()).invite_url || '').split('#token=')[1] ?? '';

      await registerVerifiedAndLogin(helperPage, {
        email: helperEmail,
        password,
        displayName: 'Туслах Гишүүн',
      });
      expect(
        (await helperPage.request.post(`${API_BASE}/invitations/accept`, { data: { token } })).status(),
      ).toBe(200);

      // 1. Open Admin Command Cockpit (/admin)
      await ownerPage.goto(`/admin?family=${encodeURIComponent(familyId)}`);
      await expect(ownerPage.getByRole('heading', { name: /Админы Ерөнхий Төв/ })).toBeVisible();
      await expect(ownerPage.locator('body')).toContainText('Өгөгдлийн эрүүл мэнд');

      // 2. Navigate to dedicated Admins & Roles page (/admin/admins)
      await ownerPage.getByRole('link', { name: /Админ ба Эрх/ }).first().click();
      await ownerPage.waitForURL(new RegExp(`/admin/admins\\?family=${familyId}`));

      // Promote helper via preset & custom title
      await ownerPage.getByRole('button', { name: /Өгөгдөл ба Мод шинэчлэгч/ }).click();
      await ownerPage.getByPlaceholder(/Өгөгдөл ба Мод хариуцагч/).fill('Дата ба Түүхийн Туслах');
      await ownerPage.getByRole('button', { name: /Туслах админаар томилох/ }).click();

      await expect(ownerPage.locator('body')).toContainText('Дата ба Түүхийн Туслах');

      // Open Edit Sub-Admin modal and demote back to member
      await ownerPage.getByRole('button', { name: /Эрх & Үүрэг засах/ }).click();
      const dialog = ownerPage.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('select').selectOption('member');
      await dialog.getByRole('button', { name: /Хадгалах/ }).click();
      await expect(dialog).toBeHidden();
      await expect(ownerPage.getByRole('button', { name: /Эрх & Үүрэг засах/ })).toHaveCount(0);

      // 3. Navigate to dedicated Data & Audit page (/admin/data) and run 1-click Data Refresh
      await ownerPage.getByRole('link', { name: /Өгөгдөл ба Аудит/ }).first().click();
      await ownerPage.waitForURL(new RegExp(`/admin/data\\?family=${familyId}`));
      await ownerPage.getByRole('button', { name: /Өгөгдөл шинэчлэх/ }).click();
      await expect(ownerPage.locator('body')).toContainText('Сүүлд шинэчилсэн:');
    } finally {
      await ownerCtx.close();
      await helperCtx.close();
    }
  });
});
