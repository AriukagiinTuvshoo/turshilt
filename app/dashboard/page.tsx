'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BookOpen,
  GitFork,
  Heart,
  Search,
  TreeDeciduous,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  api,
  ArchiveListPage,
  Family,
  Marriage,
  MemoryListItem,
  Person,
  PersonSearchPage,
  StoryListPage,
  TreeData,
  TreePerson,
  User,
  personName,
} from '../../lib/api';

type TreeNode = {
  id: string;
  person: TreePerson;
  generation: number;
  parents: string[];
  children: string[];
  spouses: string[];
};

type PreviewTree = {
  rootId: string | null;
  nodes: Map<string, TreeNode>;
  marriages: Marriage[];
};

type ActivityItem =
  | { kind: 'story'; id: string; title: string; date: string; meta: string }
  | { kind: 'memory'; id: string; title: string; date: string; meta: string }
  | { kind: 'archive'; id: string; title: string; date: string; meta: string };

function initials(person: Pick<Person, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function fullName(person: Pick<Person, 'first_name' | 'last_name' | 'middle_name'>) {
  return personName(person) || 'Нэргүй хүн';
}

function generationLabel(generation: number) {
  if (generation === 0) return 'Төв хүн';
  if (generation < 0) return Math.abs(generation) + ' үеийн өмнө';
  return generation + ' үеийн үргэлжлэл';
}

function buildPreviewTree(tree: TreeData, preferredRootId: string | null): PreviewTree {
  const personById = new Map<string, TreePerson>();
  for (const person of tree.persons) personById.set(person.id, person);

  const nodes = new Map<string, TreeNode>();
  for (const person of personById.values()) {
    nodes.set(person.id, {
      id: person.id,
      person,
      generation: 0,
      parents: [],
      children: [],
      spouses: [],
    });
  }

  const marriages = tree.marriages.filter(
    (marriage) => personById.has(marriage.person_1_id) && personById.has(marriage.person_2_id),
  );

  for (const edge of tree.parent_child_relationships) {
    if (!nodes.has(edge.parent_id) || !nodes.has(edge.child_id)) continue;
    nodes.get(edge.parent_id)?.children.push(edge.child_id);
    nodes.get(edge.child_id)?.parents.push(edge.parent_id);
  }

  for (const marriage of marriages) {
    nodes.get(marriage.person_1_id)?.spouses.push(marriage.person_2_id);
    nodes.get(marriage.person_2_id)?.spouses.push(marriage.person_1_id);
  }

  const rootId =
    (preferredRootId && nodes.has(preferredRootId) ? preferredRootId : null) ??
    (tree.root_person_id && nodes.has(tree.root_person_id) ? tree.root_person_id : null) ??
    [...nodes.keys()][0] ??
    null;

  if (!rootId) return { rootId: null, nodes, marriages };

  nodes.get(rootId)!.generation = 0;
  const queue = [rootId];
  const seen = new Set([rootId]);

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) break;
    const current = nodes.get(currentId);
    if (!current) continue;

    for (const parentId of current.parents) {
      const parent = nodes.get(parentId);
      if (!parent) continue;
      parent.generation = Math.min(parent.generation, current.generation - 1);
      if (!seen.has(parentId)) {
        seen.add(parentId);
        queue.push(parentId);
      }
    }

    for (const spouseId of current.spouses) {
      const spouse = nodes.get(spouseId);
      if (!spouse) continue;
      spouse.generation = current.generation;
      if (!seen.has(spouseId)) {
        seen.add(spouseId);
        queue.push(spouseId);
      }
    }

    for (const childId of current.children) {
      const child = nodes.get(childId);
      if (!child) continue;
      child.generation = Math.max(child.generation, current.generation + 1);
      if (!seen.has(childId)) {
        seen.add(childId);
        queue.push(childId);
      }
    }
  }

  return { rootId, nodes, marriages };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('mn-MN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function activityDate(value: string | null | undefined) {
  return value ? value : '';
}

function activityMeta(kind: ActivityItem['kind'], item: ActivityItem) {
  if (kind === 'story') return item.meta || 'Манай түүх';
  if (kind === 'memory') return item.meta || 'Дурсамж';
  return item.meta || 'Архив';
}

