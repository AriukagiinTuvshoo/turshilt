'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Family } from '../../lib/api';
import { ConfirmDialog } from '../../components/confirm-dialog';
import './activities.css';

type Fund = {
  id: string;
  family_id: string;
  title: string;
  purpose: string;
  currency: string;
  payment_instruction: string;
  visibility: 'family' | 'public';
  is_active: boolean;
  confirmed_income_minor: number;
  total_expenses_minor: number;
  net_balance_minor: number;
  created_at: string;
};

type PublicFund = Fund & { family_name: string };

type Donation = {
  id: string;
  fund_id: string;
  amount_minor: number;
  currency: string;
  status: 'pledged' | 'reported' | 'confirmed' | 'cancelled' | string;
  donor_name: string | null;
  private_donor: boolean;
  is_mine?: boolean;
  created_at: string;
};

type FundExpense = {
  id: string;
  fund_id: string;
  amount_minor: number;
  currency: string;
  title: string;
  note: string;
  spent_at: string;
  recorded_by_name: string | null;
  created_at: string;
};

type FamilyEvent = {
  id: string;
  family_id: string;
  title: string;
  description: string;
  starts_at: string;
  location: string;
  registration_deadline: string | null;
  capacity: number | null;
  adult_fee_minor: number;
  child_fee_minor: number;
  currency: string;
  payment_instruction: string;
};

type Registration = {
  id: string;
  event_id: string;
  user_id: string;
  adult_count: number;
  child_count: number;
  status: 'registered' | 'cancelled' | string;
  payment_status: 'unpaid' | 'reported' | 'confirmed' | string;
  created_at: string;
};

const root = (id: string) => `/families/${encodeURIComponent(id)}`;
const money = (amountMinor: number, currency: string) =>
  `${new Intl.NumberFormat('mn-MN').format(amountMinor / 100)} ${currency === 'MNT' ? '₮' : currency}`;
