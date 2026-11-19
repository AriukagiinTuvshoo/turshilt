'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  api,
  BranchSummary,
  Family,
  LineageSummary,
  PersonDirectoryItem,
  PersonDirectoryPage,
  personName,
  User,
} from '../../lib/api';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 240;

function normalizeSearchQuery(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function initials(person: Pick<PersonDirectoryItem, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function year(value: string | null) {
  return value ? value.slice(0, 4) : null;
}

function calculateAge(birthDate: string | null, deathDate: string | null, isAlive: boolean) {
  if (!birthDate) return null;
  const bYear = parseInt(birthDate.slice(0, 4), 10);
  if (isNaN(bYear)) return null;
  const endYear = (!isAlive && deathDate) ? parseInt(deathDate.slice(0, 4), 10) : new Date().getFullYear();
  if (isNaN(endYear) || endYear < bYear) return null;
  return endYear - bYear;
}

function lifeSummary(person: PersonDirectoryItem) {
  const birth = year(person.birth_date);
  const age = calculateAge(person.birth_date, person.death_date, person.is_alive);
  if (person.is_alive) {
    if (birth && age !== null) return `${birth} · ${age} насалж буй`;
    if (birth) return `${birth} · амьд`;
    return 'Төрсөн он тодорхойгүй';
  }
  const death = year(person.death_date);
  const yearsSpan = [birth, death].filter(Boolean).join(' – ');
  if (yearsSpan && age !== null) return `${yearsSpan} (${age} насалсан)`;
  return yearsSpan || 'Амьдралын огноо тодорхойгүй';
}

function activeFilterCount(query: string, lineageId: string, branchId: string, gender: string, status: string) {
  return (
    Number(Boolean(query.trim())) +
    Number(Boolean(lineageId)) +
    Number(Boolean(branchId)) +
    Number(gender !== 'all') +
    Number(status !== 'all')
  );
}

function PeoplePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [lineages, setLineages] = useState<LineageSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [lineageId, setLineageId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'alive' | 'deceased'>('all');
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | 'mine' | 'self' | 'readonly'>('all');
  const [generationFilter, setGenerationFilter] = useState<'all' | 'ancestor' | 'parent' | 'current' | 'youth'>('all');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PersonDirectoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [error, setError] = useState('');
  const [metaBusy, setMetaBusy] = useState(false);

  const peopleRequestRef = useRef(0);
  const familyRequestRef = useRef(0);
  const metadataRequestRef = useRef(0);
  const peopleAbortRef = useRef<AbortController | null>(null);
  const familyAbortRef = useRef<AbortController | null>(null);
  const metadataAbortRef = useRef<AbortController | null>(null);

  const loadPeople = useCallback(async (
    fid: string,
    nextQuery: string,
    nextLineageId: string,
    nextBranchId: string,
    nextGender: string,
    nextStatus: string,
    nextPage: number,
  ) => {
    if (!fid) return;
    const requestId = ++peopleRequestRef.current;
    peopleAbortRef.current?.abort();
    const controller = new AbortController();
    peopleAbortRef.current = controller;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        page_size: String(PAGE_SIZE),
      });
      const safeQuery = normalizeSearchQuery(nextQuery);
      if (safeQuery) params.set('q', safeQuery);
      if (nextLineageId) params.set('lineage_id', nextLineageId);
      if (nextBranchId) params.set('branch_id', nextBranchId);
      if (nextGender !== 'all') params.set('gender', nextGender);
      if (nextStatus === 'alive') params.set('is_alive', 'true');
      if (nextStatus === 'deceased') params.set('is_alive', 'false');

      const result = await api<PersonDirectoryPage>(
        `/families/${fid}/people?${params.toString()}`,
        { signal: controller.signal },
      );
      if (requestId !== peopleRequestRef.current) return;
      setPeople(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== peopleRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Хүмүүсийг ачаалж чадсангүй.');
    } finally {
      if (requestId === peopleRequestRef.current) {
        setLoading(false);
        setBusy(false);
      }
    }
  }, [router]);

  const loadFamilies = useCallback(async () => {
    const requestId = ++familyRequestRef.current;
    familyAbortRef.current?.abort();
    peopleAbortRef.current?.abort();
    metadataAbortRef.current?.abort();
    peopleRequestRef.current += 1;
    metadataRequestRef.current += 1;
    const controller = new AbortController();
    familyAbortRef.current = controller;
    setPeople(null);
    setLineages([]);
    setBranches([]);
    setLineageId('');
    setBranchId('');
    setLoading(true);
    setError('');
    try {
      const list = await api<Family[]>('/families', { signal: controller.signal });
      if (requestId !== familyRequestRef.current) return;
      setFamilies(list);
      peopleRequestRef.current += 1;
      if (!list.length) {
        setFamilyId('');
        setPeople(null);
        setLoading(false);
        return;
      }
      const requestedFamily = searchParams.get('family') ?? '';
      if (requestedFamily && !list.some((item) => item.id === requestedFamily)) {
        peopleRequestRef.current += 1;
        metadataRequestRef.current += 1;
        setFamilyId('');
        setPeople(null);
        setLineages([]);
        setBranches([]);
        setLineageId('');
        setBranchId('');
        setLoading(false);
        setError('Сонгосон гэр бүл олдсонгүй эсвэл танд хандах эрхгүй байна.');
        return;
      }
      const selected = list.find((item) => item.id === requestedFamily) ?? list[0];
      setFamilyId(selected.id);
      setPeople(null);
      if (selected.id !== requestedFamily) {
        router.replace('/people?family=' + encodeURIComponent(selected.id));
      }
    } catch (cause) {
      if (controller.signal.aborted || requestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setLoading(false);
      setError(cause instanceof Error ? cause.message : 'Гэр бүлүүдийг ачаалж чадсангүй.');
    }
  }, [router, searchParams]);

  useEffect(() => {
    void loadFamilies();
  }, [loadFamilies]);

  useEffect(() => {
    api<User>('/auth/me').then(setCurrentUser).catch(() => {});
  }, []);

  const loadLineages = useCallback(async (fid: string) => {
    const requestId = ++metadataRequestRef.current;
    metadataAbortRef.current?.abort();
    const controller = new AbortController();
    metadataAbortRef.current = controller;
    setMetaBusy(true);
    setMetaError('');
    try {
      const result = await api<LineageSummary[]>(`/families/${fid}/lineages`, { signal: controller.signal });
      if (requestId !== metadataRequestRef.current) return;
      setLineages(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== metadataRequestRef.current) return;
      setLineages([]);
      setMetaError(cause instanceof Error ? cause.message : 'Удам угсааны мэдээллийг ачаалж чадсангүй.');
    } finally {
      if (requestId === metadataRequestRef.current) setMetaBusy(false);
    }
  }, []);

  const loadBranches = useCallback(async (fid: string, lid: string) => {
    const requestId = ++metadataRequestRef.current;
    metadataAbortRef.current?.abort();
    const controller = new AbortController();
    metadataAbortRef.current = controller;
    setMetaBusy(true);
    setMetaError('');
    try {
      const result = await api<BranchSummary[]>(`/lineages/${lid}/branches`, { signal: controller.signal });
      if (requestId !== metadataRequestRef.current) return;
      setBranches(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== metadataRequestRef.current) return;
      setBranches([]);
      setMetaError(cause instanceof Error ? cause.message : 'Салааны мэдээллийг ачаалж чадсангүй.');
    } finally {
      if (requestId === metadataRequestRef.current) setMetaBusy(false);
    }
  }, []);

  useEffect(() => {
    metadataRequestRef.current += 1;
    setMetaError('');
    setBranches([]);
    setLineages([]);
    setLineageId('');
    setBranchId('');
    if (!familyId) {
      setMetaBusy(false);
      return;
    }
    void loadLineages(familyId);
  }, [familyId, loadLineages]);

  useEffect(() => {
    if (!familyId || !lineageId) {
      metadataRequestRef.current += 1;
      setBranches([]);
      setBranchId('');
      setMetaBusy(false);
      return;
    }
    setBranchId('');
    void loadBranches(familyId, lineageId);
  }, [familyId, lineageId, loadBranches]);

  useEffect(() => {
    if (!familyId) return;
    const timer = window.setTimeout(() => {
      void loadPeople(familyId, query, lineageId, branchId, genderFilter, statusFilter, 1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [branchId, familyId, genderFilter, lineageId, query, statusFilter, loadPeople]);

  function chooseFamily(nextFamilyId: string) {
    peopleRequestRef.current += 1;
    metadataRequestRef.current += 1;
    peopleAbortRef.current?.abort();
    metadataAbortRef.current?.abort();
    setFamilyId(nextFamilyId);
    setLineages([]);
    setBranches([]);
    setLineageId('');
    setBranchId('');
    setPeople(null);
    setMetaError('');
    setError('');
    router.replace('/people?family=' + encodeURIComponent(nextFamilyId));
  }

  function clearFilters() {
    setQuery('');
    setLineageId('');
    setBranchId('');
    setGenderFilter('all');
    setStatusFilter('all');
    setOwnershipFilter('all');
    setGenerationFilter('all');
  }

  const filteredItems = useMemo(() => {
    if (!people?.items) return [];
    return people.items.filter((item) => {
      // Ownership filter
      if (ownershipFilter === 'mine') {
        if (!currentUser || item.created_by !== currentUser.id) return false;
      } else if (ownershipFilter === 'self') {
        if (!currentUser || item.id !== currentUser.person_id) return false;
      } else if (ownershipFilter === 'readonly') {
        if (item.can_edit) return false;
      }

      // Generation filter
      if (generationFilter !== 'all') {
        const birthYear = item.birth_date ? parseInt(item.birth_date.slice(0, 4), 10) : null;
        if (!birthYear) return false;
        if (generationFilter === 'ancestor' && birthYear >= 1960) return false;
        if (generationFilter === 'parent' && (birthYear < 1960 || birthYear > 1985)) return false;
        if (generationFilter === 'current' && (birthYear < 1986 || birthYear > 2005)) return false;
        if (generationFilter === 'youth' && birthYear < 2006) return false;
      }
      return true;
    });
  }, [people?.items, ownershipFilter, generationFilter, currentUser]);

  const stats = useMemo(() => {
    const items = people?.items ?? [];
    const total = people?.total ?? items.length;
    const male = items.filter((p) => p.gender === 'male').length;
    const female = items.filter((p) => p.gender === 'female').length;
    const alive = items.filter((p) => p.is_alive).length;
    const deceased = items.filter((p) => !p.is_alive).length;
    const mine = currentUser ? items.filter((p) => p.created_by === currentUser.id).length : 0;
    return { total, male, female, alive, deceased, mine };
  }, [people, currentUser]);

  const family = families.find((item) => item.id === familyId) ?? null;
  const hasFilters =
    activeFilterCount(query, lineageId, branchId, genderFilter, statusFilter) > 0 ||
    ownershipFilter !== 'all' ||
    generationFilter !== 'all';

  return (
    <main className="people-page">
      <section className="people-shell">
        <div className="people-heading">
          <div>
            <Link className="people-back-link" href={familyId ? `/dashboard?family=${encodeURIComponent(familyId)}` : '/dashboard'}>
              ← Гэр бүлийн тойм
            </Link>
            <p className="eyebrow">ГУУЛИНГИЙНХАН · ХҮМҮҮСИЙН ЛАВЛАХ</p>
            <h1>Гэр бүлийн гишүүд</h1>
            <p className="people-lede">
              Таны хандах эрхтэй бодит удмын хүмүүсийг нэр, нас, хүйс, төрсөн он, удам угсаагаар нь хурдан хайж олж судлаарай.
            </p>
          </div>

          <div className="people-heading-actions">
            {families.length > 1 && (
              <label className="people-control">
                <span>Гэр бүл</span>
                <select
                  value={familyId}
                  onChange={(event) => chooseFamily(event.target.value)}
                  aria-label="Гэр бүл сонгох"
                >
                  {families.map((item) => (
                    <option value={item.id} key={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
            )}
            {family && (
              <Link
                className="button people-tree-jump-btn"
                href={`/tree?family=${family.id}`}
                title="Ургийн модыг бүтнээр харах"
              >
                🌳 Ургийн мод руу очих
              </Link>
            )}
          </div>
        </div>

        {error && (
          <div className="error people-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() =>
                void (familyId
                  ? loadPeople(familyId, query, lineageId, branchId, genderFilter, statusFilter, 1)
                  : loadFamilies())
              }
            >
              Дахин оролдох
            </button>
          </div>
        )}

        {family && (
          <>
            {/* Quick Summary Stats Strip */}
            {people && (
              <div className="people-stats-strip">
                <div className="people-stat-card">
                  <span className="people-stat-icon" aria-hidden="true">👥</span>
                  <div className="people-stat-info">
                    <strong>{stats.total}</strong>
                    <small>Нийт гишүүн</small>
                  </div>
                </div>
                <div className="people-stat-card">
                  <span className="people-stat-icon" aria-hidden="true">👨</span>
                  <div className="people-stat-info">
                    <strong>{stats.male}</strong>
                    <small>Эрэгтэй</small>
                  </div>
                </div>
                <div className="people-stat-card">
                  <span className="people-stat-icon" aria-hidden="true">👩</span>
                  <div className="people-stat-info">
                    <strong>{stats.female}</strong>
                    <small>Эмэгтэй</small>
                  </div>
                </div>
                <div className="people-stat-card">
                  <span className="people-stat-icon" aria-hidden="true">🟢</span>
                  <div className="people-stat-info">
                    <strong>{stats.alive}</strong>
                    <small>Амьд сэрүүн</small>
                  </div>
                </div>
                <div className="people-stat-card">
                  <span className="people-stat-icon" aria-hidden="true">🕊️</span>
                  <div className="people-stat-info">
                    <strong>{stats.deceased}</strong>
                    <small>Мөнхөрсөн</small>
                  </div>
                </div>
                {currentUser && (
                  <div className="people-stat-card" style={{ borderColor: stats.mine > 0 ? '#d97706' : undefined }}>
                    <span className="people-stat-icon" aria-hidden="true">✨</span>
                    <div className="people-stat-info">
                      <strong style={{ color: '#d97706' }}>{stats.mine}</strong>
                      <small>Таны нэмсэн</small>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Ownership Fast Tabs */}
            {currentUser && (
              <div className="people-ownership-tabs" role="tablist" aria-label="Гишүүдийг эрхээр шүүх">
                <button
                  type="button"
                  className={`people-ownership-tab ${ownershipFilter === 'all' ? 'is-active' : ''}`}
                  onClick={() => setOwnershipFilter('all')}
                >
                  Бүгд ({people?.items.length ?? 0})
                </button>
                <button
                  type="button"
                  className={`people-ownership-tab ${ownershipFilter === 'mine' ? 'is-active' : ''}`}
                  onClick={() => setOwnershipFilter('mine')}
                >
                  ✨ Миний нэмсэн ({stats.mine})
                </button>
                {currentUser.person_id && (
                  <button
                    type="button"
                    className={`people-ownership-tab ${ownershipFilter === 'self' ? 'is-active' : ''}`}
                    onClick={() => setOwnershipFilter('self')}
                  >
                    👑 Миний профайл
                  </button>
                )}
                <button
                  type="button"
                  className={`people-ownership-tab ${ownershipFilter === 'readonly' ? 'is-active' : ''}`}
                  onClick={() => setOwnershipFilter('readonly')}
                >
                  🔒 Зөвхөн харах
                </button>
              </div>
            )}

            <section className="people-toolbar card" aria-label="Хүмүүсийн хайлт ба шүүлтүүр">
              <div className="people-toolbar-top">
                <label className="people-search">
                  <span>Хүн хайх</span>
                  <input
                    id="people-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Овог, нэрээр хайх…"
                    autoComplete="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    aria-label="Гэр бүлийн хүн хайх"
                  />
                </label>

                <div className="people-view-toggle" role="group" aria-label="Харагдацын горим">
                  <button
                    type="button"
                    className={viewMode === 'grid' ? 'is-active' : ''}
                    onClick={() => setViewMode('grid')}
                    title="Карт горим"
                  >
                    ▦ Карт
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'table' ? 'is-active' : ''}
                    onClick={() => setViewMode('table')}
                    title="Жагсаалт хүснэгт горим"
                  >
                    ▤ Хүснэгт
                  </button>
                </div>
              </div>

              <div className="people-filters-row">
                <label>
                  <span>Хүйс</span>
                  <select
                    value={genderFilter}
                    onChange={(e) => setGenderFilter(e.target.value as 'all' | 'male' | 'female')}
                  >
                    <option value="all">Бүх хүйс</option>
                    <option value="male">👨 Эрэгтэй</option>
                    <option value="female">👩 Эмэгтэй</option>
                  </select>
                </label>

                <label>
                  <span>Амьд сэрүүн эсэх</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as 'all' | 'alive' | 'deceased')}
                  >
                    <option value="all">Бүгд</option>
                    <option value="alive">🟢 Амьд сэрүүн</option>
                    <option value="deceased">🕊️ Мөнхөрсөн</option>
                  </select>
                </label>

                <label>
                  <span>Үе дамжлага</span>
                  <select
                    value={generationFilter}
                    onChange={(e) =>
                      setGenerationFilter(
                        e.target.value as 'all' | 'ancestor' | 'parent' | 'current' | 'youth',
                      )
                    }
                  >
                    <option value="all">Бүх үе</option>
                    <option value="ancestor">👴 Өвөг дээдэс (&lt; 1960)</option>
                    <option value="parent">👨‍👩‍👧 Эцэг эхийн үе (1960–1985)</option>
                    <option value="current">🧑 Бидний үе (1986–2005)</option>
                    <option value="youth">👶 Бага нас, үр хүүхэд (2006+)</option>
                  </select>
                </label>

                <label>
                  <span>Удам угсаа</span>
                  <select
                    value={lineageId}
                    onChange={(event) => setLineageId(event.target.value)}
                  >
                    <option value="">Бүх удам</option>
                    {lineages.map((item) => (
                      <option value={item.id} key={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Салаа</span>
                  <select
                    value={branchId}
                    onChange={(event) => setBranchId(event.target.value)}
                    disabled={!lineageId}
                  >
                    <option value="">{lineageId ? 'Бүх салаа' : 'Удам сонгоно уу'}</option>
                    {branches.map((item) => (
                      <option value={item.id} key={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>

                {hasFilters && (
                  <button
                    type="button"
                    className="people-clear-btn"
                    onClick={clearFilters}
                    title="Шүүлтүүрийг анхны байдалд оруулах"
                  >
                    ✕ Шүүлтүүр цэвэрлэх
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        {metaError && family && (
          <div className="error people-error" role="alert">
            <span>{metaError}</span>
            <button
              type="button"
              onClick={() => void (lineageId ? loadBranches(familyId, lineageId) : loadLineages(familyId))}
              disabled={metaBusy}
            >
              {metaBusy ? 'Шалгаж байна…' : 'Дахин оролдох'}
            </button>
          </div>
        )}

        {loading && !people ? (
          <section className="people-state card" aria-live="polite">
            <span className="people-spinner" aria-hidden="true" />
            <p>Гэр бүлийн хүмүүсийг ачаалж байна…</p>
          </section>
        ) : !families.length ? (
          <section className="people-state card">
            <h2>Гэр бүл олдсонгүй.</h2>
            <p>Танд одоогоор хандах эрхтэй гэр бүл алга байна.</p>
            <Link className="button" href="/families">Гэр бүлүүд</Link>
          </section>
        ) : filteredItems.length === 0 ? (
          <section className="people-state card">
            <div className="people-empty-avatar personavatar" aria-hidden="true">?</div>
            <h2>
              {hasFilters ? 'Таны хайлт ба шүүлтүүрт тохирох хүн олдсонгүй.' : 'Одоогоор бүртгэгдсэн хүн алга.'}
            </h2>
            <p>
              {hasFilters
                ? 'Хайлтын үг, хүйс, үе дамжлага, эсвэл эрхийн шүүлтүүрээ өөрчилж дахин үзээрэй.'
                : 'Таны эрхтэй энэ гэр бүлийн орчинд одоогоор бүртгэгдсэн хүн алга.'}
            </p>
            {hasFilters && (
              <button type="button" className="button" onClick={clearFilters}>
                Шүүлтүүрийг цэвэрлэх
              </button>
            )}
          </section>
        ) : (
          <>
            <div className="people-results-head" aria-live="polite">
              <strong>{filteredItems.length} хүн харуулж байна (нийт {people?.total ?? 0})</strong>
              {busy && <span role="status">Шинэчилж байна…</span>}
            </div>

            {viewMode === 'grid' ? (
              <div className="people-grid" aria-busy={busy}>
                {filteredItems.map((person) => {
                  const isMale = person.gender === 'male';
                  const isFemale = person.gender === 'female';
                  return (
                    <article
                      className={`card people-card ${isMale ? 'is-male' : isFemale ? 'is-female' : ''}`}
                      key={person.id}
                    >
                      <div className="people-card-top">
                        <div className="people-avatar-wrap">
                          <span
                            className={`personavatar people-avatar ${isMale ? 'is-male-avatar' : isFemale ? 'is-female-avatar' : ''}`}
                            aria-hidden="true"
                          >
                            {initials(person)}
                          </span>
                          {person.is_alive ? (
                            <span className="tree-alive-beacon" title="Амьд сэрүүн" />
                          ) : (
                            <span className="tree-deceased-beacon" title="Мөнхөрсөн">🕊️</span>
                          )}
                        </div>

                        <div className="people-card-identity">
                          <h2>{personName(person) || 'Нэргүй хүн'}</h2>
                          <span className="people-card-dates">{lifeSummary(person)}</span>
                          <span className="people-card-gender-pill">
                            {isMale ? '👨 Эрэгтэй' : isFemale ? '👩 Эмэгтэй' : 'Хүйс тодорхойгүй'}
                          </span>
                        </div>
                      </div>

                      <div className="people-card-tags">
                        {person.lineage_name ? (
                          <span className="tag">{person.lineage_name}</span>
                        ) : (
                          <span className="tag is-unassigned">Удам хуваарилагдаагүй</span>
                        )}
                        {person.branch_name && (
                          <span className="people-secondary-tag">{person.branch_name}</span>
                        )}
                      </div>

                      <div style={{ margin: '2px 0 4px' }}>
                        {person.id === currentUser?.person_id ? (
                          <span className="people-badge is-self">👑 Миний профайл</span>
                        ) : person.created_by === currentUser?.id ? (
                          <span className="people-badge is-creator">✨ Миний нэмсэн</span>
                        ) : person.can_edit ? (
                          <span className="people-badge is-admin">🛡️ Админ удирдлага</span>
                        ) : (
                          <span className="people-badge is-locked">🔒 Зөвхөн харах</span>
                        )}
                      </div>

                      {person.short_description && (
                        <p className="people-description">{person.short_description}</p>
                      )}

                      <div className="people-card-actions">
                        <Link
                          className="people-action-btn is-tree"
                          href={`/tree?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                          title="Ургийн модонд харах"
                        >
                          🌳 Модонд харах
                        </Link>
                        <Link
                          className="people-action-btn is-profile"
                          href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                          title="Профайл дэлгэрэнгүй үзэх"
                        >
                          Профайл →
                        </Link>
                        {person.can_edit && (
                          <Link
                            className="people-action-btn is-edit"
                            href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}#edit`}
                            title="Мэдээлэл засах"
                          >
                            ✏️ Засах
                          </Link>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="people-table-wrap card">
                <table className="people-table">
                  <thead>
                    <tr>
                      <th>Хүн</th>
                      <th>Хүйс</th>
                      <th>Нас / Огноо</th>
                      <th>Төлөв</th>
                      <th>Удам угсаа</th>
                      <th>Салаа</th>
                      <th style={{ textAlign: 'right' }}>Үйлдлүүд</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((person) => {
                      const isMale = person.gender === 'male';
                      const isFemale = person.gender === 'female';
                      return (
                        <tr key={person.id} className={isMale ? 'row-male' : isFemale ? 'row-female' : ''}>
                          <td>
                            <div className="people-table-person">
                              <span className={`personavatar small ${isMale ? 'is-male-avatar' : isFemale ? 'is-female-avatar' : ''}`}>
                                {initials(person)}
                              </span>
                              <div>
                                <strong>{personName(person) || 'Нэргүй хүн'}</strong>
                                {person.middle_name && <small>{person.middle_name}</small>}
                                <div style={{ marginTop: '2px' }}>
                                  {person.id === currentUser?.person_id ? (
                                    <span className="people-badge is-self" style={{ fontSize: '9px', padding: '1px 5px' }}>👑 Өөрөө</span>
                                  ) : person.created_by === currentUser?.id ? (
                                    <span className="people-badge is-creator" style={{ fontSize: '9px', padding: '1px 5px' }}>✨ Миний нэмсэн</span>
                                  ) : person.can_edit ? (
                                    <span className="people-badge is-admin" style={{ fontSize: '9px', padding: '1px 5px' }}>🛡️ Админ</span>
                                  ) : (
                                    <span className="people-badge is-locked" style={{ fontSize: '9px', padding: '1px 5px' }}>🔒 Харах</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="people-table-gender">
                              {isMale ? 'Эрэгтэй' : isFemale ? 'Эмэгтэй' : '—'}
                            </span>
                          </td>
                          <td>
                            <span className="people-table-dates">{lifeSummary(person)}</span>
                          </td>
                          <td>
                            {person.is_alive ? (
                              <span className="people-status-pill is-alive">Амьд сэрүүн</span>
                            ) : (
                              <span className="people-status-pill is-deceased">🕊️ Мөнхөрсөн</span>
                            )}
                          </td>
                          <td>
                            <span className="people-table-lineage">{person.lineage_name || '—'}</span>
                          </td>
                          <td>
                            <span className="people-table-branch">{person.branch_name || '—'}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="people-table-actions">
                              <Link
                                className="people-table-link is-tree"
                                href={`/tree?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                                title="Модонд харах"
                              >
                                🌳 Модонд
                              </Link>
                              <Link
                                className="people-table-link is-profile"
                                href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                                title="Профайл үзэх"
                              >
                                Профайл →
                              </Link>
                              {person.can_edit && (
                                <Link
                                  className="people-table-link is-edit"
                                  href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}#edit`}
                                  title="Засах"
                                >
                                  ✏️ Засах
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="people-pagination">
              <span>Нийт {people?.total ?? 0} хүнээс хуудас {people?.page ?? 1}</span>
              {people?.has_next && (
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    void loadPeople(
                      familyId,
                      query,
                      lineageId,
                      branchId,
                      genderFilter,
                      statusFilter,
                      (people?.page ?? 1) + 1,
                    )
                  }
                  disabled={busy}
                >
                  Дараагийн 24 хүн →
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default function PeoplePage() {
  return (
    <Suspense
      fallback={
        <main className="people-page">
          <section className="people-shell people-state card" aria-live="polite">
            <span className="people-spinner" aria-hidden="true" />
            <p>Хүмүүсийг ачаалж байна…</p>
          </section>
        </main>
      }
    >
      <PeoplePageContent />
    </Suspense>
  );
}