function QuickAction({
  icon: Icon,
  label,
  href,
  description,
}: {
  icon: typeof Users;
  label: string;
  href: string;
  description: string;
}) {
  return (
    <Link className="homev2-quick-action" href={href}>
      <span className="homev2-quick-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

function TreePreview({
  tree,
  familyId,
  onOpenProfile,
}: {
  tree: PreviewTree;
  familyId: string;
  onOpenProfile: (personId: string) => void;
}) {
  const allNodes = useMemo(() => [...tree.nodes.values()], [tree]);

  const generationGroups = useMemo(() => {
    const ancestors: TreeNode[] = [];
    const current: TreeNode[] = [];
    const descendants: TreeNode[] = [];

    const sorted = [...allNodes].sort((a, b) => {
      const bA = a.person.birth_date || '9999';
      const bB = b.person.birth_date || '9999';
      return bA.localeCompare(bB);
    });

    for (const node of sorted) {
      if (node.generation < 0) {
        if (ancestors.length < 4) ancestors.push(node);
      } else if (node.generation === 0) {
        if (current.length < 4) current.push(node);
      } else {
        if (descendants.length < 4) descendants.push(node);
      }
    }

    return { ancestors, current, descendants };
  }, [allNodes]);

  if (!allNodes.length) {
    return (
      <div className="homev2-tree-empty">
        <TreeDeciduous size={34} aria-hidden="true" />
        <h3>Удмын мод одоогоор хоосон байна</h3>
        <p>Гэр бүлийн хүмүүсээ нэмээд модоо бага багаар ургуулж эхлээрэй.</p>
        <Link className="homev2-button homev2-button--light" href={'/people?family=' + encodeURIComponent(familyId)}>
          Хүмүүс рүү очих
        </Link>
      </div>
    );
  }

  const renderTier = (title: string, subtitle: string, nodes: TreeNode[], icon: string) => {
    if (!nodes.length) return null;
    return (
      <div className="dashboard-gen-tier">
        <div className="dashboard-gen-tier-label">
          <span>{icon}</span>
          <strong>{title}</strong>
          <small>({subtitle})</small>
        </div>
        <div className="dashboard-gen-grid">
          {nodes.map((node) => {
            const p = node.person;
            const isMale = p.gender === 'male';
            const isFemale = p.gender === 'female';
            return (
              <button
                key={node.id}
                type="button"
                className={`dashboard-person-card ${isMale ? 'is-male' : isFemale ? 'is-female' : ''}`}
                onClick={() => onOpenProfile(node.id)}
              >
                <div className={`dashboard-person-avatar ${isMale ? 'is-male-avatar' : isFemale ? 'is-female-avatar' : ''}`}>
                  {initials(p)}
                </div>
                <div className="dashboard-person-info">
                  <h4 className="dashboard-person-name">{fullName(p)}</h4>
                  <div className="dashboard-person-dates">
                    {p.birth_date?.slice(0, 4) || '—'} {p.is_alive ? '– одоо' : `– ${p.death_date?.slice(0, 4) || '?'}`}
                  </div>
                  {p.lineage_name && (
                    <span className="dashboard-person-tag">{p.lineage_name}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-tree-showcase">
      <div className="dashboard-tree-header">
        <div>
          <p className="homev2-eyebrow">ҮЕИЙН ХОЛБООС БА САЛАА МӨЧРҮҮД</p>
          <h2>Удмын модны хураангуй тойм</h2>
          <p>Гишүүдийн картан дээр дарж тухайн хүний дэлгэрэнгүй намтар, зураг, он цагийн хэлхээсийг харна уу.</p>
        </div>
        <Link className="dashboard-primary-cta" style={{ padding: '8px 16px', fontSize: '12px' }} href={'/tree?family=' + encodeURIComponent(familyId)}>
          Бүтэн интерактив модоор аялах <ArrowRight size={14} />
        </Link>
      </div>

      <div className="dashboard-tree-content">
        {renderTier('Өвөг дээдсийн үе', 'Удам судар, язгуур үндэс', generationGroups.ancestors, '⭐')}
        {renderTier('Төв үеийн гишүүд', 'Гол салбар, хань, ахан дүүс', generationGroups.current, '👑')}
        {renderTier('Үр хойч, залуу үе', 'Хүүхдүүд, ач зээ нар', generationGroups.descendants, '🌱')}
      </div>

      <div className="dashboard-tree-footer-bar">
        <span>Нийт <strong>{allNodes.length}</strong> хүн бүртгэлтэй байна.</span>
        <Link href={'/tree?family=' + encodeURIComponent(familyId)} style={{ fontSize: '12px', fontWeight: 600, color: '#d97706', textDecoration: 'none' }}>
          Бүх үеийг бүтнээр дэлгэх →
        </Link>
      </div>
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const familyIdFromUrl = searchParams.get('family') ?? '';

  const [user, setUser] = useState<User | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [tree, setTree] = useState<TreeData>({ persons: [], parent_child_relationships: [], marriages: [] });
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [storyError, setStoryError] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<PersonSearchPage | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dashboardRequestRef = useRef(0);
  const searchRequestRef = useRef(0);

  const loadDashboard = useCallback(
    async (familyId: string, currentUser: User) => {
      const requestId = dashboardRequestRef.current;
      setRefreshing(true);
      setError('');
      setFamily(null);
      setPeople([]);
      setTree({ persons: [], parent_child_relationships: [], marriages: [] });
      setMemories([]);
      setMemoryCount(0);
      setStories(null);
      setArchives(null);
      setStoryError('');
      setArchiveError('');

      try {
        const [familyData, peopleData, treeData, memoryData] = await Promise.all([
          api<Family>('/families/' + familyId),
          api<Person[]>('/families/' + familyId + '/persons'),
          api<TreeData>('/families/' + familyId + '/tree?depth=5'),
          api<MemoryListItem[] | { items?: MemoryListItem[]; total?: number }>('/families/' + familyId + '/memories').catch(() => ({ items: [], total: 0 })),
        ]);

        if (requestId !== dashboardRequestRef.current) return null;
        setFamily(familyData);
        setPeople(peopleData);
        setTree(treeData);
        const rawMemories: MemoryListItem[] = Array.isArray(memoryData)
          ? memoryData
          : (memoryData?.items || []);
        const totalMemories: number = !Array.isArray(memoryData) && typeof memoryData?.total === 'number'
          ? memoryData.total
          : rawMemories.length;
        setMemoryCount(totalMemories);
        setMemories(rawMemories.slice(0, 6));

        const [storiesResult, archivesResult] = await Promise.all([
          api<StoryListPage>('/families/' + familyId + '/stories?page=1&page_size=4')
            .then((value) => ({ value, error: '' }))
            .catch((cause) => ({ value: null, error: cause instanceof ApiError && cause.status === 403 ? 'Түүхийн мэдээлэлд хандах эрхгүй байна.' : 'Түүхийн мэдээллийг ачаалж чадсангүй.' })),
          api<ArchiveListPage>('/families/' + familyId + '/archives?page=1&page_size=4')
            .then((value) => ({ value, error: '' }))
            .catch((cause) => ({ value: null, error: cause instanceof ApiError && cause.status === 403 ? 'Архивын мэдээлэлд хандах эрхгүй байна.' : 'Архивын мэдээллийг ачаалж чадсангүй.' })),
        ]);
        if (requestId !== dashboardRequestRef.current) return null;
        setStories(storiesResult.value);
        setArchives(archivesResult.value);
        setStoryError(storiesResult.error);
        setArchiveError(archivesResult.error);

        if (currentUser.person_id && peopleData.some((person) => person.id === currentUser.person_id)) {
          return currentUser.person_id;
        }
        return treeData.root_person_id && peopleData.some((person) => person.id === treeData.root_person_id)
          ? treeData.root_person_id
          : peopleData[0]?.id ?? null;
      } catch (cause) {
        if (requestId !== dashboardRequestRef.current) return null;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return null;
        }
        setError(cause instanceof Error ? cause.message : 'Гэр бүлийн мэдээллийг ачаалж чадсангүй.');
        return null;
      } finally {
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const requestId = ++dashboardRequestRef.current;
      setLoading(true);
      setError('');
      setFamily(null);
      setPeople([]);
      setTree({ persons: [], parent_child_relationships: [], marriages: [] });
      setMemories([]);
      setMemoryCount(0);
      setStories(null);
      setArchives(null);
      try {
        const [me, familyList] = await Promise.all([
          api<User>('/auth/me'),
          api<Family[]>('/families'),
        ]);
        if (!active) return;

        setUser(me);
        setFamilies(familyList);

        if (!familyList.length) {
          setFamily(null);
          return;
        }

        const requestedFamily = familyIdFromUrl
          ? familyList.find((item) => item.id === familyIdFromUrl) ?? null
          : null;
        if (familyIdFromUrl && !requestedFamily) {
          setFamily(null);
          setPeople([]);
          setTree({ persons: [], parent_child_relationships: [], marriages: [] });
          setMemories([]);
          setMemoryCount(0);
          setStories(null);
          setArchives(null);
          setError('Энэ гэр бүлийн орчинд хандах эрхгүй эсвэл гэр бүл олдсонгүй.');
          return;
        }
        const nextFamily = requestedFamily ?? familyList[0];
        await loadDashboard(nextFamily.id, me);

        if (active && !familyIdFromUrl) {
          router.replace('/dashboard?family=' + encodeURIComponent(nextFamily.id));
        }
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Нэвтрэлтийг шалгаж чадсангүй.');
      } finally {
        if (active && requestId === dashboardRequestRef.current) setLoading(false);
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [familyIdFromUrl, loadDashboard, router]);

  useEffect(() => {
    if (!family?.id || !search.trim()) {
      setSearchResults(null);
      setSearchBusy(false);
      return;
    }

    const timer = window.setTimeout(() => {
      const requestId = ++searchRequestRef.current;
      setSearchBusy(true);
      api<PersonSearchPage>(
        '/families/' +
          family.id +
          '/persons/search?q=' +
          encodeURIComponent(search.trim()) +
          '&page=1&page_size=10',
      )
        .then(setSearchResults)
        .catch((cause) => {
          if (cause instanceof ApiError && cause.status === 401) {
            router.replace('/login');
            return;
          }
          if (requestId === searchRequestRef.current) setSearchResults(null);
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) setSearchBusy(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      searchRequestRef.current += 1;
    };
  }, [family?.id, router, search]);

  const previewTree = useMemo(
    () => buildPreviewTree(tree, user?.person_id && people.some((person) => person.id === user.person_id) ? user.person_id : null),
    [people, tree, user?.person_id],
  );

  const activity = useMemo<ActivityItem[]>(() => {
    const result: ActivityItem[] = [];

    for (const item of stories?.items ?? []) {
      result.push({
        kind: 'story',
        id: item.id,
        title: item.title,
        date: activityDate(item.created_at),
        meta: item.author_name || 'Манай түүх',
      });
    }

    for (const item of memories) {
      result.push({
        kind: 'memory',
        id: item.id,
        title: item.title,
        date: activityDate(item.created_at),
        meta: item.person_names?.slice(0, 2).join(' · ') || 'Дурсамж',
      });
    }

    for (const item of archives?.items ?? []) {
      result.push({
        kind: 'archive',
        id: item.id,
        title: item.title,
        date: activityDate(item.created_at),
        meta: item.author_name || 'Архив',
      });
    }

    return result
      .filter((item) => item.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [archives, memories, stories]);

  function openProfile(personId: string) {
    if (!family) return;
    router.push('/profile?family=' + encodeURIComponent(family.id) + '&person=' + encodeURIComponent(personId));
  }

  if (loading) {
    return (
      <main className="homev2-shell">
        <div className="homev2-loading" aria-busy="true" aria-live="polite">
          <div className="homev2-loading__line homev2-loading__line--wide" />
          <div className="homev2-loading__line" />
          <div className="homev2-loading__grid">
            <div className="homev2-loading__block" />
            <div className="homev2-loading__block" />
            <div className="homev2-loading__block" />
          </div>
          <span>Гэр бүлийн орон зайг ачаалж байна…</span>
        </div>
      </main>
    );
  }

  if (error && !families.length) {
    return (
      <main className="homev2-shell">
        <section className="homev2-state homev2-state--error" role="alert">
          <TreeDeciduous size={36} />
          <h1>Гэр бүлийн мэдээллийг ачаалж чадсангүй</h1>
          <p>Холболт эсвэл нэвтрэлтийн төлөвөө шалгаад дахин оролдоно уу.</p>
          <button className="homev2-button homev2-button--dark" onClick={() => window.location.reload()}>
            Дахин оролдох
          </button>
        </section>
      </main>
    );
  }

  if (!families.length) {
    return (
      <main className="homev2-shell">
        <section className="homev2-state">
          <TreeDeciduous size={42} />
          <p className="homev2-eyebrow">ГУУЛИНГИЙНХАН</p>
          <h1>Гэр бүлийн түүхээ эндээс эхлүүлээрэй.</h1>
          <p>Одоогоор танд харагдах гэр бүл алга. Эхлээд гэр бүлээ үүсгээд өөрийн хүмүүсээ нэмнэ.</p>
          <Link className="homev2-button homev2-button--dark" href="/onboarding">
            Гэр бүл үүсгэх
          </Link>
        </section>
      </main>
    );
  }

  return (
    <div className="homev2-app">
      <div className="homev2-layout">
        <main className="homev2-main">
          <div className="homev2-dashboard-toolbar" aria-label="Dashboard хэрэгслүүд">
            <div className="homev2-search">
              <Search size={17} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Гэр бүлийн хүн хайх…"
                aria-label="Гэр бүлийн хүн хайх"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Хайлтыг арилгах">
                  <X size={15} />
                </button>
              )}
              {search && (
                <div className="homev2-search-results">
                  {searchBusy ? (
                    <span aria-live="polite">Хайж байна…</span>
                  ) : searchResults?.items.length ? (
                    searchResults.items.map((result) => (
                      <button type="button" key={result.id} onClick={() => openProfile(result.id)}>
                        <span className="homev2-search-avatar">{result.name.slice(0, 2).toUpperCase()}</span>
                        <span>
                          <strong>{result.name}</strong>
                          <small>{result.birth_year ?? '—'}</small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <span>{searchResults ? 'Хүн олдсонгүй.' : 'Нэрээр хайж байна…'}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="homev2-inline-alert" role="alert">
              <span>{error}</span>
              <button onClick={() => window.location.reload()}>Дахин ачаалах</button>
            </div>
          )}

          {(storyError || archiveError) && (
            <div className="homev2-inline-alert" role="alert">
              <span>{[storyError, archiveError].filter(Boolean).join(' ')}</span>
              <button onClick={() => window.location.reload()}>Дахин ачаалах</button>
            </div>
          )}

          <section className="dashboard-hero-card">
            <div className="dashboard-hero-content">
              <div className="dashboard-hero-eyebrow">
                <span className="dashboard-calligraphy">ᠮᠣᠩᠭᠣᠯ ᠤᠷᠤᠭ ᠤᠨ ᠪᠢᠴᠢᠭ</span>
                <span>МАНАЙ ГЭР БҮЛИЙН ЦАХИМ ОРОН ЗАЙ</span>
              </div>
              <h1 className="dashboard-hero-title">{family?.name}</h1>
              <p className="dashboard-hero-subtitle">
                Өвөг дээдсийн үүх түүх, гэр бүлийн нандин дурсамж, ураг удмын хэлхээсийг нэгтгэсэн дижитал ургийн бичиг.
              </p>
              {user?.display_name && (
                <p className="dashboard-hero-greeting">
                  Тавтай морилно уу, <strong>{user.display_name}</strong>
                </p>
              )}

              <div className="dashboard-hero-stats">
                <div className="dashboard-hero-stat">
                  <strong>{people.length}</strong>
                  <span>Бүртгэлтэй хүн</span>
                </div>
                <div className="dashboard-hero-stat">
                  <strong>{tree.marriages.length}</strong>
                  <span>Гэрлэлтийн холбоо</span>
                </div>
                <div className="dashboard-hero-stat">
                  <strong>{memoryCount}</strong>
                  <span>Түүхэн дурсамж</span>
                </div>
                <div className="dashboard-hero-stat">
                  <strong>{stories?.total ?? 0}</strong>
                  <span>Өв сургаал, түүх</span>
                </div>
              </div>

              <div className="dashboard-hero-actions">
                <Link
                  className="dashboard-primary-cta"
                  href={'/tree?family=' + encodeURIComponent(family?.id ?? '')}
                >
                  <TreeDeciduous size={18} /> Удмын модонд зочлох <ArrowRight size={16} />
                </Link>
                <Link
                  className="dashboard-secondary-cta"
                  href={'/people?family=' + encodeURIComponent(family?.id ?? '')}
                >
                  <Users size={16} /> Хүмүүсийн сан
                </Link>
                <Link
                  className="dashboard-secondary-cta"
                  href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}
                >
                  <Heart size={16} /> Дурсамж &amp; Зураг
                </Link>
              </div>
            </div>
          </section>

          <TreePreview tree={previewTree} familyId={family?.id ?? ''} onOpenProfile={openProfile} />

          <section className="homev2-grid homev2-grid--split">
            <div className="homev2-panel">
              <div className="homev2-section-header homev2-section-header--compact">
                <div>
                  <p className="homev2-eyebrow">БҮХИЙ Л ЗҮЙЛ НЭГ ДОР</p>
                  <h2>Хурдан үйлдлүүд</h2>
                </div>
              </div>
              <div className="homev2-actions">
                <QuickAction icon={Users} label="Хүмүүс" description="Гэр бүлийн хүмүүс" href={'/people?family=' + encodeURIComponent(family?.id ?? '')} />
                <QuickAction icon={GitFork} label="Удмын мод" description="Бүх холбоосууд" href={'/tree?family=' + encodeURIComponent(family?.id ?? '')} />
                <QuickAction icon={BookOpen} label="Манай түүх" description="Түүх, үйл явдлууд" href={'/stories?family=' + encodeURIComponent(family?.id ?? '')} />
                <QuickAction icon={Heart} label="Дурсамж" description="Гэр бүлийн дурсамж" href={'/memories?family=' + encodeURIComponent(family?.id ?? '')} />
                <QuickAction icon={Archive} label="Архив" description="Баримтын metadata" href={'/archives?family=' + encodeURIComponent(family?.id ?? '')} />
              </div>
            </div>

            <div className="homev2-panel homev2-panel--snapshot">
              <div className="homev2-section-header homev2-section-header--compact">
                <div>
                  <p className="homev2-eyebrow">FAMILY SNAPSHOT</p>
                  <h2>Манай гэр бүл</h2>
                </div>
              </div>
              <div className="homev2-stats">
                <div><strong>{people.length}</strong><span>Хүн</span></div>
                <div><strong>{stories?.total ?? '—'}</strong><span>Түүх</span></div>
                <div><strong>{memoryCount}</strong><span>Дурсамж</span></div>
                <div><strong>{archives?.total ?? '—'}</strong><span>Архив</span></div>
              </div>
            </div>
          </section>

          <section className="homev2-panel" aria-labelledby="recent-title">
            <div className="homev2-section-header">
              <div>
                <p className="homev2-eyebrow">RECENT</p>
                <h2 id="recent-title">Сүүлийн үеийн</h2>
                <p>Одоогийн family context дээрх бодит агуулгаас.</p>
              </div>
              <div className="homev2-recent-links">
                <Link href={'/stories?family=' + encodeURIComponent(family?.id ?? '')}>Түүх <ArrowRight size={14} /></Link>
                <Link href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}>Дурсамж <ArrowRight size={14} /></Link>
                <Link href={'/archives?family=' + encodeURIComponent(family?.id ?? '')}>Архив <ArrowRight size={14} /></Link>
              </div>
            </div>

            {activity.length ? (
              <div className="homev2-activity">
                {activity.map((item) => {
                  const href =
                    item.kind === 'story'
                      ? '/stories/' + encodeURIComponent(item.id) + '?family=' + encodeURIComponent(family?.id ?? '')
                      : item.kind === 'archive'
                        ? '/archives/' + encodeURIComponent(item.id) + '?family=' + encodeURIComponent(family?.id ?? '')
                        : '/memories?family=' + encodeURIComponent(family?.id ?? '');

                  const icon = item.kind === 'story' ? <BookOpen size={17} /> : item.kind === 'archive' ? <Archive size={17} /> : <Heart size={17} />;

                  return (
                    <Link className="homev2-activity-item" href={href} key={item.kind + '-' + item.id}>
                      <span className="homev2-activity-icon" aria-hidden="true">{icon}</span>
                      <span className="homev2-activity-copy">
                        <strong>{item.title}</strong>
                        <small>{activityMeta(item.kind, item)} · {formatDate(item.date)}</small>
                      </span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="homev2-empty-content">
                <Heart size={26} aria-hidden="true" />
                <strong>Одоогоор энд мэдээлэл алга.</strong>
                <span>Гэр бүлийн түүхээ бага багаар нэмээрэй.</span>
              </div>
            )}
          </section>

          <section className="homev2-grid homev2-grid--content">
            <div className="homev2-panel">
              <div className="homev2-section-header homev2-section-header--compact">
                <div>
                  <p className="homev2-eyebrow">MEMORIES</p>
                  <h2>Сүүлийн дурсамж</h2>
                </div>
                <Link className="homev2-text-link" href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}>
                  Бүгдийг харах <ArrowRight size={14} />
                </Link>
              </div>
              {memories.length ? (
                <div className="homev2-list">
                  {memories.slice(0, 4).map((memory) => (
                    <Link className="homev2-list-row" key={memory.id} href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}>
                      <span className="homev2-list-icon" aria-hidden="true"><Heart size={16} /></span>
                      <span><strong>{memory.title}</strong><small>{memory.memory_date ?? 'Огноогүй'}</small></span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="homev2-empty-content homev2-empty-content--small">
                  <strong>Одоогоор хадгалсан дурсамж алга.</strong>
                  <Link className="homev2-text-link" href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}>Дурсамж руу очих</Link>
                </div>
              )}
            </div>

            <div className="homev2-panel">
              <div className="homev2-section-header homev2-section-header--compact">
                <div>
                  <p className="homev2-eyebrow">YOUR PLACE</p>
                  <h2>Эндээс үргэлжлүүлээрэй</h2>
                </div>
              </div>
              {user?.person_id && people.some((person) => person.id === user.person_id) ? (
                <div className="homev2-continue">
                  <span className="homev2-continue-avatar">
                    {initials({ first_name: user.display_name, last_name: '' })}
                  </span>
                  <div>
                    <strong>{people.find((person) => person.id === user.person_id)?.first_name ? fullName(people.find((person) => person.id === user.person_id)!) : user.display_name}</strong>
                    <span>Таны family profile</span>
                  </div>
                  <button className="homev2-button homev2-button--dark" onClick={() => openProfile(user.person_id!)}>
                    Профайл <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="homev2-empty-content homev2-empty-content--small">
                  <strong>Таны profile энэ family-д холбогдоогүй байна.</strong>
                  <Link className="homev2-text-link" href={'/people?family=' + encodeURIComponent(family?.id ?? '')}>Хүмүүс рүү очих</Link>
                </div>
              )}
            </div>
          </section>

          {notice && (
            <div className="homev2-toast" role="status">
              <span>{notice}</span>
              <button onClick={() => setNotice('')} aria-label="Мэдэгдлийг хаах"><X size={14} /></button>
            </div>
          )}

          {refreshing && <div className="homev2-refresh" role="status">Шинэчилж байна…</div>}
        </main>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="homev2-shell">
          <div className="homev2-loading"><span>Гэр бүлийн орон зайг ачаалж байна…</span></div>
        </main>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
