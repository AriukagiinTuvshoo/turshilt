'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  GitFork,
  Link2,
  Plus,
  ShieldCheck,
  TreeDeciduous,
  Users,
  X,
} from 'lucide-react';
import {
  ApiError,
  ConnectHouseholdOut,
  Family,
  FamilyStats,
  Person,
  api,
} from '../../lib/api';
import { useFocusTrap } from '../../lib/use-focus-trap';

type ConnectRelation = 'child_of' | 'spouse_of' | 'same_person' | 'parent_of';

const ADMIN_ROLES = new Set(['owner', 'admin', 'editor']);

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй байна.';
    if (cause.status === 404) return 'Мэдээлэл олдсонгүй.';
    if (cause.status === 409) return 'Ургийн холбоос тойрог эсвэл зөрчил үүсгэж байна.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
  }
  return fallback;
}

function roleLabel(role: string, adminTitle?: string | null) {
  if (role === 'owner') return '👑 Ерөнхий админ';
  if (role === 'admin') return adminTitle ? `🛡️ ${adminTitle}` : '🛡️ Туслах админ';
  if (role === 'editor') return '✏️ Засварлагч';
  return '👤 Гишүүн';
}

function FamiliesContent() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [statsByFamily, setStatsByFamily] = useState<Record<string, FamilyStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectedTargetId, setConnectedTargetId] = useState<string | null>(null);

  // Connect Household Modal state
  const [connectHousehold, setConnectHousehold] = useState<Family | null>(null);
  const [targetClanId, setTargetClanId] = useState('');
  const [householdPeople, setHouseholdPeople] = useState<Person[]>([]);
  const [householdPersonId, setHouseholdPersonId] = useState('');
  const [targetPeople, setTargetPeople] = useState<Person[]>([]);
  const [targetAnchorId, setTargetAnchorId] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [relation, setRelation] = useState<ConnectRelation>('child_of');
  const [modalLoading, setModalLoading] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const modalRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(Boolean(connectHousehold), modalRef, {
    onEscape: () => setConnectHousehold(null),
  });

  const loadFamilies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await api<Family[]>('/families');
      setFamilies(list);
      const statPairs = await Promise.all(
        list.map(async (f) => {
          const st = await api<FamilyStats>(`/families/${f.id}/stats`).catch(() => null);
          return [f.id, st] as const;
        }),
      );
      const nextStats: Record<string, FamilyStats> = {};
      for (const [id, st] of statPairs) {
        if (st) nextStats[id] = st;
      }
      setStatsByFamily(nextStats);
    } catch (cause) {
      setError(friendlyError(cause, 'Гэр бүлийн жагсаалтыг ачаалж чадсангүй.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFamilies();
  }, [loadFamilies]);

  const { mainClans, households, linkedCounts, defaultAdminFamily } = useMemo(() => {
    const parentIds = new Set(
      families.map((f) => f.parent_family_id).filter((id): id is string => Boolean(id)),
    );
    const primary =
      families.find((f) => !f.parent_family_id && f.name.toLowerCase().includes('гуулин')) ??
      families.find((f) => !f.parent_family_id) ??
      families[0] ??
      null;

    const mains = primary
      ? families.filter(
          (f) => f.id === primary.id || (!f.parent_family_id && parentIds.has(f.id)),
        )
      : [];
    const mainIds = new Set(mains.map((m) => m.id));
    const branches = families.filter((f) => !mainIds.has(f.id));

    const counts: Record<string, number> = {};
    for (const f of families) {
      if (f.parent_family_id) {
        counts[f.parent_family_id] = (counts[f.parent_family_id] ?? 0) + 1;
      }
    }

    const adminFam = families.find((f) => ADMIN_ROLES.has(f.role)) ?? null;
    return {
      mainClans: mains,
      households: branches,
      linkedCounts: counts,
      defaultAdminFamily: adminFam,
    };
  }, [families]);

  const openConnectModal = useCallback(
    async (household: Family) => {
      const candidates = families.filter((f) => f.id !== household.id);
      const preferredTarget =
        (household.parent_family_id &&
          candidates.find((c) => c.id === household.parent_family_id)) ??
        candidates.find((c) => !c.parent_family_id && c.name.toLowerCase().includes('гуулин')) ??
        candidates.find((c) => !c.parent_family_id) ??
        candidates[0] ??
        null;

      if (!preferredTarget) {
        setError('Холбох боломжтой өөр ургийн мод олдсонгүй.');
        return;
      }

      setConnectHousehold(household);
      setTargetClanId(preferredTarget.id);
      setTargetSearch('');
      setRelation('child_of');
      setModalError('');
      setModalLoading(true);
      try {
        const [hhPeople, clanPeople] = await Promise.all([
          api<Person[]>(`/families/${household.id}/persons`),
          api<Person[]>(`/families/${preferredTarget.id}/persons`),
        ]);
        setHouseholdPeople(hhPeople);
        setHouseholdPersonId(hhPeople[0]?.id ?? '');
        setTargetPeople(clanPeople);
        setTargetAnchorId(clanPeople[0]?.id ?? '');
      } catch (cause) {
        setModalError(friendlyError(cause, 'Модны хүмүүсийг ачаалж чадсангүй.'));
      } finally {
        setModalLoading(false);
      }
    },
    [families],
  );

  const handleTargetClanChange = async (nextClanId: string) => {
    setTargetClanId(nextClanId);
    setModalError('');
    setModalLoading(true);
    try {
      const clanPeople = await api<Person[]>(`/families/${nextClanId}/persons`);
      setTargetPeople(clanPeople);
      setTargetAnchorId(clanPeople[0]?.id ?? '');
    } catch (cause) {
      setModalError(friendlyError(cause, 'Сонгосон модны хүмүүсийг ачаалж чадсангүй.'));
      setTargetPeople([]);
      setTargetAnchorId('');
    } finally {
      setModalLoading(false);
    }
  };

  const filteredTargetPeople = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    if (!q) return targetPeople;
    return targetPeople.filter(
      (p) =>
        p.first_name.toLowerCase().includes(q) ||
        p.last_name.toLowerCase().includes(q) ||
        (p.birth_date && p.birth_date.includes(q)),
    );
  }, [targetPeople, targetSearch]);

  const handleConnectSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!connectHousehold || !targetClanId || !householdPersonId || !targetAnchorId || connectBusy) {
      return;
    }
    setConnectBusy(true);
    setModalError('');
    try {
      const res = await api<ConnectHouseholdOut>(
        `/families/${connectHousehold.id}/connect-to-clan`,
        {
          method: 'POST',
          body: JSON.stringify({
            target_family_id: targetClanId,
            household_person_id: householdPersonId,
            target_anchor_person_id: targetAnchorId,
            relation,
          }),
        },
      );
      setConnectHousehold(null);
      setConnectedTargetId(res.target_family_id);
      setNotice(`🔗 ${res.summary}`);
      await loadFamilies();
    } catch (cause) {
      setModalError(friendlyError(cause, 'Их ургийн модтой холбох үед алдаа гарлаа.'));
    } finally {
      setConnectBusy(false);
    }
  };

  return (
    <div className="families-page clan-hub-page" aria-busy={loading}>
      <div className="families-shell">
        <header className="families-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <TreeDeciduous size={18} style={{ color: 'var(--ui-accent)' }} />
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: 'var(--ui-accent-text)',
                }}
              >
                ГУУЛИНГИЙНХАН · НЭГДСЭН УРГИЙН САН
              </span>
            </div>
            <h1>🌳 Ураг ба Миний өрх гэр бүл</h1>
            <p>
              Бүх гишүүд <strong>Гуулингийнхан</strong> ганц их ургийн модонд харьяалагдах ба та өөрийн гэр бүл (өрх)-ээ тусад нь үүсгэн их модтойгоо шууд холбох боломжтой.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {defaultAdminFamily && (
              <Link
                href={`/admin?family=${encodeURIComponent(defaultAdminFamily.id)}`}
                className="homev2-button homev2-button--light"
              >
                <ShieldCheck size={15} /> 👑 Админы удирдлагын төв
              </Link>
            )}
            <Link href="/onboarding" className="homev2-button homev2-button--primary">
              <Plus size={15} /> 🏡 Өөрийн өрх үүсгэх
            </Link>
          </div>
        </header>

        {notice && (
          <div
            className="ui-callout ui-callout--success"
            role="status"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={18} />
              <strong>{notice}</strong>
            </div>
            {connectedTargetId && (
              <Link
                href={`/tree?family=${encodeURIComponent(connectedTargetId)}`}
                className="homev2-button homev2-button--primary"
                style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
              >
                🌳 Их ургийн модонд харах →
              </Link>
            )}
          </div>
        )}

        {error && (
          <div
            className="ui-callout ui-callout--danger"
            role="alert"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadFamilies()}
              className="homev2-button homev2-button--light"
              style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
            >
              Дахин оролдох
            </button>
          </div>
        )}

        {loading ? (
          <div className="families-main-card" style={{ textAlign: 'center', padding: 56 }}>
            🌳 Ургийн сан ба өрхийн мэдээллийг ачаалж байна…
          </div>
        ) : families.length === 0 ? (
          <div className="families-main-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <TreeDeciduous size={48} style={{ color: 'var(--ui-accent)', margin: '0 auto 16px' }} />
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>🏡 Өөрийн гэр бүлээ эхлүүлээрэй</h2>
            <p style={{ color: 'var(--ui-text-secondary)', fontSize: 14, marginBottom: 24 }}>
              Танд одоогоор идэвхтэй гэр бүлийн бүртгэл алга. Өөрийн өрхөө бүртгээд удмын модоо эхлүүлнэ үү.
            </p>
            <Link href="/onboarding" className="homev2-button homev2-button--primary">
              🏡 Өөрийн өрх үүсгэх
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 26 }}>
            {/* Section 1: Main Ancestral Clan Tree */}
            <section aria-label="Үндсэн их ургийн мод">
              <div className="clan-section-title-row">
                <h2>🌳 Үндсэн Их Ургийн Мод ({mainClans.length})</h2>
                <span>Нэгдсэн Гуулин өвгийн үр удмын үндсэн сан</span>
              </div>
              <div className="clan-cards-grid">
                {mainClans.map((clan) => {
                  const st = statsByFamily[clan.id];
                  const linkedCount = linkedCounts[clan.id] ?? 0;
                  return (
                    <article key={clan.id} className="families-main-card clan-card is-primary">
                      <div className="clan-card-head">
                        <div className="clan-card-badges">
                          <span className="clan-pill-accent">👑 Их ургийн мод</span>
                          <span className="clan-pill-neutral">{roleLabel(clan.role, clan.admin_title)}</span>
                          {linkedCount > 0 && (
                            <span className="clan-pill-success">🔗 {linkedCount} өрх холбогдсон</span>
                          )}
                        </div>
                        <h3>{clan.name}</h3>
                        <p>
                          {clan.description ||
                            'Гуулин өвгөөс улбаатай нийт үр удмын нэгдсэн ургийн мод, өв сан, түүхийн орон зай.'}
                        </p>
                      </div>

                      {st && (
                        <div className="clan-card-metrics">
                          <div>
                            <small>Нийт хүн</small>
                            <strong>{st.total_persons}</strong>
                          </div>
                          <div>
                            <small>Үеийн гүн</small>
                            <strong>{st.generation_depth} үе</strong>
                          </div>
                          <div>
                            <small>Гэрлэлт</small>
                            <strong>{st.marriage_count}</strong>
                          </div>
                          <div>
                            <small>Гишүүд</small>
                            <strong>{st.member_count}</strong>
                          </div>
                        </div>
                      )}

                      <div className="clan-card-actions">
                        <Link
                          href={`/tree?family=${encodeURIComponent(clan.id)}`}
                          className="homev2-button homev2-button--primary"
                          style={{ minHeight: 38, fontSize: 12.5 }}
                        >
                          <GitFork size={14} /> Их мод үзэх
                        </Link>
                        <Link
                          href={`/people?family=${encodeURIComponent(clan.id)}`}
                          className="homev2-button homev2-button--light"
                          style={{ minHeight: 38, fontSize: 12.5 }}
                        >
                          <Users size={14} /> Хүмүүс
                        </Link>
                        <Link
                          href={`/dashboard?family=${encodeURIComponent(clan.id)}`}
                          className="homev2-button homev2-button--light"
                          style={{ minHeight: 38, fontSize: 12.5 }}
                        >
                          Нүүр <ArrowRight size={13} />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {/* Section 2: Personal Households / Branches */}
            <section aria-label="Миний өрх ба гэр бүлүүд">
              <div className="clan-section-title-row">
                <h2>🏡 Миний өрх / Гэр бүлийн салбар ({households.length})</h2>
                <span>Өөрийн өрхөө үүсгээд их ургийн модтой шууд холбоно</span>
              </div>

              {households.length === 0 ? (
                <div className="families-main-card clan-empty-household">
                  <div>
                    <strong style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>
                      🏡 Өөрийн гэр бүл (өрх)-ийг тусад нь үүсгэж холбоорой
                    </strong>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--ui-text-secondary)' }}>
                      Та зөвхөн өөрийн хань ижил, үр хүүхэд, эцэг эх бүхий гэр бүлээ тусад нь үүсгэж, дараа нь Гуулингийнхан их модтой холбож болно.
                    </p>
                  </div>
                  <Link href="/onboarding" className="homev2-button homev2-button--primary">
                    <Plus size={14} /> Өөрийн өрх үүсгэх
                  </Link>
                </div>
              ) : (
                <div className="clan-cards-grid">
                  {households.map((hh) => {
                    const st = statsByFamily[hh.id];
                    const hasOtherTargets = families.length > 1;
                    const canManagePeople =
                      hh.role === 'owner' ||
                      hh.role === 'editor' ||
                      (hh.permissions ?? []).includes('manage_people');
                    return (
                      <article key={hh.id} className="families-main-card clan-card">
                        <div className="clan-card-head">
                          <div className="clan-card-badges">
                            <span className="clan-pill-neutral">{roleLabel(hh.role, hh.admin_title)}</span>
                            {hh.parent_family_id ? (
                              <span className="clan-pill-success">
                                🔗 «{hh.parent_family_name || 'Их мод'}»-той холбогдсон
                              </span>
                            ) : (
                              <span className="clan-pill-warning">🌿 Их модтой холбогдоогүй</span>
                            )}
                          </div>
                          <h3>🏡 {hh.name}</h3>
                          <p>
                            {hh.description ||
                              'Өөрийн гэр бүлийн гишүүдийн хувийн бүртгэл ба удамшлын салбар.'}
                          </p>
                        </div>

                        {st && (
                          <div className="clan-card-metrics">
                            <div>
                              <small>Гишүүд (модонд)</small>
                              <strong>{st.total_persons}</strong>
                            </div>
                            <div>
                              <small>Үе</small>
                              <strong>{st.generation_depth}</strong>
                            </div>
                            <div>
                              <small>Гэрлэлт</small>
                              <strong>{st.marriage_count}</strong>
                            </div>
                          </div>
                        )}

                        <div className="clan-card-actions">
                          <Link
                            href={`/tree?family=${encodeURIComponent(hh.id)}`}
                            className="homev2-button homev2-button--light"
                            style={{ minHeight: 38, fontSize: 12.5 }}
                          >
                            <GitFork size={14} /> Өрхийн мод
                          </Link>
                          <Link
                            href={`/people?family=${encodeURIComponent(hh.id)}`}
                            className="homev2-button homev2-button--light"
                            style={{ minHeight: 38, fontSize: 12.5 }}
                          >
                            <Users size={14} /> Хүмүүс
                          </Link>
                          {hasOtherTargets && canManagePeople && (
                            <button
                              type="button"
                              onClick={() => void openConnectModal(hh)}
                              className="homev2-button homev2-button--primary"
                              style={{ minHeight: 38, fontSize: 12.5 }}
                            >
                              <Link2 size={14} />
                              {hh.parent_family_id ? 'Их модтой нэмж холбох' : 'Их ургийн модтой холбох'}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Connect Household to Master Clan Modal */}
      {connectHousehold && (
        <div className="ui-modal-backdrop" role="presentation">
          <div
            ref={modalRef}
            className="ui-modal-card"
            style={{ maxWidth: 580 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-clan-modal-title"
          >
            <div className="ui-modal-header">
              <div>
                <h2 id="connect-clan-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                  🔗 «{connectHousehold.name}» өрхийг их ургийн модтой холбох
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ui-text-muted)' }}>
                  Танай өрхийн гишүүд сонгосон их ургийн модонд нэмэгдэж, удмын хэлхээ залгагдана.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConnectHousehold(null)}
                className="admin-icon-close"
                aria-label="Цонх хаах"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConnectSubmit}>
              <div className="ui-modal-body" style={{ display: 'grid', gap: 14 }}>
                {modalError && <div className="ui-callout ui-callout--danger">{modalError}</div>}

                <label className="ui-label">
                  🌳 Холбогдох их ургийн мод *
                  <select
                    value={targetClanId}
                    onChange={(e) => void handleTargetClanChange(e.target.value)}
                    disabled={connectBusy}
                    className="ui-select"
                    style={{ marginTop: 5 }}
                  >
                    {families
                      .filter((f) => f.id !== connectHousehold.id)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="ui-label">
                  🏡 Өрхийн талаас залгагдах хүн *
                  <select
                    value={householdPersonId}
                    onChange={(e) => setHouseholdPersonId(e.target.value)}
                    disabled={connectBusy || modalLoading || householdPeople.length === 0}
                    className="ui-select"
                    style={{ marginTop: 5 }}
                  >
                    {householdPeople.length === 0 ? (
                      <option value="">Энэ өрхөд хүн бүртгэгдээгүй байна</option>
                    ) : (
                      householdPeople.map((p) => (
                        <option key={p.id} value={p.id}>
                          {[p.last_name, p.first_name].filter(Boolean).join(' ')}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="ui-label">
                  🧬 Их модтой ямар холбоосоор залгах вэ? *
                  <select
                    value={relation}
                    onChange={(e) => setRelation(e.target.value as ConnectRelation)}
                    disabled={connectBusy}
                    className="ui-select"
                    style={{ marginTop: 5 }}
                  >
                    <option value="child_of">👶 Сонгосон хүний үр хүүхэд (доороос нь холбоно)</option>
                    <option value="spouse_of">💍 Сонгосон хүний хань ижил</option>
                    <option value="same_person">✨ Их модонд байгаа ижил хүнтэй нэгтгэх</option>
                    <option value="parent_of">🌿 Сонгосон хүний эцэг эх (дээрээс нь холбоно)</option>
                  </select>
                </label>

                <label className="ui-label">
                  🔍 Их модноос хүн хайх
                  <input
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    placeholder="Нэр, овгоор шүүх…"
                    disabled={connectBusy || modalLoading}
                    className="ui-input"
                    style={{ marginTop: 5 }}
                  />
                </label>

                <label className="ui-label">
                  🌳 Их модон дахь хүн ({filteredTargetPeople.length}) *
                  <select
                    value={targetAnchorId}
                    onChange={(e) => setTargetAnchorId(e.target.value)}
                    disabled={connectBusy || modalLoading || filteredTargetPeople.length === 0}
                    className="ui-select"
                    style={{ marginTop: 5 }}
                  >
                    {modalLoading ? (
                      <option value="">Хүмүүсийг ачаалж байна…</option>
                    ) : filteredTargetPeople.length === 0 ? (
                      <option value="">Хүн олдсонгүй</option>
                    ) : (
                      filteredTargetPeople.map((p) => (
                        <option key={p.id} value={p.id}>
                          {[p.last_name, p.first_name].filter(Boolean).join(' ')}
                          {p.birth_date ? ` (${p.birth_date.slice(0, 4)})` : ''}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>

              <div className="ui-modal-footer">
                <button
                  type="button"
                  onClick={() => setConnectHousehold(null)}
                  disabled={connectBusy}
                  className="homev2-button homev2-button--light"
                >
                  Болих
                </button>
                <button
                  type="submit"
                  disabled={
                    connectBusy || modalLoading || !householdPersonId || !targetAnchorId || !targetClanId
                  }
                  className="homev2-button homev2-button--primary"
                >
                  <Link2 size={14} />
                  {connectBusy ? 'Холбож байна…' : '🔗 Их модтой холбох'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FamiliesPage() {
  return (
    <Suspense
      fallback={
        <div className="families-page">
          <div className="families-shell" style={{ padding: 64, textAlign: 'center' }}>
            🌳 Ургийн сан ба өрхүүдийг ачаалж байна…
          </div>
        </div>
      }
    >
      <FamiliesContent />
    </Suspense>
  );
}
