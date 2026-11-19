'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Family } from '../../lib/api';

type Fund = {
  id: string;
  family_id: string;
  title: string;
  purpose: string;
  currency: string;
  payment_instruction: string;
  visibility: 'family' | 'public';
  is_active: boolean;
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
      style={{
        marginTop: '28px',
        padding: '22px',
        borderRadius: '18px',
        background: 'var(--parchment-card, #fffdf9)',
        border: '1.5px solid var(--parchment-border, #e2d9c8)',
      }}
      aria-labelledby="public-funds-heading"
    >
      <div style={{ marginBottom: '16px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', letterSpacing: '0.06em' }}>
          ГУУЛИНГИЙНХНЫ ӨВИЙН САН
        </span>
        <h2 id="public-funds-heading" style={{ margin: '4px 0', font: '700 20px Georgia, serif', color: '#17372b' }}>
          Нийтийн нээлттэй сангууд
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: '#57685e' }}>
          Зөвхөн нийтэд ил тод хуваалцахаар сонгосон идэвхтэй гэр бүлийн сангууд.
        </p>
      </div>

      {error && (
        <div className="error" role="alert" style={{ marginBottom: '12px' }}>
          <span>{error}</span>
          <button type="button" onClick={onRetry} style={{ marginLeft: '10px' }}>
            Дахин оролдох
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: '13px', color: '#64748b' }} role="status">
          Нийтийн санг ачаалж байна…
        </p>
      ) : !rows.length ? (
        <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
          Одоогоор нийтэд хуваалцсан сан бүртгэгдээгүй байна.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '14px',
          }}
        >
          {rows.map((fund) => (
            <article
              key={fund.id}
              style={{
                padding: '16px 18px',
                borderRadius: '14px',
                background: '#fcfaf5',
                border: '1px solid #e2d9c8',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#b45309', marginBottom: '6px' }}>
                <span>🌐 НИЙТЭД НЭЭЛТТЭЙ</span>
                <span>{fund.family_name}</span>
              </div>
              <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: '#17372b' }}>{fund.title}</h3>
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>
                {fund.purpose}
              </p>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                }}
              >
                <small style={{ fontSize: '10.5px', fontWeight: 700, color: '#92400e' }}>
                  ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ
                </small>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#78350f', whiteSpace: 'pre-wrap' }}>
                  {fund.payment_instruction}
                </p>
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
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, Registration[]>>({});
  const [mine, setMine] = useState<Record<string, Registration | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fundVisibility, setFundVisibility] = useState<'family' | 'public'>('family');
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

      const ds = await Promise.all(
        fundRows.map(
          async (f) =>
            [f.id, await api<Donation[]>(`${root(familyId)}/funds/${f.id}/donations`)] as const,
        ),
      );
      setDonations(Object.fromEntries(ds));

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
          <header style={{ marginBottom: '20px' }}>
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
        <nav
          aria-label="Сан ба уулзалтын хэсэг"
          style={{
            display: 'flex',
            gap: '10px',
            marginBottom: '20px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            aria-pressed={section === 'fund'}
            onClick={() => setSection('fund')}
            style={{
              padding: '10px 20px',
              borderRadius: '12px',
              border: section === 'fund' ? '2px solid #d97706' : '1.5px solid #e2d9c8',
              background: section === 'fund' ? 'rgba(217, 119, 6, 0.12)' : '#ffffff',
              color: section === 'fund' ? '#b45309' : '#17372b',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            🏛️ Ургийн Сан ({funds.length})
          </button>
          <button
            type="button"
            aria-pressed={section === 'events'}
            onClick={() => setSection('events')}
            style={{
              padding: '10px 20px',
              borderRadius: '12px',
              border: section === 'events' ? '2px solid #d97706' : '1.5px solid #e2d9c8',
              background: section === 'events' ? 'rgba(217, 119, 6, 0.12)' : '#ffffff',
              color: section === 'events' ? '#b45309' : '#17372b',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            🏕️ Уулзалт & Арга хэмжээ ({events.length})
          </button>
        </nav>

        {error && (
          <div className="error" role="alert" style={{ marginBottom: '16px' }}>
            <span>{error}</span>
            <button type="button" onClick={() => void reload()} style={{ marginLeft: '12px' }}>
              Дахин оролдох
            </button>
          </div>
        )}
        {notice && (
          <div className="success" role="status" style={{ marginBottom: '16px' }}>
            {notice}
          </div>
        )}

        {/* TAB 1: FAMILY FUNDS & DONATIONS */}
        {section === 'fund' && (
          <section>
            {owner && (
              <form
                onSubmit={(e) => void newFund(e)}
                style={{
                  padding: '20px',
                  marginBottom: '24px',
                  borderRadius: '16px',
                  background: 'var(--parchment-card, #fffdf9)',
                  border: '1.5px solid var(--parchment-border, #e2d9c8)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <h3 style={{ margin: 0, font: '700 18px Georgia, serif', color: '#17372b' }}>
                  + Шинэ Ургийн Сан үүсгэх
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600 }}>
                    Сангийн нэр *
                    <input
                      name="title"
                      required
                      maxLength={180}
                      placeholder="Жишээ: Ургийн наадам 2026 сан"
                      style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                    />
                  </label>
                  <label style={{ fontSize: '12.5px', fontWeight: 600 }}>
                    Харагдах хүрээ
                    <select
                      name="visibility"
                      value={fundVisibility}
                      onChange={(e) =>
                        setFundVisibility(e.target.value === 'public' ? 'public' : 'family')
                      }
                      style={{ width: '100%', marginTop: '4px', height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                    >
                      <option value="family">Зөвхөн энэ гэр бүлийн гишүүдэд</option>
                      <option value="public">Нийтэд нээлттэй (Бүх нэвтэрсэн хэрэглэгчид)</option>
                    </select>
                  </label>
                </div>
                <label style={{ fontSize: '12.5px', fontWeight: 600 }}>
                  Зориулалт *
                  <textarea
                    name="purpose"
                    required
                    maxLength={4000}
                    rows={2}
                    placeholder="Сангийн зорилго, зарцуулалтын тайлбар…"
                    style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                  />
                </label>
                <label style={{ fontSize: '12.5px', fontWeight: 600 }}>
                  Дансны мэдээлэл / Гүйлгээний утгын заавар *
                  <textarea
                    name="instruction"
                    required
                    maxLength={4000}
                    rows={2}
                    placeholder="Жишээ: Хаан Банк 5000000000 (Нэр), Гүйлгээний утга: Өөрийн нэр, утас"
                    style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
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
              <div
                style={{
                  padding: '32px',
                  textAlign: 'center',
                  borderRadius: '16px',
                  background: '#fcfaf5',
                  border: '1px dashed #d6cbb5',
                  color: '#64748b',
                }}
              >
                Одоогоор ургийн сан бүртгэгдээгүй байна.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                  gap: '18px',
                }}
              >
                {funds.map((f) => {
                  const fundDonations = donations[f.id] ?? [];
                  const confirmedSumMinor = fundDonations
                    .filter((d) => d.status === 'confirmed')
                    .reduce((acc, d) => acc + d.amount_minor, 0);

                  return (
                    <article
                      key={f.id}
                      style={{
                        padding: '20px',
                        borderRadius: '16px',
                        background: 'var(--parchment-card, #fffdf9)',
                        border: '1.5px solid var(--parchment-border, #e2d9c8)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: f.is_active ? '#15803d' : '#64748b' }}>
                          {f.visibility === 'public' ? '🌐 НИЙТЭД НЭЭЛТТЭЙ' : '🏠 ГЭР БҮЛИЙН САН'} ·{' '}
                          {f.is_active ? '🟢 ИДЭВХТЭЙ' : '⏸️ ТҮР ЗОГССОН'}
                        </span>
                        {owner && (
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
                            style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
                          >
                            {f.is_active ? 'Түр зогсоох' : 'Идэвхжүүлэх'}
                          </button>
                        )}
                      </div>

                      <div>
                        <h3 style={{ margin: '0 0 6px', font: '700 19px Georgia, serif', color: '#17372b' }}>
                          {f.title}
                        </h3>
                        <p style={{ margin: 0, fontSize: '13.5px', color: '#334155', lineHeight: 1.55 }}>
                          {f.purpose}
                        </p>
                      </div>

                      <div
                        style={{
                          padding: '12px 14px',
                          borderRadius: '12px',
                          background: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#065f46' }}>
                          Баталгаажсан хуримтлал:
                        </span>
                        <strong style={{ fontSize: '17px', color: '#047857' }}>
                          {money(confirmedSumMinor, f.currency)}
                        </strong>
                      </div>

                      <div
                        style={{
                          padding: '12px 14px',
                          borderRadius: '12px',
                          background: '#fffbeb',
                          border: '1px solid #fde68a',
                        }}
                      >
                        <small style={{ fontSize: '10.5px', fontWeight: 700, color: '#92400e' }}>
                          ДАНС & ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ
                        </small>
                        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#78350f', whiteSpace: 'pre-wrap' }}>
                          {f.payment_instruction}
                        </p>
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
                              'Хандивын бүртгэл үүслээ. Шилжүүлснийхээ дараа "Төлбөр мэдэгдэх" дарна уу.',
                            );
                            form.reset();
                          }}
                          style={{
                            padding: '12px',
                            borderRadius: '12px',
                            background: '#fcfaf5',
                            border: '1px solid #e2d9c8',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '10px',
                            alignItems: 'center',
                          }}
                        >
                          <input
                            name="amount"
                            type="number"
                            min="1"
                            required
                            placeholder="Хандивын дүн (₮)"
                            style={{ flex: 1, minWidth: '140px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                          />
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                            <input name="private" type="checkbox" /> Нэрээ нууцлах
                          </label>
                          <button type="submit" className="button primary" disabled={busy} style={{ fontSize: '12.5px', padding: '7px 14px' }}>
                            Хандив бүртгэх
                          </button>
                        </form>
                      )}

                      <div style={{ borderTop: '1px solid #e2d9c8', paddingTop: '10px' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: '12.5px', color: '#475569' }}>
                          Хандивын бүртгэл ({fundDonations.length})
                        </h4>
                        {fundDonations.length === 0 ? (
                          <small style={{ color: '#94a3b8' }}>Одоогоор хандив бүртгэгдээгүй байна.</small>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {fundDonations.map((d) => (
                              <div
                                key={d.id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '8px 10px',
                                  borderRadius: '8px',
                                  background: '#fcfaf5',
                                  fontSize: '12.5px',
                                }}
                              >
                                <span>
                                  <strong>{d.private_donor ? 'Нууц хандивлагч' : d.donor_name ?? 'Гишүүн'}</strong>{' '}
                                  · {money(d.amount_minor, d.currency)} ·{' '}
                                  <em style={{ fontStyle: 'normal', color: d.status === 'confirmed' ? '#15803d' : '#b45309' }}>
                                    {statusLabel(d.status)}
                                  </em>
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  {d.status === 'pledged' && (
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
                                      style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #d97706', background: '#fffbeb', color: '#92400e', fontWeight: 700, cursor: 'pointer' }}
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
                                      style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', border: 'none', background: '#16a34a', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}
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
              <form
                onSubmit={(e) => void newEvent(e)}
                style={{
                  padding: '20px',
                  marginBottom: '24px',
                  borderRadius: '16px',
                  background: 'var(--parchment-card, #fffdf9)',
                  border: '1.5px solid var(--parchment-border, #e2d9c8)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <h3 style={{ margin: 0, font: '700 18px Georgia, serif', color: '#17372b' }}>
                  + Ургийн уулзалт, арга хэмжээ зарлах
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600 }}>
                    Арга хэмжээний нэр *
                    <input
                      name="title"
                      required
                      maxLength={180}
                      placeholder="Жишээ: Гуулингийнхны ургийн баяр 2026"
                      style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                    />
                  </label>
                  <label style={{ fontSize: '12.5px', fontWeight: 600 }}>
                    Байршил / Газар *
                    <input
                      name="location"
                      required
                      maxLength={300}
                      placeholder="Жишээ: Тэрэлж амралтын газар"
                      style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                    />
                  </label>
                  <label style={{ fontSize: '12.5px', fontWeight: 600 }}>
                    Эхлэх өдөр, цаг *
                    <input
                      name="starts_at"
                      type="datetime-local"
                      required
                      defaultValue={localDate(30)}
                      style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                    />
                  </label>
                </div>

                <label style={{ fontSize: '12.5px', fontWeight: 600 }}>
                  Хөтөлбөр, дэлгэрэнгүй тайлбар
                  <textarea
                    name="description"
                    maxLength={12000}
                    rows={2}
                    placeholder="Уулзалтын хөтөлбөр, анхаарах зүйлс…"
                    style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                  />
                </label>

                <details style={{ fontSize: '12.5px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#b45309' }}>
                    ⚙️ Бүртгэлийн хугацаа, суудлын тоо болон хураамжийн тохиргоо (заавал биш)
                  </summary>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '12px',
                      marginTop: '10px',
                    }}
                  >
                    <label>
                      Бүртгэл хаах хугацаа
                      <input
                        name="deadline"
                        type="datetime-local"
                        defaultValue={localDate(20)}
                        style={{ width: '100%', marginTop: '4px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                      />
                    </label>
                    <label>
                      Нийт суудлын багтаамж
                      <input
                        name="capacity"
                        type="number"
                        min="1"
                        placeholder="Хязгааргүй"
                        style={{ width: '100%', marginTop: '4px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                      />
                    </label>
                    <label>
                      Том хүний хураамж (₮)
                      <input
                        name="adult_fee"
                        type="number"
                        min="0"
                        defaultValue="0"
                        style={{ width: '100%', marginTop: '4px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                      />
                    </label>
                    <label>
                      Хүүхдийн хураамж (₮)
                      <input
                        name="child_fee"
                        type="number"
                        min="0"
                        defaultValue="0"
                        style={{ width: '100%', marginTop: '4px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
                      />
                    </label>
                  </div>
                  <label style={{ display: 'block', marginTop: '10px' }}>
                    Төлбөр шилжүүлэх дансны заавар
                    <textarea
                      name="instruction"
                      maxLength={4000}
                      rows={2}
                      style={{ width: '100%', marginTop: '4px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #d6cbb5' }}
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
              <div
                style={{
                  padding: '32px',
                  textAlign: 'center',
                  borderRadius: '16px',
                  background: '#fcfaf5',
                  border: '1px dashed #d6cbb5',
                  color: '#64748b',
                }}
              >
                Одоогоор ургийн уулзалт зарлаагүй байна.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                  gap: '18px',
                }}
              >
                {events.map((event) => {
                  const own = mine[event.id];
                  const total =
                    (own?.adult_count ?? 0) * event.adult_fee_minor +
                    (own?.child_count ?? 0) * event.child_fee_minor;
                  const eventRegs = registrations[event.id] ?? [];

                  return (
                    <article
                      key={event.id}
                      style={{
                        padding: '20px',
                        borderRadius: '16px',
                        background: 'var(--parchment-card, #fffdf9)',
                        border: '1.5px solid var(--parchment-border, #e2d9c8)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#b45309' }}>
                        📅 {new Date(event.starts_at).toLocaleString('mn-MN')}
                      </span>
                      <h3 style={{ margin: 0, font: '700 19px Georgia, serif', color: '#17372b' }}>
                        {event.title}
                      </h3>
                      {event.description && (
                        <p style={{ margin: 0, fontSize: '13.5px', color: '#334155', lineHeight: 1.55 }}>
                          {event.description}
                        </p>
                      )}
                      <p style={{ margin: 0, fontSize: '13px', color: '#1e293b' }}>
                        <strong>📍 Байршил:</strong> {event.location}
                        {event.capacity ? ` · ${event.capacity} суудал` : ''}
                      </p>

                      {(event.adult_fee_minor || event.child_fee_minor) > 0 && (
                        <p style={{ margin: 0, fontSize: '12.5px', color: '#475569' }}>
                          <strong>Хураамж:</strong> Том хүн{' '}
                          {money(event.adult_fee_minor, event.currency)}, Хүүхэд{' '}
                          {money(event.child_fee_minor, event.currency)}
                        </p>
                      )}

                      {event.payment_instruction && (
                        <div
                          style={{
                            padding: '10px 12px',
                            borderRadius: '10px',
                            background: '#fffbeb',
                            border: '1px solid #fde68a',
                          }}
                        >
                          <small style={{ fontSize: '10.5px', fontWeight: 700, color: '#92400e' }}>
                            ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ
                          </small>
                          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#78350f', whiteSpace: 'pre-wrap' }}>
                            {event.payment_instruction}
                          </p>
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
                          style={{
                            padding: '12px',
                            borderRadius: '12px',
                            background: '#fcfaf5',
                            border: '1px solid #e2d9c8',
                            display: 'flex',
                            gap: '10px',
                            flexWrap: 'wrap',
                            alignItems: 'flex-end',
                          }}
                        >
                          <label style={{ fontSize: '12px', fontWeight: 600 }}>
                            Том хүн
                            <input
                              name="adults"
                              type="number"
                              min="0"
                              defaultValue="1"
                              style={{ width: '70px', display: 'block', marginTop: '4px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                          <label style={{ fontSize: '12px', fontWeight: 600 }}>
                            Хүүхэд
                            <input
                              name="children"
                              type="number"
                              min="0"
                              defaultValue="0"
                              style={{ width: '70px', display: 'block', marginTop: '4px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                            />
                          </label>
                          <button type="submit" className="button primary" disabled={busy}>
                            🙋 Оролцохоор бүртгүүлэх (RSVP)
                          </button>
                        </form>
                      )}

                      {own && own.status === 'registered' && (
                        <div
                          style={{
                            padding: '12px 14px',
                            borderRadius: '12px',
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            fontSize: '13px',
                            color: '#166534',
                          }}
                        >
                          <strong>✅ Таны ирцийн бүртгэл:</strong> {own.adult_count} том хүн,{' '}
                          {own.child_count} хүүхэд
                          {total > 0 && (
                            <p style={{ margin: '4px 0 8px' }}>
                              Нийт хураамж: <strong>{money(total, event.currency)}</strong> ·{' '}
                              {statusLabel(own.payment_status)}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
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
                        <div style={{ borderTop: '1px solid #e2d9c8', paddingTop: '10px' }}>
                          <h4 style={{ margin: '0 0 8px', fontSize: '12.5px', color: '#475569' }}>
                            Бүртгүүлсэн оролцогчид ({eventRegs.length})
                          </h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {eventRegs.map((r) => (
                              <div
                                key={r.id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '6px 10px',
                                  borderRadius: '8px',
                                  background: '#fcfaf5',
                                  fontSize: '12px',
                                }}
                              >
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
                                    style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', border: 'none', background: '#16a34a', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}
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