const localDate = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16);
const toLocalInputValue = (iso: string | null): string => {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

function statusLabel(status: string) {
  if (status === 'pledged') return 'Бүртгүүлсэн';
  if (status === 'reported') return 'Шилжүүлсэн (хүлээгдэж буй)';
  if (status === 'confirmed') return '✅ Баталгаажсан';
  if (status === 'unpaid') return 'Төлбөр хүлээгдэж буй';
  return status;
}

function PublicFundsSection({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: PublicFund[];
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <section
      className="activities-public-section"
      aria-labelledby="public-funds-heading"
    >
      <div className="activities-section-head">
        <span className="activities-kicker">ГУУЛИНГИЙНХНЫ ӨВИЙН САН</span>
        <h2 id="public-funds-heading" className="activities-section-title">
          Нийтийн нээлттэй сангууд
        </h2>
        <p className="activities-section-subtitle">
          Зөвхөн нийтэд ил тод хуваалцахаар сонгосон идэвхтэй гэр бүлийн сангууд.
        </p>
      </div>

      {error && (
        <div className="error activities-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="activities-retry-btn">
            Дахин оролдох
          </button>
        </div>
      )}

      {loading ? (
        <p className="activities-status-msg" role="status">
          Нийтийн санг ачаалж байна…
        </p>
      ) : !rows.length ? (
        <p className="activities-status-msg">
          Одоогоор нийтэд хуваалцсан сан бүртгэгдээгүй байна.
        </p>
      ) : (
        <div className="activities-grid-public">
          {rows.map((fund) => (
            <article key={fund.id} className="activities-public-card">
              <div className="activities-public-meta">
                <span>🌐 НИЙТЭД НЭЭЛТТЭЙ</span>
                <span>{fund.family_name}</span>
              </div>
              <h3 className="activities-card-title activities-card-title--sm">{fund.title}</h3>
              <p className="activities-card-desc">{fund.purpose}</p>
              <div className="activities-payment-box">
                <small className="activities-payment-label">ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ</small>
                <p className="activities-payment-text">{fund.payment_instruction}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivitiesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [contextLoading, setContextLoading] = useState(true);

  const [section, setSection] = useState<'fund' | 'events'>('fund');
  const [funds, setFunds] = useState<Fund[]>([]);
  const [donations, setDonations] = useState<Record<string, Donation[]>>({});
  const [expenses, setExpenses] = useState<Record<string, FundExpense[]>>({});
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, Registration[]>>({});
  const [mine, setMine] = useState<Record<string, Registration | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fundVisibility, setFundVisibility] = useState<'family' | 'public'>('family');
  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [publicFunds, setPublicFunds] = useState<PublicFund[]>([]);
  const [publicFundsLoading, setPublicFundsLoading] = useState(true);
  const [publicFundsError, setPublicFundsError] = useState('');

  const manage = family?.role === 'owner' || family?.role === 'editor';
  const owner = family?.role === 'owner';

  const loadFamilies = useCallback(async () => {
    setContextLoading(true);
    try {
      const list = await api<Family[]>('/families');
      setFamilies(list);
      if (!list.length) {
        setFamily(null);
        setFamilyId('');
        setContextLoading(false);
        return;
      }
      const requested = searchParams.get('family') ?? '';
      const selected = list.find((item) => item.id === requested) ?? list[0];
      setFamily(selected);
      setFamilyId(selected.id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Гэр бүлийн орчныг ачаалж чадсангүй.');
    } finally {
      setContextLoading(false);
    }
  }, [router, searchParams]);

  useEffect(() => {
    void loadFamilies();
  }, [loadFamilies]);

  const reloadPublicFunds = useCallback(async () => {
    setPublicFundsError('');
    setPublicFundsLoading(true);
    try {
      setPublicFunds(await api<PublicFund[]>('/public/funds'));
    } catch (cause) {
      setPublicFundsError(cause instanceof Error ? cause.message : 'Нийтийн санг ачаалж чадсангүй.');
    } finally {
      setPublicFundsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadPublicFunds();
  }, [reloadPublicFunds]);

  const reload = useCallback(async () => {
    if (!familyId) return;
    setError('');
    try {
      const [fundRows, eventRows] = await Promise.all([
        api<Fund[]>(`${root(familyId)}/funds`),
        api<FamilyEvent[]>(`${root(familyId)}/events`),
      ]);
      setFunds(fundRows);
      setEvents(eventRows);

      const [ds, exs] = await Promise.all([
        Promise.all(
          fundRows.map(
            async (f) =>
              [f.id, await api<Donation[]>(`${root(familyId)}/funds/${f.id}/donations`)] as const,
          ),
        ),
        Promise.all(
          fundRows.map(
            async (f) =>
              [f.id, await api<FundExpense[]>(`${root(familyId)}/funds/${f.id}/expenses`)] as const,
          ),
        ),
      ]);
      setDonations(Object.fromEntries(ds));
      setExpenses(Object.fromEntries(exs));

      const rs = await Promise.all(
        eventRows.map(
          async (e) =>
            [
              e.id,
              family?.role === 'owner' || family?.role === 'editor'
                ? await api<Registration[]>(`${root(familyId)}/events/${e.id}/registrations`)
                : [],
            ] as const,
        ),
      );
      setRegistrations(Object.fromEntries(rs));

      const own = await Promise.all(
        eventRows.map(async (e) => {
          try {
            return [
              e.id,
              await api<Registration>(`${root(familyId)}/events/${e.id}/registrations/me`),
            ] as const;
          } catch {
            return [e.id, null] as const;
          }
        }),
      );
      setMine(Object.fromEntries(own));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Мэдээлэл ачаалж чадсангүй.');
    }
  }, [family, familyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await Promise.all([reload(), reloadPublicFunds()]);
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Үйлдэл амжилтгүй боллоо.');
    } finally {
      setBusy(false);
    }
  }

  async function newFund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const visibility = d.get('visibility') === 'public' ? 'public' : 'family';
    await run(
      () =>
        api(`${root(familyId)}/funds`, {
          method: 'POST',
          body: JSON.stringify({
            title: d.get('title'),
            purpose: d.get('purpose'),
            currency: 'MNT',
            payment_instruction: d.get('instruction'),
            visibility,
          }),
        }),
      visibility === 'public' ? 'Ургийн санг нийтэд хуваалцлаа.' : 'Ургийн сан амжилттай үүслээ.',
    );
    form.reset();
    setFundVisibility('family');
  }

  async function newEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    await run(
      () =>
        api(`${root(familyId)}/events`, {
          method: 'POST',
          body: JSON.stringify({
            title: d.get('title'),
            description: d.get('description'),
            location: d.get('location'),
            starts_at: new Date(String(d.get('starts_at'))).toISOString(),
            registration_deadline: d.get('deadline')
              ? new Date(String(d.get('deadline'))).toISOString()
              : null,
            capacity: d.get('capacity') ? Number(d.get('capacity')) : null,
            adult_fee_minor: Number(d.get('adult_fee') || 0) * 100,
            child_fee_minor: Number(d.get('child_fee') || 0) * 100,
            currency: 'MNT',
            payment_instruction: d.get('instruction') || '',
          }),
        }),
      'Ургийн уулзалт, арга хэмжээ амжилттай зарлагдлаа.',
    );
    form.reset();
  }

  if (contextLoading) {
    return (
      <main className="people-page">
        <section className="people-shell">
          <p role="status">Ургийн сан болон уулзалтын мэдээллийг ачаалж байна…</p>
        </section>
      </main>
    );
  }

  if (!familyId) {
    return (
      <main className="people-page">
        <section className="people-shell">
          <header className="activities-empty-header">
            <p className="eyebrow">ГЭР БҮЛИЙН ХАМТЫН АМЬДРАЛ</p>
            <h1>Ургийн Сан ба Уулзалт</h1>
            <p className="people-lede">
              Өөрийн гэр бүлийн сан, уулзалтыг харахын тулд гэр бүлээ үүсгэх эсвэл сонгоно уу.{' '}
              <Link href="/families">Гэр бүлүүд рүү очих →</Link>
            </p>
          </header>
          <PublicFundsSection
            rows={publicFunds}
            loading={publicFundsLoading}
            error={publicFundsError}
            onRetry={() => void reloadPublicFunds()}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="people-page">
      <section className="people-shell">
        <header className="people-heading">
          <div>
            <Link
              className="people-back-link"
              href={`/dashboard?family=${encodeURIComponent(familyId)}`}
            >
              ← Гэр бүлийн тойм
            </Link>
            <p className="eyebrow">ГУУЛИНГИЙНХАН · ХАМТЫН АМЬДРАЛ</p>
            <h1>Ургийн Сан & Уулзалт, Цугларалт</h1>
            <p className="people-lede">
              {family?.name ?? 'Гэр бүл'} — Ургийн баяр наадам, ном бүтээх, буяны ажил, хамтын сан болон удмын уулзалтын ирцийн бүртгэл.
            </p>
          </div>
          <div className="people-heading-actions">
            {families.length > 1 && (
              <label className="people-control">
                <span>Гэр бүл</span>
                <select
                  value={familyId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const nextFam = families.find((f) => f.id === nextId) ?? null;
                    setFamilyId(nextId);
                    setFamily(nextFam);
                    router.replace(`/activities?family=${encodeURIComponent(nextId)}`);
                  }}
                >
                  {families.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="button"
              onClick={() => {
                void reload();
                void reloadPublicFunds();
              }}
              disabled={busy || publicFundsLoading}
            >
              🔄 Шинэчлэх
            </button>
          </div>
        </header>

        {/* Section Switcher Tabs */}
        <nav aria-label="Сан ба уулзалтын хэсэг" className="activities-tabs">
          <button
            type="button"
            aria-pressed={section === 'fund'}
            onClick={() => setSection('fund')}
            className={`activities-tab ${section === 'fund' ? 'is-active' : ''}`}
          >
            🏛️ Ургийн Сан ({funds.length})
          </button>
          <button
            type="button"
            aria-pressed={section === 'events'}
            onClick={() => setSection('events')}
            className={`activities-tab ${section === 'events' ? 'is-active' : ''}`}
          >
            🏕️ Уулзалт & Арга хэмжээ ({events.length})
          </button>
        </nav>

        {error && (
          <div className="error activities-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void reload()} className="activities-retry-btn">
              Дахин оролдох
            </button>
          </div>
        )}
        {notice && (
          <div className="success activities-alert" role="status">
            {notice}
          </div>
        )}

        {/* TAB 1: FAMILY FUNDS & DONATIONS */}
        {section === 'fund' && (
          <section>
            {owner && (
              <form onSubmit={(e) => void newFund(e)} className="activities-form-card">
                <h3 className="activities-form-title">+ Шинэ Ургийн Сан үүсгэх</h3>
                <div className="activities-form-grid">
                  <label className="activities-field-label">
                    Сангийн нэр *
                    <input
                      name="title"
                      required
                      maxLength={180}
                      placeholder="Жишээ: Ургийн наадам 2026 сан"
                      className="activities-field-input"
                    />
                  </label>
                  <label className="activities-field-label">
                    Харагдах хүрээ
                    <select
                      name="visibility"
                      value={fundVisibility}
                      onChange={(e) =>
                        setFundVisibility(e.target.value === 'public' ? 'public' : 'family')
                      }
                      className="activities-field-select"
                    >
                      <option value="family">Зөвхөн энэ гэр бүлийн гишүүдэд</option>
                      <option value="public">Нийтэд нээлттэй (Бүх нэвтэрсэн хэрэглэгчид)</option>
                    </select>
                  </label>
                </div>
                <label className="activities-field-label">
                  Зориулалт *
                  <textarea
                    name="purpose"
                    required
                    maxLength={4000}
                    rows={2}
                    placeholder="Сангийн зорилго, зарцуулалтын тайлбар…"
                    className="activities-field-textarea"
                  />
                </label>
                <label className="activities-field-label">
                  Дансны мэдээлэл / Гүйлгээний утгын заавар *
                  <textarea
                    name="instruction"
                    required
                    maxLength={4000}
                    rows={2}
                    placeholder="Жишээ: Хаан Банк 5000000000 (Нэр), Гүйлгээний утга: Өөрийн нэр, утас"
                    className="activities-field-textarea"
                  />
                </label>
                <div>
                  <button type="submit" className="button primary" disabled={busy}>
                    {busy ? 'Үүсгэж байна…' : '✨ Ургийн сан үүсгэх'}
                  </button>
                </div>
              </form>
            )}

            {!funds.length ? (
              <div className="activities-empty-box">
                Одоогоор ургийн сан бүртгэгдээгүй байна.
              </div>
            ) : (
              <div className="activities-grid">
                {funds.map((f) => {
                  const fundDonations = donations[f.id] ?? [];
                  const fundExpenses = expenses[f.id] ?? [];
                  const isEditingFund = editingFundId === f.id;

                  return (
                    <article key={f.id} className="activities-card">
                      <div className="activities-fund-head">
                        <span className={`activities-fund-badge ${f.is_active ? 'is-active' : ''}`}>
                          {f.visibility === 'public' ? '🌐 НИЙТЭД НЭЭЛТТЭЙ' : '🏠 ГЭР БҮЛИЙН САН'} ·{' '}
                          {f.is_active ? '🟢 ИДЭВХТЭЙ' : '⏸️ ТҮР ЗОГССОН'}
                        </span>
                        {owner && (
                          <div className="activities-head-actions">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setEditingFundId(isEditingFund ? null : f.id)}
                              className="activities-toggle-btn"
                            >
                              {isEditingFund ? 'Болих' : '✏️ Засах'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    api(`${root(familyId)}/funds/${f.id}/status?is_active=${!f.is_active}`, {
                                      method: 'PATCH',
                                    }),
                                  'Сангийн төлөв шинэчлэгдлээ.',
                                )
                              }
                              className="activities-toggle-btn"
                            >
                              {f.is_active ? 'Түр зогсоох' : 'Идэвхжүүлэх'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setConfirmState({
                                  title: 'Ургийн санг устгах уу?',
                                  message: `«${f.title}» санг устгах гэж байна. Хандив эсвэл зарцуулалтын бүртгэл орсон санг устгах боломжгүй (түр зогсоож болно).`,
                                  confirmLabel: 'Устгах',
                                  onConfirm: () =>
                                    run(
                                      () =>
                                        api(`${root(familyId)}/funds/${f.id}`, {
                                          method: 'DELETE',
                                        }),
                                      'Ургийн сан устгагдлаа.',
                                    ),
                                })
                              }
                              className="activities-btn-danger-ghost"
                            >
                              Устгах
                            </button>
                          </div>
                        )}
                      </div>

                      {owner && isEditingFund ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const d = new FormData(e.currentTarget);
                            void run(
                              async () => {
                                await api(`${root(familyId)}/funds/${f.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({
                                    title: d.get('title'),
                                    purpose: d.get('purpose'),
                                    payment_instruction: d.get('instruction'),
                                    visibility: d.get('visibility') === 'public' ? 'public' : 'family',
                                  }),
                                });
                                setEditingFundId(null);
                              },
                              'Ургийн сангийн мэдээлэл шинэчлэгдлээ.',
                            );
                          }}
                          className="activities-edit-panel"
                        >
                          <label className="activities-field-label">
                            Сангийн нэр *
                            <input
                              name="title"
                              required
                              maxLength={180}
                              defaultValue={f.title}
                              className="activities-field-input"
                            />
                          </label>
                          <label className="activities-field-label">
                            Харагдах хүрээ
                            <select
                              name="visibility"
                              defaultValue={f.visibility}
                              className="activities-field-select"
                            >
                              <option value="family">Зөвхөн энэ гэр бүлийн гишүүдэд</option>
                              <option value="public">Нийтэд нээлттэй</option>
                            </select>
                          </label>
                          <label className="activities-field-label">
                            Зориулалт *
                            <textarea
                              name="purpose"
                              required
                              maxLength={4000}
                              rows={2}
                              defaultValue={f.purpose}
                              className="activities-field-textarea"
                            />
                          </label>
                          <label className="activities-field-label">
                            Дансны мэдээлэл *
                            <textarea
                              name="instruction"
                              required
                              maxLength={4000}
                              rows={2}
                              defaultValue={f.payment_instruction}
                              className="activities-field-textarea"
                            />
                          </label>
                          <div className="activities-edit-actions">
                            <button type="submit" className="button primary" disabled={busy}>
                              Хадгалах
                            </button>
                            <button
                              type="button"
                              className="button"
                              disabled={busy}
                              onClick={() => setEditingFundId(null)}
                            >
                              Болих
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div>
                          <h3 className="activities-card-title">{f.title}</h3>
                          <p className="activities-card-desc activities-card-desc--compact">
                            {f.purpose}
                          </p>
                        </div>
                      )}

                      <div className="activities-balance-grid">
                        <div className="activities-balance-tile activities-balance-tile--income">
                          <span className="activities-balance-label">Баталгаажсан орлого</span>
                          <strong className="activities-balance-value">
                            {money(f.confirmed_income_minor, f.currency)}
                          </strong>
                        </div>
                        <div className="activities-balance-tile activities-balance-tile--expense">
                          <span className="activities-balance-label">Нийт зарцуулалт</span>
                          <strong className="activities-balance-value">
                            {money(f.total_expenses_minor, f.currency)}
                          </strong>
                        </div>
                        <div
                          className={`activities-balance-tile ${
                            f.net_balance_minor < 0
                              ? 'activities-balance-tile--danger'
                              : 'activities-balance-tile--income'
                          }`}
                        >
                          <span className="activities-balance-label">Цэвэр үлдэгдэл</span>
                          <strong className="activities-balance-value">
                            {money(f.net_balance_minor, f.currency)}
                          </strong>
                        </div>
                      </div>

                      <div className="activities-payment-box">
                        <small className="activities-payment-label">
                          ДАНС & ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ
                        </small>
                        <p className="activities-payment-text">{f.payment_instruction}</p>
                      </div>

                      {f.is_active && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = e.currentTarget;
                            const d = new FormData(form);
                            void run(
                              () =>
                                api(`${root(familyId)}/funds/${f.id}/donations`, {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    amount_minor: Number(d.get('amount')) * 100,
                                    private_donor: d.get('private') === 'on',
                                  }),
                                }),
                              'Хандивын бүртгэл үүслээ. Шилжүүлснийхээ дараа "Шилжүүлсэн гэж мэдэгдэх" дарна уу.',
                            );
                            form.reset();
                          }}
                          className="activities-subform"
                        >
                          <input
                            name="amount"
                            type="number"
                            min="1"
                            required
                            placeholder="Хандивын дүн (₮)"
                            className="activities-subform-input"
                          />
                          <label className="activities-subform-checkbox">
                            <input name="private" type="checkbox" /> Нэрээ нууцлах
                          </label>
                          <button type="submit" className="button primary activities-subform-btn" disabled={busy}>
                            Хандив бүртгэх
                          </button>
                        </form>
                      )}

                      <div className="activities-list-section">
                        <h4 className="activities-list-heading">
                          Хандивын ил тод бүртгэл ({fundDonations.length})
                        </h4>
                        {fundDonations.length === 0 ? (
                          <small className="activities-list-empty">
                            Одоогоор баталгаажсан хандив бүртгэгдээгүй байна.
                          </small>
                        ) : (
                          <div className="activities-list-stack">
                            {fundDonations.map((d) => (
                              <div key={d.id} className="activities-ledger-row">
                                <span>
                                  <strong>{d.private_donor ? 'Нууц хандивлагч' : d.donor_name ?? 'Гишүүн'}</strong>{' '}
                                  · {money(d.amount_minor, d.currency)} ·{' '}
                                  <em className={`activities-ledger-status ${d.status === 'confirmed' ? 'is-confirmed' : ''}`}>
                                    {statusLabel(d.status)}
                                  </em>
                                </span>
                                <div className="activities-ledger-actions">
                                  {d.status === 'pledged' && (d.is_mine ?? true) && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void run(
                                          () =>
                                            api(`${root(familyId)}/funds/${f.id}/donations/${d.id}/report`, {
                                              method: 'POST',
                                            }),
                                          'Шилжүүлгийг мэдэгдлээ.',
                                        )
                                      }
                                      className="activities-btn-report"
                                    >
                                      Шилжүүлсэн гэж мэдэгдэх
                                    </button>
                                  )}
                                  {owner && d.status === 'reported' && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void run(
                                          () =>
                                            api(`${root(familyId)}/funds/${f.id}/donations/${d.id}/confirm`, {
                                              method: 'POST',
                                            }),
                                          'Хандив баталгаажлаа.',
                                        )
                                      }
                                      className="activities-btn-confirm"
                                    >
                                      ✓ Батлах
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="activities-list-section">
                        <h4 className="activities-list-heading">
                          Зарцуулалтын бүртгэл ({fundExpenses.length})
                        </h4>
                        {fundExpenses.length === 0 ? (
                          <small className="activities-list-empty">
                            Одоогоор зарцуулалт бүртгэгдээгүй байна.
                          </small>
                        ) : (
                          <div className="activities-list-stack">
                            {fundExpenses.map((ex) => (
                              <div key={ex.id} className="activities-ledger-row">
                                <div className="activities-expense-row-main">
                                  <span>
                                    <strong>{ex.title}</strong> · {money(ex.amount_minor, ex.currency)}
                                  </span>
                                  <span className="activities-expense-meta">
                                    {new Date(ex.spent_at).toLocaleDateString('mn-MN')}
                                    {ex.note ? ` · ${ex.note}` : ''}
                                    {ex.recorded_by_name ? ` · Бүртгэсэн: ${ex.recorded_by_name}` : ''}
                                  </span>
                                </div>
                                {owner && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      setConfirmState({
                                        title: 'Зарцуулалтын бичлэгийг устгах уу?',
                                        message: `«${ex.title}» (${money(ex.amount_minor, ex.currency)}) зарцуулалтыг устгах уу?`,
                                        confirmLabel: 'Устгах',
                                        onConfirm: () =>
                                          run(
                                            () =>
                                              api(`${root(familyId)}/funds/${f.id}/expenses/${ex.id}`, {
                                                method: 'DELETE',
                                              }),
                                            'Зарцуулалт устгагдлаа.',
                                          ),
                                      })
                                    }
                                    className="activities-btn-danger-ghost"
                                  >
                                    Устгах
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {owner && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const d = new FormData(form);
                              void run(
                                () =>
                                  api(`${root(familyId)}/funds/${f.id}/expenses`, {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      title: d.get('title'),
                                      amount_minor: Number(d.get('amount')) * 100,
                                      note: d.get('note') || '',
                                    }),
                                  }),
                                'Зарцуулалт бүртгэгдлээ.',
                              );
                              form.reset();
                            }}
                            className="activities-subform activities-subform--expense"
                          >
                            <input
                              name="title"
                              required
                              maxLength={180}
                              placeholder="Зардлын зориулалт *"
                              className="activities-subform-input"
                            />
                            <input
                              name="amount"
                              type="number"
                              min="1"
                              required
                              placeholder="Дүн (₮)"
                              className="activities-subform-input"
                            />
                            <input
                              name="note"
                              maxLength={4000}
                              placeholder="Тайлбар (заавал биш)"
                              className="activities-subform-input"
                            />
                            <button
                              type="submit"
                              className="button activities-subform-btn"
                              disabled={busy}
                            >
                              + Зардал нэмэх
                            </button>
                          </form>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <PublicFundsSection
              rows={publicFunds.filter((fund) => fund.family_id !== familyId)}
              loading={publicFundsLoading}
              error={publicFundsError}
              onRetry={() => void reloadPublicFunds()}
            />
          </section>
        )}

        {/* TAB 2: FAMILY GATHERINGS & EVENTS RSVP */}
        {section === 'events' && (
          <section>
            {manage && (
              <form onSubmit={(e) => void newEvent(e)} className="activities-form-card">
                <h3 className="activities-form-title">+ Ургийн уулзалт, арга хэмжээ зарлах</h3>
                <div className="activities-form-grid activities-form-grid--events">
                  <label className="activities-field-label">
                    Арга хэмжээний нэр *
                    <input
                      name="title"
                      required
                      maxLength={180}
                      placeholder="Жишээ: Гуулингийнхны ургийн баяр 2026"
                      className="activities-field-input"
                    />
                  </label>
                  <label className="activities-field-label">
                    Байршил / Газар *
                    <input
                      name="location"
                      required
                      maxLength={300}
                      placeholder="Жишээ: Тэрэлж амралтын газар"
                      className="activities-field-input"
                    />
                  </label>
                  <label className="activities-field-label">
                    Эхлэх өдөр, цаг *
                    <input
                      name="starts_at"
                      type="datetime-local"
                      required
                      defaultValue={localDate(30)}
                      className="activities-field-input"
                    />
                  </label>
                </div>

                <label className="activities-field-label">
                  Хөтөлбөр, дэлгэрэнгүй тайлбар
                  <textarea
                    name="description"
                    maxLength={12000}
                    rows={2}
                    placeholder="Уулзалтын хөтөлбөр, анхаарах зүйлс…"
                    className="activities-field-textarea"
                  />
                </label>

                <details className="activities-details">
                  <summary className="activities-details-summary">
                    ⚙️ Бүртгэлийн хугацаа, суудлын тоо болон хураамжийн тохиргоо (заавал биш)
                  </summary>
                  <div className="activities-form-grid activities-form-grid--compact">
                    <label>
                      Бүртгэл хаах хугацаа
                      <input
                        name="deadline"
                        type="datetime-local"
                        defaultValue={localDate(20)}
                        className="activities-field-input"
                      />
                    </label>
                    <label>
                      Нийт суудлын багтаамж
                      <input
                        name="capacity"
                        type="number"
                        min="1"
                        placeholder="Хязгааргүй"
                        className="activities-field-input"
                      />
                    </label>
                    <label>
                      Том хүний хураамж (₮)
                      <input
                        name="adult_fee"
                        type="number"
                        min="0"
                        defaultValue="0"
                        className="activities-field-input"
                      />
                    </label>
                    <label>
                      Хүүхдийн хураамж (₮)
                      <input
                        name="child_fee"
                        type="number"
                        min="0"
                        defaultValue="0"
                        className="activities-field-input"
                      />
                    </label>
                  </div>
                  <label className="activities-field-label activities-field-label--block">
                    Төлбөр шилжүүлэх дансны заавар
                    <textarea
                      name="instruction"
                      maxLength={4000}
                      rows={2}
                      className="activities-field-textarea"
                    />
                  </label>
                </details>

                <div>
                  <button type="submit" className="button primary" disabled={busy}>
                    {busy ? 'Үүсгэж байна…' : '🏕️ Уулзалт зарлах'}
                  </button>
                </div>
              </form>
            )}

            {!events.length ? (
              <div className="activities-empty-box">
                Одоогоор ургийн уулзалт зарлаагүй байна.
              </div>
            ) : (
              <div className="activities-grid">
                {events.map((event) => {
                  const own = mine[event.id];
                  const total =
                    (own?.adult_count ?? 0) * event.adult_fee_minor +
                    (own?.child_count ?? 0) * event.child_fee_minor;
                  const eventRegs = registrations[event.id] ?? [];
                  const isEditingEvent = editingEventId === event.id;

                  return (
                    <article key={event.id} className="activities-card">
                      <div className="activities-fund-head">
                        <span className="activities-event-date">
                          📅 {new Date(event.starts_at).toLocaleString('mn-MN')}
                        </span>
                        {manage && (
                          <div className="activities-head-actions">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setEditingEventId(isEditingEvent ? null : event.id)}
                              className="activities-toggle-btn"
                            >
                              {isEditingEvent ? 'Болих' : '✏️ Засах'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setConfirmState({
                                  title: 'Уулзалтыг устгах уу?',
                                  message: `«${event.title}» уулзалтыг устгах уу? Төлбөр мэдэгдсэн эсвэл баталгаажсан бүртгэлтэй уулзалтыг устгах боломжгүй.`,
                                  confirmLabel: 'Устгах',
                                  onConfirm: () =>
                                    run(
                                      () =>
                                        api(`${root(familyId)}/events/${event.id}`, {
                                          method: 'DELETE',
                                        }),
                                      'Уулзалт устгагдлаа.',
                                    ),
                                })
                              }
                              className="activities-btn-danger-ghost"
                            >
                              Устгах
                            </button>
                          </div>
                        )}
                      </div>

                      {manage && isEditingEvent ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const d = new FormData(e.currentTarget);
                            const rawDeadline = String(d.get('deadline') ?? '').trim();
                            const rawCapacity = String(d.get('capacity') ?? '').trim();
                            void run(
                              async () => {
                                await api(`${root(familyId)}/events/${event.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({
                                    title: d.get('title'),
                                    description: d.get('description') ?? '',
                                    location: d.get('location'),
                                    starts_at: new Date(String(d.get('starts_at'))).toISOString(),
                                    registration_deadline: rawDeadline
                                      ? new Date(rawDeadline).toISOString()
                                      : null,
                                    capacity: rawCapacity ? Number(rawCapacity) : null,
                                    adult_fee_minor: Number(d.get('adult_fee') || 0) * 100,
                                    child_fee_minor: Number(d.get('child_fee') || 0) * 100,
                                    payment_instruction: d.get('instruction') || '',
                                  }),
                                });
                                setEditingEventId(null);
                              },
                              'Уулзалтын мэдээлэл шинэчлэгдлээ.',
                            );
                          }}
                          className="activities-edit-panel"
                        >
                          <label className="activities-field-label">
                            Арга хэмжээний нэр *
                            <input
                              name="title"
                              required
                              maxLength={180}
                              defaultValue={event.title}
                              className="activities-field-input"
                            />
                          </label>
                          <label className="activities-field-label">
                            Байршил / Газар *
                            <input
                              name="location"
                              required
                              maxLength={300}
                              defaultValue={event.location}
                              className="activities-field-input"
                            />
                          </label>
                          <div className="activities-form-grid activities-form-grid--compact">
                            <label className="activities-field-label">
                              Эхлэх өдөр, цаг *
                              <input
                                name="starts_at"
                                type="datetime-local"
                                required
                                defaultValue={toLocalInputValue(event.starts_at)}
                                className="activities-field-input"
                              />
                            </label>
                            <label className="activities-field-label">
                              Бүртгэл хаах хугацаа
                              <input
                                name="deadline"
                                type="datetime-local"
                                defaultValue={toLocalInputValue(event.registration_deadline)}
                                className="activities-field-input"
                              />
                            </label>
                            <label className="activities-field-label">
                              Суудлын багтаамж
                              <input
                                name="capacity"
                                type="number"
                                min="1"
                                placeholder="Хязгааргүй"
                                defaultValue={event.capacity ?? ''}
                                className="activities-field-input"
                              />
                            </label>
                            <label className="activities-field-label">
                              Том хүн (₮)
                              <input
                                name="adult_fee"
                                type="number"
                                min="0"
                                defaultValue={Math.round(event.adult_fee_minor / 100)}
                                className="activities-field-input"
                              />
                            </label>
                            <label className="activities-field-label">
                              Хүүхэд (₮)
                              <input
                                name="child_fee"
                                type="number"
                                min="0"
                                defaultValue={Math.round(event.child_fee_minor / 100)}
                                className="activities-field-input"
                              />
                            </label>
                          </div>
                          <label className="activities-field-label">
                            Хөтөлбөр, тайлбар
                            <textarea
                              name="description"
                              maxLength={12000}
                              rows={2}
                              defaultValue={event.description}
                              className="activities-field-textarea"
                            />
                          </label>
                          <label className="activities-field-label">
                            Төлбөрийн заавар
                            <textarea
                              name="instruction"
                              maxLength={4000}
                              rows={2}
                              defaultValue={event.payment_instruction}
                              className="activities-field-textarea"
                            />
                          </label>
                          <div className="activities-edit-actions">
                            <button type="submit" className="button primary" disabled={busy}>
                              Хадгалах
                            </button>
                            <button
                              type="button"
                              className="button"
                              disabled={busy}
                              onClick={() => setEditingEventId(null)}
                            >
                              Болих
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <h3 className="activities-card-title activities-card-desc--compact">
                            {event.title}
                          </h3>
                          {event.description && (
                            <p className="activities-card-desc activities-card-desc--compact">
                              {event.description}
                            </p>
                          )}
                          <p className="activities-event-location">
                            <strong>📍 Байршил:</strong> {event.location}
                            {event.capacity ? ` · ${event.capacity} суудал` : ''}
                          </p>
                        </>
                      )}

                      {(event.adult_fee_minor || event.child_fee_minor) > 0 && (
                        <p className="activities-event-fee">
                          <strong>Хураамж:</strong> Том хүн{' '}
                          {money(event.adult_fee_minor, event.currency)}, Хүүхэд{' '}
                          {money(event.child_fee_minor, event.currency)}
                        </p>
                      )}

                      {event.payment_instruction && (
                        <div className="activities-payment-box">
                          <small className="activities-payment-label">
                            ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ
                          </small>
                          <p className="activities-payment-text">{event.payment_instruction}</p>
                        </div>
                      )}

                      {(!own || own.status === 'cancelled') && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const d = new FormData(e.currentTarget);
                            void run(
                              () =>
                                api(`${root(familyId)}/events/${event.id}/registrations`, {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    adult_count: Number(d.get('adults')),
                                    child_count: Number(d.get('children')),
                                  }),
                                }),
                              'Уулзалтад оролцохоор амжилттай бүртгүүллээ!',
                            );
                          }}
                          className="activities-subform activities-subform--rsvp"
                        >
                          <label className="activities-field-label">
                            Том хүн
                            <input
                              name="adults"
                              type="number"
                              min="0"
                              defaultValue="1"
                              className="activities-num-input"
                            />
                          </label>
                          <label className="activities-field-label">
                            Хүүхэд
                            <input
                              name="children"
                              type="number"
                              min="0"
                              defaultValue="0"
                              className="activities-num-input"
                            />
                          </label>
                          <button type="submit" className="button primary" disabled={busy}>
                            🙋 Оролцохоор бүртгүүлэх (RSVP)
                          </button>
                        </form>
                      )}

                      {own && own.status === 'registered' && (
                        <div className="activities-rsvp-confirmed">
                          <strong>✅ Таны ирцийн бүртгэл:</strong> {own.adult_count} том хүн,{' '}
                          {own.child_count} хүүхэд
                          {total > 0 && (
                            <p className="activities-rsvp-fee">
                              Нийт хураамж: <strong>{money(total, event.currency)}</strong> ·{' '}
                              {statusLabel(own.payment_status)}
                            </p>
                          )}
                          <div className="activities-rsvp-actions">
                            {total > 0 && own.payment_status === 'unpaid' && (
                              <button
                                type="button"
                                className="button primary"
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    () =>
                                      api(
                                        `${root(familyId)}/events/${event.id}/registrations/me/report-payment`,
                                        { method: 'POST' },
                                      ),
                                    'Хураамж шилжүүлснийг мэдэгдлээ.',
                                  )
                                }
                              >
                                Төлбөр шилжүүлсэн
                              </button>
                            )}
                            <button
                              type="button"
                              className="button"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    api(
                                      `${root(familyId)}/events/${event.id}/registrations/me/cancel`,
                                      { method: 'POST' },
                                    ),
                                  'Бүртгэл цуцлагдлаа.',
                                )
                              }
                            >
                              Бүртгэл цуцлах
                            </button>
                          </div>
                        </div>
                      )}

                      {manage && eventRegs.length > 0 && (
                        <div className="activities-list-section">
                          <h4 className="activities-list-heading">
                            Бүртгүүлсэн оролцогчид ({eventRegs.length})
                          </h4>
                          <div className="activities-list-stack">
                            {eventRegs.map((r) => (
                              <div key={r.id} className="activities-ledger-row">
                                <span>
                                  {r.adult_count} том хүн · {r.child_count} хүүхэд ·{' '}
                                  {statusLabel(r.payment_status)}
                                </span>
                                {r.payment_status === 'reported' && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(
                                        () =>
                                          api(
                                            `${root(familyId)}/events/${event.id}/registrations/${r.id}/confirm-payment`,
                                            { method: 'POST' },
                                          ),
                                        'Төлбөр баталгаажлаа.',
                                      )
                                    }
                                    className="activities-btn-confirm"
                                  >
                                    ✓ Батлах
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </section>

      <ConfirmDialog
        isOpen={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel={confirmState?.confirmLabel ?? 'Устгах'}
        cancelLabel="Болих"
        variant="danger"
        busy={busy}
        onConfirm={() => {
          if (!confirmState) return;
          void confirmState.onConfirm().finally(() => setConfirmState(null));
        }}
        onCancel={() => {
          if (!busy) setConfirmState(null);
        }}
      />
    </main>
  );
}

export default function ActivitiesPage() {
  return (
    <Suspense
      fallback={
        <main className="people-page">
          <section className="people-shell">
            <p role="status">Ургийн сан болон уулзалтын хуудсыг ачаалж байна…</p>
          </section>
        </main>
      }
    >
      <ActivitiesContent />
    </Suspense>
  );
}
