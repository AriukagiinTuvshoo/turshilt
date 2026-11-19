'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, GitFork, Heart, Link2, Plus, Trash2, TreeDeciduous, Users } from 'lucide-react';
import { ApiError, ConnectHouseholdOut, Family, Person, User, api } from '../../lib/api';

type ChildDraft = {
  key: string;
  name: string;
  gender: 'male' | 'female' | 'unknown';
  birthYear: string;
};

type ConnectRelation = 'child_of' | 'spouse_of' | 'same_person' | 'parent_of';

function splitFullName(value: string, fallbackLastName = '') {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: fallbackLastName };
  if (parts.length === 1) return { first_name: parts[0], last_name: fallbackLastName };
  return { first_name: parts.at(-1) ?? '', last_name: parts.slice(0, -1).join(' ') };
}

function normalizeBirthDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

function onboardingError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай. Нэвтэрсний дараа үргэлжлүүлнэ үү.';
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй байна.';
    if (cause.status === 404) return 'Шаардлагатай бүртгэл олдсонгүй.';
    if (cause.status === 409) return 'Өгөгдлийн зөрчил үүслээ. Өрхийн жагсаалтаа шалгана уу.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
  }
  return 'Холболтын алдаа гарлаа. Дахин оролдоно уу.';
}

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdFamilyId, setCreatedFamilyId] = useState<string | null>(null);

  const [existingFamilies, setExistingFamilies] = useState<Family[]>([]);
  const [householdName, setHouseholdName] = useState('');
  const [selfLastName, setSelfLastName] = useState('Гуулин');
  const [selfFirstName, setSelfFirstName] = useState('');
  const [selfGender, setSelfGender] = useState<'male' | 'female' | 'unknown'>('unknown');
  const [selfBirthYear, setSelfBirthYear] = useState('');

  const [spouseName, setSpouseName] = useState('');
  const [spouseGender, setSpouseGender] = useState<'male' | 'female' | 'unknown'>('unknown');

  const [fatherName, setFatherName] = useState('');
  const [motherName, setMotherName] = useState('');

  const [children, setChildren] = useState<ChildDraft[]>([]);

  // Master clan connection controls
  const [targetClanId, setTargetClanId] = useState('');
  const [clanPeople, setClanPeople] = useState<Person[]>([]);
  const [clanPeopleLoading, setClanPeopleLoading] = useState(false);
  const [connectNow, setConnectNow] = useState(true);
  const [anchorSearch, setAnchorSearch] = useState('');
  const [targetAnchorId, setTargetAnchorId] = useState('');
  const [connectWho, setConnectWho] = useState<'self' | 'father' | 'mother'>('self');
  const [connectRelation, setConnectRelation] = useState<ConnectRelation>('child_of');

  const mounted = useRef(true);

  const rootClans = useMemo(() => {
    const roots = existingFamilies.filter((f) => !f.parent_family_id);
    return roots.length > 0 ? roots : existingFamilies;
  }, [existingFamilies]);

  useEffect(() => {
    mounted.current = true;
    Promise.all([api<User>('/auth/me'), api<Family[]>('/families').catch(() => [] as Family[])])
      .then(([me, fams]) => {
        if (!mounted.current) return;
        const parsed = splitFullName(me.display_name || '');
        const first = parsed.first_name || me.display_name || '';
        setSelfFirstName(first);
        if (parsed.last_name) setSelfLastName(parsed.last_name);
        setHouseholdName(first ? `${first}-ийн гэр бүл` : 'Манай гэр бүл');
        setExistingFamilies(fams);

        const roots = fams.filter((f) => !f.parent_family_id);
        const preferred =
          roots.find((f) => f.name.toLowerCase().includes('гуулин')) ?? roots[0] ?? fams[0] ?? null;
        if (preferred) {
          setTargetClanId(preferred.id);
        } else {
          setConnectNow(false);
        }
      })
      .catch((cause) => {
        if (!mounted.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(onboardingError(cause));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });

    return () => {
      mounted.current = false;
    };
  }, [router]);

  useEffect(() => {
    if (!targetClanId) {
      setClanPeople([]);
      setTargetAnchorId('');
      return;
    }
    let active = true;
    setClanPeopleLoading(true);
    api<Person[]>(`/families/${targetClanId}/persons`)
      .then((peopleList) => {
        if (!active) return;
        setClanPeople(peopleList);
        setTargetAnchorId((curr) =>
          curr && peopleList.some((p) => p.id === curr) ? curr : peopleList[0]?.id ?? '',
        );
      })
      .catch(() => {
        if (!active) return;
        setClanPeople([]);
        setTargetAnchorId('');
      })
      .finally(() => {
        if (active) setClanPeopleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [targetClanId]);

  const filteredAnchors = useMemo(() => {
    const q = anchorSearch.trim().toLowerCase();
    if (!q) return clanPeople;
    return clanPeople.filter(
      (p) =>
        p.first_name.toLowerCase().includes(q) ||
        p.last_name.toLowerCase().includes(q) ||
        (p.birth_date && p.birth_date.includes(q)),
    );
  }, [anchorSearch, clanPeople]);

  function addChildRow() {
    setChildren((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        gender: 'unknown',
        birthYear: '',
      },
    ]);
  }

  function updateChildRow(key: string, patch: Partial<ChildDraft>) {
    setChildren((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeChildRow(key: string) {
    setChildren((prev) => prev.filter((item) => item.key !== key));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const famName = householdName.trim();
    const firstName = selfFirstName.trim();
    const lastName = selfLastName.trim();
    if (!famName) {
      setError('Өөрийн өрх / гэр бүлийн нэрийг оруулна уу.');
      return;
    }
    if (!firstName) {
      setError('Өөрийн нэрийг оруулна уу.');
      return;
    }
    if (connectNow && rootClans.length > 0 && clanPeople.length > 0 && !targetAnchorId) {
      setError('Их ургийн модонд холбох хамаатан эсвэл өвгөө сонгоно уу.');
      return;
    }

    setBusy(true);
    setError('');
    setCreatedFamilyId(null);

    let createdHousehold: Family | null = null;
    try {
      const targetClan = rootClans.find((c) => c.id === targetClanId) ?? null;
      const householdDesc =
        connectNow && targetClan
          ? `${famName} — «${targetClan.name}» их ургийн модтой холбогдсон хувийн өрх.`
          : `${famName} — хувийн гэр бүлийн бүртгэл.`;

      createdHousehold = await api<Family>('/families', {
        method: 'POST',
        body: JSON.stringify({ name: famName, description: householdDesc }),
      });
      if (!mounted.current) return;
      setCreatedFamilyId(createdHousehold.id);

      const mePerson = await api<{ id: string }>(`/families/${createdHousehold.id}/persons`, {
        method: 'POST',
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          gender: selfGender,
          birth_date: normalizeBirthDate(selfBirthYear),
          visibility: 'family',
        }),
      });
      if (!mounted.current) return;

      // Link current user to self person if they don't already have an account-to-person link
      await api(`/families/${createdHousehold.id}/persons/${mePerson.id}/link-me`, {
        method: 'POST',
      }).catch(() => undefined);

      // Spouse
      let spousePersonId: string | null = null;
      if (spouseName.trim()) {
        const sp = await api<{ id: string }>(`/families/${createdHousehold.id}/persons`, {
          method: 'POST',
          body: JSON.stringify({
            ...splitFullName(spouseName),
            gender: spouseGender,
            visibility: 'family',
          }),
        });
        spousePersonId = sp.id;
        await api(`/families/${createdHousehold.id}/marriages`, {
          method: 'POST',
          body: JSON.stringify({
            person_1_id: mePerson.id,
            person_2_id: sp.id,
            status: 'married',
          }),
        }).catch(() => undefined);
      }

      // Father & Mother
      let fatherId: string | null = null;
      let motherId: string | null = null;
      if (fatherName.trim()) {
        const father = await api<{ id: string }>(`/families/${createdHousehold.id}/persons`, {
          method: 'POST',
          body: JSON.stringify({
            ...splitFullName(fatherName, lastName),
            gender: 'male',
            visibility: 'family',
          }),
        });
        fatherId = father.id;
        await api(`/families/${createdHousehold.id}/relationships/parent-child`, {
          method: 'POST',
          body: JSON.stringify({
            parent_id: father.id,
            child_id: mePerson.id,
            relationship_type: 'biological',
          }),
        });
      }
      if (motherName.trim()) {
        const mother = await api<{ id: string }>(`/families/${createdHousehold.id}/persons`, {
          method: 'POST',
          body: JSON.stringify({
            ...splitFullName(motherName),
            gender: 'female',
            visibility: 'family',
          }),
        });
        motherId = mother.id;
        await api(`/families/${createdHousehold.id}/relationships/parent-child`, {
          method: 'POST',
          body: JSON.stringify({
            parent_id: mother.id,
            child_id: mePerson.id,
            relationship_type: 'biological',
          }),
        });
      }
      if (fatherId && motherId) {
        await api(`/families/${createdHousehold.id}/marriages`, {
          method: 'POST',
          body: JSON.stringify({
            person_1_id: fatherId,
            person_2_id: motherId,
            status: 'married',
          }),
        }).catch(() => undefined);
      }

      // Children
      for (const ch of children) {
        const cleanedName = ch.name.trim();
        if (!cleanedName) continue;
        const chPerson = await api<{ id: string }>(`/families/${createdHousehold.id}/persons`, {
          method: 'POST',
          body: JSON.stringify({
            ...splitFullName(cleanedName, firstName || lastName),
            gender: ch.gender,
            birth_date: normalizeBirthDate(ch.birthYear),
            visibility: 'family',
          }),
        });
        await api(`/families/${createdHousehold.id}/relationships/parent-child`, {
          method: 'POST',
          body: JSON.stringify({
            parent_id: mePerson.id,
            child_id: chPerson.id,
            relationship_type: 'biological',
          }),
        });
        if (spousePersonId) {
          await api(`/families/${createdHousehold.id}/relationships/parent-child`, {
            method: 'POST',
            body: JSON.stringify({
              parent_id: spousePersonId,
              child_id: chPerson.id,
              relationship_type: 'biological',
            }),
          }).catch(() => undefined);
        }
      }

      // Connect newly created household to the chosen master clan branch!
      let destinationFamilyId = createdHousehold.id;
      if (connectNow && targetClan && targetAnchorId) {
        const householdAnchorPersonId =
          connectWho === 'father' && fatherId
            ? fatherId
            : connectWho === 'mother' && motherId
              ? motherId
              : mePerson.id;

        const bridgeRes = await api<ConnectHouseholdOut>(
          `/families/${createdHousehold.id}/connect-to-clan`,
          {
            method: 'POST',
            body: JSON.stringify({
              target_family_id: targetClan.id,
              household_person_id: householdAnchorPersonId,
              target_anchor_person_id: targetAnchorId,
              relation: connectRelation,
            }),
          },
        );
        destinationFamilyId = bridgeRes.target_family_id;
      }

      if (mounted.current) {
        router.push(`/tree?family=${encodeURIComponent(destinationFamilyId)}`);
      }
    } catch (cause) {
      if (!mounted.current) return;
      setError(onboardingError(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="household-onboarding-page" aria-busy="true">
        <div className="household-onboarding-card" style={{ textAlign: 'center', padding: 48 }}>
          <p role="status" aria-live="polite" style={{ margin: 0, color: 'var(--ui-text-secondary)' }}>
            🌱 Мэдээллийг бэлтгэж байна…
          </p>
        </div>
      </div>
    );
  }

  const hasClansToJoin = rootClans.length > 0;

  return (
    <div className="household-onboarding-page" aria-busy={busy}>
      <div className="household-onboarding-card">
        <div className="household-onboarding-top">
          <Link href="/families" className="homev2-button homev2-button--light" style={{ minHeight: 36, padding: '0 12px' }}>
            <ArrowLeft size={14} /> 🏡 Ураг ба Миний өрх
          </Link>
          <span className="household-onboarding-badge">
            <TreeDeciduous size={13} /> ГУУЛИНГИЙНХАН · ӨРХ БҮРТГЭЛ
          </span>
        </div>

        <h1 className="household-onboarding-title">🏡 Өөрийн гэр бүл (өрх) үүсгэх</h1>
        <p className="household-onboarding-sub">
          {hasClansToJoin
            ? 'Та өөрийн гэр бүлийн гишүүдээ (өөрийгөө, хань ижил, үр хүүхдээ) тусгайлан бүртгээд шууд их ургийн модтой холбох боломжтой.'
            : 'Удмын нэгдсэн сандаа өөрийн өрх гэр бүлийн бүртгэлийг эхлүүлж, гишүүдээ нэмээрэй.'}
        </p>

        {error && (
          <div className="ui-callout ui-callout--danger" role="alert" aria-live="assertive" style={{ marginBottom: 18 }}>
            <strong>{error}</strong>
            {createdFamilyId && (
              <div style={{ marginTop: 6 }}>
                Өрх үүссэн тул{' '}
                <Link href={`/families?family=${encodeURIComponent(createdFamilyId)}`} style={{ textDecoration: 'underline', fontWeight: 700 }}>
                  үүссэн өрхөө эндээс шалгаад холбоно уу →
                </Link>
              </div>
            )}
          </div>
        )}

        <form onSubmit={submit} noValidate className="household-form-stack">
          {/* 1. Household Name */}
          <section className="household-form-section">
            <h2 className="household-section-heading">
              <Users size={16} /> 1. Өрх гэр бүлийн нэр
            </h2>
            <label className="ui-label">
              Өөрийн өрхийн нэр *
              <input
                name="family"
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
                placeholder="Ж: Батболдын гэр бүл"
                maxLength={180}
                required
                disabled={busy}
                className="ui-input"
                style={{ marginTop: 6 }}
              />
            </label>
          </section>

          {/* 2. Self + Spouse */}
          <section className="household-form-section">
            <h2 className="household-section-heading">
              <Heart size={16} /> 2. Та болон Хань ижил
            </h2>
            <div className="household-grid-2">
              <label className="ui-label">
                Таны овог
                <input
                  name="lastName"
                  value={selfLastName}
                  onChange={(e) => setSelfLastName(e.target.value)}
                  placeholder="Гуулин"
                  maxLength={120}
                  disabled={busy}
                  className="ui-input"
                  style={{ marginTop: 5 }}
                />
              </label>
              <label className="ui-label">
                Таны нэр *
                <input
                  name="name"
                  autoComplete="name"
                  value={selfFirstName}
                  onChange={(e) => setSelfFirstName(e.target.value)}
                  maxLength={120}
                  required
                  disabled={busy}
                  className="ui-input"
                  style={{ marginTop: 5 }}
                />
              </label>
              <label className="ui-label">
                Хүйс
                <select
                  name="gender"
                  value={selfGender}
                  onChange={(e) => setSelfGender(e.target.value as 'male' | 'female' | 'unknown')}
                  disabled={busy}
                  className="ui-select"
                  style={{ marginTop: 5 }}
                >
                  <option value="unknown">Тодорхойгүй</option>
                  <option value="male">Эрэгтэй</option>
                  <option value="female">Эмэгтэй</option>
                </select>
              </label>
              <label className="ui-label">
                Төрсөн он / огноо (заавал биш)
                <input
                  name="birthYear"
                  value={selfBirthYear}
                  onChange={(e) => setSelfBirthYear(e.target.value)}
                  placeholder="Ж: 1990 эсвэл 1990-05-14"
                  disabled={busy}
                  className="ui-input"
                  style={{ marginTop: 5 }}
                />
              </label>
            </div>

            <div className="household-grid-2" style={{ marginTop: 14 }}>
              <label className="ui-label">
                💍 Хань ижилийн бүтэн нэр (заавал биш)
                <input
                  name="spouse"
                  value={spouseName}
                  onChange={(e) => setSpouseName(e.target.value)}
                  placeholder="Ж: Сарантуяа Дорж"
                  maxLength={240}
                  disabled={busy}
                  className="ui-input"
                  style={{ marginTop: 5 }}
                />
              </label>
              <label className="ui-label">
                Хань ижилийн хүйс
                <select
                  name="spouseGender"
                  value={spouseGender}
                  onChange={(e) => setSpouseGender(e.target.value as 'male' | 'female' | 'unknown')}
                  disabled={busy}
                  className="ui-select"
                  style={{ marginTop: 5 }}
                >
                  <option value="unknown">Тодорхойгүй</option>
                  <option value="female">Эмэгтэй</option>
                  <option value="male">Эрэгтэй</option>
                </select>
              </label>
            </div>

            <div className="household-grid-2" style={{ marginTop: 14 }}>
              <label className="ui-label">
                🌿 Эцгийн нэр (заавал биш)
                <input
                  name="father"
                  value={fatherName}
                  onChange={(e) => setFatherName(e.target.value)}
                  placeholder="Аавын бүтэн нэр"
                  maxLength={240}
                  disabled={busy}
                  className="ui-input"
                  style={{ marginTop: 5 }}
                />
              </label>
              <label className="ui-label">
                🌿 Эхийн нэр (заавал биш)
                <input
                  name="mother"
                  value={motherName}
                  onChange={(e) => setMotherName(e.target.value)}
                  placeholder="Ээжийн бүтэн нэр"
                  maxLength={240}
                  disabled={busy}
                  className="ui-input"
                  style={{ marginTop: 5 }}
                />
              </label>
            </div>
          </section>

          {/* 3. Children */}
          <section className="household-form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: children.length ? 12 : 0 }}>
              <h2 className="household-section-heading" style={{ margin: 0 }}>
                👶 3. Үр хүүхдүүд ({children.length})
              </h2>
              <button
                type="button"
                onClick={addChildRow}
                disabled={busy}
                className="homev2-button homev2-button--light"
                style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
              >
                <Plus size={14} /> Хүүхэд нэмэх
              </button>
            </div>

            {children.length > 0 && (
              <div style={{ display: 'grid', gap: 10 }}>
                {children.map((ch, idx) => (
                  <div key={ch.key} className="household-child-row">
                    <input
                      value={ch.name}
                      onChange={(e) => updateChildRow(ch.key, { name: e.target.value })}
                      placeholder={`${idx + 1}-р хүүхдийн нэр`}
                      maxLength={120}
                      disabled={busy}
                      className="ui-input"
                    />
                    <select
                      value={ch.gender}
                      onChange={(e) =>
                        updateChildRow(ch.key, {
                          gender: e.target.value as 'male' | 'female' | 'unknown',
                        })
                      }
                      disabled={busy}
                      className="ui-select"
                    >
                      <option value="unknown">Хүйс</option>
                      <option value="male">Хүү</option>
                      <option value="female">Охин</option>
                    </select>
                    <input
                      value={ch.birthYear}
                      onChange={(e) => updateChildRow(ch.key, { birthYear: e.target.value })}
                      placeholder="Төрсөн он"
                      maxLength={10}
                      disabled={busy}
                      className="ui-input"
                    />
                    <button
                      type="button"
                      onClick={() => removeChildRow(ch.key)}
                      disabled={busy}
                      className="admin-remove-btn"
                      aria-label={`${idx + 1}-р хүүхэд хасах`}
                      style={{ minHeight: 38, padding: '0 10px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 4. Instant Connect to Master Clan */}
          {hasClansToJoin && (
            <section className="household-form-section is-highlight">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <h2 className="household-section-heading" style={{ margin: 0 }}>
                  <GitFork size={16} /> 4. Их ургийн модтой холбох
                </h2>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: 'var(--ui-text)' }}>
                  <input
                    type="checkbox"
                    checked={connectNow}
                    onChange={(e) => setConnectNow(e.target.checked)}
                    disabled={busy}
                    style={{ width: 16, height: 16, accentColor: 'var(--ui-accent)' }}
                  />
                  <span>Үүсгэнгүүт шууд холбох</span>
                </label>
              </div>

              {connectNow ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div className="household-grid-2">
                    <label className="ui-label">
                      🌳 Холбогдох их ургийн мод
                      <select
                        value={targetClanId}
                        onChange={(e) => setTargetClanId(e.target.value)}
                        disabled={busy}
                        className="ui-select"
                        style={{ marginTop: 5 }}
                      >
                        {rootClans.map((clan) => (
                          <option key={clan.id} value={clan.id}>
                            {clan.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="ui-label">
                      🔗 Танай өрхөөс хэн холбогдох вэ?
                      <select
                        value={connectWho}
                        onChange={(e) => setConnectWho(e.target.value as 'self' | 'father' | 'mother')}
                        disabled={busy}
                        className="ui-select"
                        style={{ marginTop: 5 }}
                      >
                        <option value="self">👤 Би өөрөө ({selfFirstName || 'Та'})</option>
                        {fatherName.trim() && <option value="father">👨 Эцэг ({fatherName.trim()})</option>}
                        {motherName.trim() && <option value="mother">👩 Эх ({motherName.trim()})</option>}
                      </select>
                    </label>
                  </div>

                  <div className="household-grid-2">
                    <label className="ui-label">
                      🧬 Холбоосын төрөл
                      <select
                        value={connectRelation}
                        onChange={(e) => setConnectRelation(e.target.value as ConnectRelation)}
                        disabled={busy}
                        className="ui-select"
                        style={{ marginTop: 5 }}
                      >
                        <option value="child_of">👶 Сонгосон хүний үр хүүхэд нь (доор залгана)</option>
                        <option value="spouse_of">💍 Сонгосон хүний хань ижил нь</option>
                        <option value="same_person">✨ Их модонд аль хэдийн байгаа өөрийн дүртэй нэгтгэх</option>
                        <option value="parent_of">🌿 Сонгосон хүний эцэг/эх нь (дээр залгана)</option>
                      </select>
                    </label>
                    <label className="ui-label">
                      🔍 Их модноос хүн хайх
                      <input
                        value={anchorSearch}
                        onChange={(e) => setAnchorSearch(e.target.value)}
                        placeholder="Нэр эсвэл овгоор шүүх…"
                        disabled={busy || clanPeopleLoading}
                        className="ui-input"
                        style={{ marginTop: 5 }}
                      />
                    </label>
                  </div>

                  <label className="ui-label">
                    🌳 Их модон дахь холбох хүн ({filteredAnchors.length})
                    <select
                      value={targetAnchorId}
                      onChange={(e) => setTargetAnchorId(e.target.value)}
                      disabled={busy || clanPeopleLoading || filteredAnchors.length === 0}
                      className="ui-select"
                      style={{ marginTop: 5 }}
                    >
                      {clanPeopleLoading ? (
                        <option value="">Модны хүмүүсийг ачаалж байна…</option>
                      ) : filteredAnchors.length === 0 ? (
                        <option value="">Тохирох хүн олдсонгүй</option>
                      ) : (
                        filteredAnchors.map((person) => (
                          <option key={person.id} value={person.id}>
                            {[person.last_name, person.first_name].filter(Boolean).join(' ')}
                            {person.birth_date ? ` (${person.birth_date.slice(0, 4)})` : ''}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ui-text-secondary)' }}>
                  Та өрхөө тусад нь үүсгээд, хүссэн үедээ <strong>«🏡 Ураг ба Миний өрх»</strong> хуудсаас их модтой холбож болно.
                </p>
              )}
            </section>
          )}

          <button
            className="homev2-button homev2-button--primary"
            type="submit"
            disabled={busy}
            aria-busy={busy}
            style={{ minHeight: 46, fontSize: 13.5, width: '100%' }}
          >
            <Link2 size={16} />
            {busy
              ? 'Өрх бүртгэж байна…'
              : connectNow && hasClansToJoin && targetAnchorId
                ? '🏡 Өрхөө үүсгээд их ургийн модтой холбох'
                : '🏡 Өөрийн өрх үүсгэх'}
          </button>
        </form>
      </div>
    </div>
  );
}
