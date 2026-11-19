'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  api,
  ArchiveListPage,
  Family,
  Marriage,
  MemoryListItem,
  PersonProfile,
  StoryListPage,
  ProfileRelationPerson,
  User,
  personName,
  OralHistoryExtractOut,
} from '../../lib/api';
import { ConfirmDialog } from '../../components/confirm-dialog';

const EVENT_TYPE_MAP: Record<string, { label: string; icon: string }> = {
  birth: { label: 'Төрсөн', icon: '👶' },
  school: { label: 'Сургууль, боловсрол', icon: '🎓' },
  career: { label: 'Ажил, алба', icon: '💼' },
  work: { label: 'Ажил, алба', icon: '💼' },
  marriage: { label: 'Гэрлэлт', icon: '💍' },
  divorce: { label: 'Салалт', icon: '💔' },
  child_birth: { label: 'Хүүхэд төрсөн', icon: '👶' },
  award: { label: 'Шагнал, цол', icon: '🏆' },
  move: { label: 'Нүүдэл, шилжилт', icon: '📍' },
  relocation: { label: 'Нүүдэл, шилжилт', icon: '📍' },
  military: { label: 'Цэргийн алба', icon: '🎖️' },
  other: { label: 'Бусад үйл явдал', icon: '📜' },
};

function calculateAge(birthDate: string | null, deathDate: string | null, isAlive: boolean) {
  if (!birthDate) return null;
  const bYear = parseInt(birthDate.slice(0, 4), 10);
  if (isNaN(bYear)) return null;
  const endYear = (!isAlive && deathDate) ? parseInt(deathDate.slice(0, 4), 10) : new Date().getFullYear();
  if (isNaN(endYear) || endYear < bYear) return null;
  return endYear - bYear;
}

type EventItem = {
  id: string;
  event_type: string;
  title: string;
  event_date: string | null;
  description: string | null;
};

function relationName(person: ProfileRelationPerson) {
  return personName(person) || 'Нэргүй хүн';
}

function relationLife(person: ProfileRelationPerson) {
  const birth = person.birth_date?.slice(0, 4);
  const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return person.is_alive ? `${birth} – одоо` : `${birth} – тодорхойгүй`;
  return 'Огноо тодорхойгүй';
}

function initials(person: Pick<ProfileRelationPerson, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function ProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const profileRequestRef = useRef(0);
  const memoryRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const profileAbortRef = useRef<AbortController | null>(null);

  const [mutationBusy, setMutationBusy] = useState(false);
  const [family, setFamily] = useState('');
  const [id, setId] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [familyRole, setFamilyRole] = useState<'owner' | 'editor' | 'member'>('member');
  const [person, setPerson] = useState<PersonProfile | null>(null);
  const [biography, setBiography] = useState('');
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [memoryState, setMemoryState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [memoryError, setMemoryError] = useState('');
  const [biographyState, setBiographyState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [eventState, setEventState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [marriageState, setMarriageState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [storyState, setStoryState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [archiveState, setArchiveState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'relationships' | 'oral_history' | 'memories'>('overview');
  const [oralNarrative, setOralNarrative] = useState('');
  const [oralAutoEvents, setOralAutoEvents] = useState(true);
  const [oralAutoBio, setOralAutoBio] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractedResult, setExtractedResult] = useState<OralHistoryExtractOut | null>(null);

  async function load(fid: string, pid: string, requestId?: number) {
    profileAbortRef.current?.abort();
    const controller = new AbortController();
    profileAbortRef.current = controller;
    const signal = controller.signal;

    setBiographyState('loading');
    setEventState('loading');
    setMarriageState('loading');
    setStoryState('loading');
    setArchiveState('loading');

    const [profile, me, familyList] = await Promise.all([
      api<PersonProfile>(`/families/${fid}/persons/${pid}`, { signal }),
      api<User>('/auth/me', { signal }).catch(() => null),
      api<Family[]>('/families', { signal }).catch(() => []),
    ]);

    if (requestId !== undefined && requestId !== profileRequestRef.current) return;

    setPerson(profile);
    if (me) setCurrentUser(me);
    const currentF = familyList.find((f) => f.id === fid);
    if (currentF && (currentF.role === 'owner' || currentF.role === 'editor' || currentF.role === 'member')) {
      setFamilyRole(currentF.role as 'owner' | 'editor' | 'member');
    }
    setLoading(false);

    const [bio, eventList, marriageList, storyPage, archivePage] = await Promise.allSettled([
      api<{ content: string }>(`/families/${fid}/persons/${pid}/biography`, { signal }),
      api<EventItem[]>(`/families/${fid}/persons/${pid}/events`, { signal }),
      api<Marriage[]>(`/families/${fid}/persons/${pid}/marriages`, { signal }),
      api<StoryListPage>(`/families/${fid}/stories?page=1&page_size=5&person_id=${encodeURIComponent(pid)}`, { signal }),
      api<ArchiveListPage>(`/families/${fid}/persons/${pid}/archives?page=1&page_size=5`, { signal }),
    ]);

    if (requestId !== undefined && requestId !== profileRequestRef.current) return;

    if (bio.status === 'fulfilled') {
      setBiography(bio.value.content);
      setBiographyState('ready');
    } else if (bio.reason instanceof ApiError && [403, 404].includes(bio.reason.status)) {
      setBiography('');
      setBiographyState('restricted');
    } else {
      setBiographyState('error');
    }

    if (eventList.status === 'fulfilled') {
      setEvents(eventList.value);
      setEventState('ready');
    } else if (eventList.reason instanceof ApiError && [403, 404].includes(eventList.reason.status)) {
      setEvents([]);
      setEventState('restricted');
    } else {
      setEventState('error');
    }

    if (marriageList.status === 'fulfilled') {
      setMarriages(marriageList.value);
      setMarriageState('ready');
    } else if (marriageList.reason instanceof ApiError && [403, 404].includes(marriageList.reason.status)) {
      setMarriages([]);
      setMarriageState('restricted');
    } else {
      setMarriageState('error');
    }

    if (storyPage.status === 'fulfilled') {
      setStories(storyPage.value);
      setStoryState('ready');
    } else if (storyPage.reason instanceof ApiError && [403, 404].includes(storyPage.reason.status)) {
      setStories(null);
      setStoryState('restricted');
    } else {
      setStoryState('error');
    }

    if (archivePage.status === 'fulfilled') {
      setArchives(archivePage.value);
      setArchiveState('ready');
    } else if (archivePage.reason instanceof ApiError && [403, 404].includes(archivePage.reason.status)) {
      setArchives(null);
      setArchiveState('restricted');
    } else {
      setArchiveState('error');
    }
  }

  useEffect(() => {
    const fid = searchParams.get('family') ?? '';
    const pid = searchParams.get('person') ?? '';
    const requestId = ++profileRequestRef.current;
    memoryRequestRef.current += 1;
    mutationRequestRef.current += 1;
    setFamily(fid);
    setId(pid);
    setPerson(null);
    setBiography('');
    setMarriages([]);
    setEvents([]);
    setStories(null);
    setArchives(null);
    setMemories([]);
    setMemoryState('loading');
    setMemoryError('');
    setBiographyState('loading');
    setEventState('loading');
    setMarriageState('loading');
    setStoryState('loading');
    setArchiveState('loading');
    setEditing(false);
    setMutationBusy(false);
    setNotice('');

    if (!fid || !pid) {
      setLoading(false);
      router.replace('/people');
      return;
    }

    setLoading(true);
    setError('');
    load(fid, pid, requestId)
      .catch((cause) => {
        if (requestId !== profileRequestRef.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(
          cause instanceof ApiError && [403, 404].includes(cause.status)
            ? 'Энэ хүний профайл олдсонгүй эсвэл харах эрхгүй байна.'
            : 'Профайлыг ачаалж чадсангүй. Дахин оролдоно уу.',
        );
      })
      .finally(() => {
        if (requestId === profileRequestRef.current) setLoading(false);
      });
  }, [router, searchParams]);

  useEffect(() => () => profileAbortRef.current?.abort(), []);

  async function loadMemories(fid: string, pid: string) {
    const requestId = ++memoryRequestRef.current;
    setMemoryState('loading');
    setMemoryError('');
    try {
      const result = await api<MemoryListItem[] | { items?: MemoryListItem[] }>(
        `/families/${fid}/persons/${pid}/memories`,
      );
      if (requestId !== memoryRequestRef.current) return;
      const arr = Array.isArray(result) ? result : (result?.items || []);
      setMemories(arr);
      setMemoryState('ready');
    } catch (cause) {
      if (requestId !== memoryRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) {
        setMemories([]);
        setMemoryState('restricted');
        setMemoryError('Энэ хүний дурсамжийн мэдээлэл одоогоор харагдахгүй байна.');
        return;
      }
      setMemoryState('error');
      setMemoryError('Дурсамжийг ачаалж чадсангүй. Дахин оролдоно уу.');
    }
  }

  async function retry() {
    if (!family || !id) return;
    const requestId = ++profileRequestRef.current;
    mutationRequestRef.current += 1;
    setLoading(true);
    setError('');
    setPerson(null);
    try {
      await load(family, id, requestId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(
        cause instanceof ApiError && [403, 404].includes(cause.status)
          ? 'Энэ хүний профайл олдсонгүй эсвэл харах эрхгүй байна.'
          : 'Профайлыг ачаалж чадсангүй. Дахин оролдоно уу.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!family || !id) return;
    void loadMemories(family, id);
  }, [family, id]);

  const isSelf = Boolean(currentUser?.person_id && person && currentUser.person_id === person.id);
  const isCreator = Boolean(currentUser?.id && person?.created_by && person.created_by === currentUser.id);
  const isAdmin = familyRole === 'owner' || familyRole === 'editor';
  const canEdit = person?.can_edit ?? (isAdmin || isSelf || isCreator);
  const canDelete = person?.can_delete ?? (isAdmin || isCreator);

  async function saveBiography(event: FormEvent) {
    event.preventDefault();
    if (!family || !id || mutationBusy || !canEdit) return;
    const requestId = profileRequestRef.current;
    const mutationId = ++mutationRequestRef.current;
    setMutationBusy(true);
    setError('');
    try {
      await api(`/families/${family}/persons/${id}/biography`, {
        method: 'PUT',
        body: JSON.stringify({ content: biography }),
      });
      if (requestId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      const refreshId = ++profileRequestRef.current;
      await load(family, id, refreshId);
      if (refreshId === profileRequestRef.current && mutationId === mutationRequestRef.current) setNotice('Намтар амжилттай хадгалагдлаа.');
    } catch (cause) {
      if (requestId === profileRequestRef.current && mutationId === mutationRequestRef.current) {
        setError(cause instanceof ApiError ? cause.message : 'Намтрыг хадгалж чадсангүй. Дахин оролдоно уу.');
      }
    } finally {
      if (mutationId === mutationRequestRef.current) setMutationBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!family || !id || mutationBusy || !canEdit) return;
    const requestId = profileRequestRef.current;
    const mutationId = ++mutationRequestRef.current;
    setMutationBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await api(`/families/${family}/persons/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          first_name: values.get('first_name'),
          last_name: values.get('last_name'),
          middle_name: values.get('middle_name') || null,
          nickname: values.get('nickname') || null,
          gender: values.get('gender'),
          birth_date: values.get('birth_date') || null,
          birth_place: values.get('birth_place') || null,
          is_alive: values.get('is_alive') === 'true',
          death_date: values.get('death_date') || null,
          death_place: values.get('death_place') || null,
          short_description: values.get('short_description') || null,
          profile_photo_url: values.get('profile_photo_url') || null,
          visibility: values.get('visibility'),
        }),
      });
      if (requestId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      const refreshId = ++profileRequestRef.current;
      await load(family, id, refreshId);
      if (refreshId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      setEditing(false);
      setNotice('Профайл амжилттай хадгалагдлаа.');
    } catch (cause) {
      if (requestId === profileRequestRef.current && mutationId === mutationRequestRef.current) {
        setError(cause instanceof ApiError ? cause.message : 'Профайлыг хадгалж чадсангүй. Дахин оролдоно уу.');
      }
    } finally {
      if (mutationId === mutationRequestRef.current) setMutationBusy(false);
    }
  }

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!family || !id || mutationBusy || !canEdit) return;
    const requestId = profileRequestRef.current;
    const mutationId = ++mutationRequestRef.current;
    setMutationBusy(true);
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api(`/families/${family}/persons/${id}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: form.get('event_type'),
          title: form.get('title'),
          event_date: form.get('event_date') || null,
          description: form.get('description') || null,
        }),
      });
      if (requestId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      const refreshId = ++profileRequestRef.current;
      await load(family, id, refreshId);
      if (refreshId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      formElement.reset();
      setNotice('Амьдралын үйл явдал амжилттай нэмэгдлээ.');
    } catch (cause) {
      if (requestId === profileRequestRef.current && mutationId === mutationRequestRef.current) {
        setError(cause instanceof ApiError ? cause.message : 'Үйл явдал нэмж чадсангүй. Дахин оролдоно уу.');
      }
    } finally {
      if (mutationId === mutationRequestRef.current) setMutationBusy(false);
    }
  }

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'warning' | 'primary';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Батлах',
    variant: 'danger',
    onConfirm: () => {},
  });

  function handleDeletePerson() {
    if (!person || !family || !canDelete) return;
    const confirmName = personName(person) || 'энэ хүн';
    const personIdToDelete = person.id;
    setConfirmState({
      isOpen: true,
      title: 'Хүнийг ургийн модноос салгах',
      message: `Та “${confirmName}” хүнийг энэ гэр бүлийн модноос салгахдаа итгэлтэй байна уу? (Хогийн савнаас 30 хоногийн дотор сэргээх боломжтой)`,
      confirmLabel: 'Салгах',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setMutationBusy(true);
        setError('');
        try {
          await api(`/families/${family}/persons/${personIdToDelete}`, { method: 'DELETE' });
          router.push(`/people?family=${encodeURIComponent(family)}`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Хүнийг устгаж чадсангүй.');
          setMutationBusy(false);
        }
      },
    });
  }

  async function handleExtractOral(e: FormEvent) {
    e.preventDefault();
    if (!family || !id || extracting || oralNarrative.trim().length < 10 || !canEdit) return;
    setExtracting(true);
    setError('');
    setNotice('');
    try {
      const res = await api<OralHistoryExtractOut>(
        `/families/${family}/persons/${id}/oral-history/extract`,
        {
          method: 'POST',
          body: JSON.stringify({
            narrative_text: oralNarrative.trim(),
            auto_create_events: oralAutoEvents,
            update_biography: oralAutoBio,
          }),
        },
      );
      setExtractedResult(res);
      if (oralAutoBio && res.biography_updated) {
        setBiography(res.suggested_biography);
      }
      if (oralAutoEvents && res.created_events_count > 0) {
        const refreshedEvents = await api<EventItem[]>(`/families/${family}/persons/${id}/events`);
        setEvents(refreshedEvents);
      }
      setNotice(
        `Аман түүхээс ${res.extracted_events.length} үйл явдал задлав. ${
          res.created_events_count ? `${res.created_events_count} үйл явдал он цагийн хэлхээсэнд нэмэгдлээ.` : ''
        }`,
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Аман түүх задлахад алдаа гарлаа.');
    } finally {
      setExtracting(false);
    }
  }

  function handleDeleteEvent(eventId: string) {
    if (!canDelete) return;
    setConfirmState({
      isOpen: true,
      title: 'Үйл явдал устгах',
      message: 'Та энэ амьдралын үйл явдлыг устгахдаа итгэлтэй байна уу?',
      confirmLabel: 'Устгах',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setMutationBusy(true);
        setError('');
        try {
          await api(`/families/${family}/persons/${id}/events/${eventId}`, { method: 'DELETE' });
          setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
          setNotice('Үйл явдал устгагдлаа.');
        } catch (cause) {
          setError(cause instanceof ApiError ? cause.message : 'Үйл явдал устгаж чадсангүй.');
        } finally {
          setMutationBusy(false);
        }
      },
    });
  }

  if (loading) {
    return (
      <main className="profile-page">
        <section className="profile-shell profile-state" aria-live="polite">
          <span className="people-spinner" aria-hidden="true" />
          <p>Профайлыг ачаалж байна…</p>
        </section>
      </main>
    );
  }

  if (!person) {
    return (
      <main className="profile-page">
        <section className="profile-shell profile-state">
          <div className="personavatar large" aria-hidden="true">?</div>
          <h1>Хүн олдсонгүй</h1>
          <p>{error || 'Энэ хүний мэдээллийг одоогоор харах боломжгүй байна.'}</p>
          <div className="profile-actions">
            <Link className="button" href={family ? `/people?family=${encodeURIComponent(family)}` : '/people'}>
              Хүмүүс рүү буцах
            </Link>
            <button type="button" onClick={() => void retry()}>Дахин оролдох</button>
          </div>
        </section>
      </main>
    );
  }

  const birthDeath = [
    person.birth_date ? person.birth_date : null,
    !person.is_alive ? person.death_date ?? 'нас барсан огноо тодорхойгүй' : null,
  ].filter(Boolean).join(' – ');
  const age = calculateAge(person.birth_date, person.death_date, person.is_alive);

  return (
    <main className="profile-page">
      <section className="profile-shell">
        <nav className="profile-nav" aria-label="Профайлын зам">
          <Link href={`/people?family=${encodeURIComponent(family)}`}>← Хүмүүс</Link>
          <span aria-hidden="true">/</span>
          <span>{personName(person) || 'Профайл'}</span>
        </nav>

        {error && <div className="error profile-alert" role="alert">{error}</div>}
        {notice && <div className="success profile-alert" role="status">{notice}</div>}

        <header className="profile-hero">
          {person.profile_photo_url ? (
            <img
              className="personavatar profile-photo"
              src={person.profile_photo_url}
              alt={`${personName(person)}-ийн хөрөг`}
            />
          ) : (
            <span
              className={`personavatar large ${person.gender === 'female' ? 'is-female-avatar' : 'is-male-avatar'}`}
              aria-hidden="true"
            >
              {initials(person)}
            </span>
          )}

          <div className="profile-identity">
            <div className="profile-badge-row">
              {isSelf && <span className="profile-role-tag is-self">👑 Миний профайл</span>}
              {isCreator && !isSelf && <span className="profile-role-tag is-creator">✨ Миний нэмсэн гишүүн</span>}
              {isAdmin && <span className="profile-role-tag is-admin">🛡️ Админ удирдлага</span>}
              {!canEdit && <span className="profile-role-tag is-viewonly">🔒 Зөвхөн харах эрхтэй</span>}
            </div>

            <p className="eyebrow">ГУУЛИНГИЙНХАН · ГЭР БҮЛИЙН ПРОФАЙЛ</p>
            <h1>{personName(person) || 'Нэргүй хүн'}</h1>
            <p className="profile-life">
              {birthDeath || 'Амьдралын огноо бүртгэгдээгүй'}
              {person.is_alive && ' · Амьд сэрүүн'}
              {age !== null && (
                <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(217, 119, 6, 0.14)', color: '#b45309', fontWeight: 700, fontSize: '11px' }}>
                  {person.is_alive ? `${age} настай` : `${age} насалсан`}
                </span>
              )}
            </p>
            {person.nickname && <p className="profile-nickname">“{person.nickname}”</p>}

            {/* Quick Relatives Chips */}
            {(person.parents.length > 0 || person.spouses.length > 0) && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>Шууд холбоос:</span>
                {person.parents.map((p) => (
                  <Link
                    key={p.id}
                    href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(p.id)}`}
                    style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', textDecoration: 'none', color: '#334155' }}
                  >
                    👤 {relationName(p)}
                  </Link>
                ))}
                {person.spouses.map((s) => (
                  <Link
                    key={s.id}
                    href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(s.id)}`}
                    style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: '#fef2f2', border: '1px solid #fecaca', textDecoration: 'none', color: '#991b1b' }}
                  >
                    💍 {relationName(s)}
                  </Link>
                ))}
              </div>
            )}

            <div className="profile-actions">
              <Link
                className="button primary"
                href={`/tree?family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}
              >
                🌳 Удмын модонд харах
              </Link>

              {canEdit ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setEditing((value) => !value)}
                >
                  {editing ? 'Засахыг хаах' : '✏️ Профайл засах'}
                </button>
              ) : (
                <span className="profile-locked-notice">
                  🔒 Зөвхөн админ эсвэл үүсгэсэн хэрэглэгч засах боломжтой
                </span>
              )}

              {canDelete && (
                <button
                  type="button"
                  className="button"
                  style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#fca5a5' }}
                  onClick={handleDeletePerson}
                  disabled={mutationBusy}
                  title="Энэ хүнийг гэр бүлийн модноос устгах/салгах"
                >
                  🗑️ Модноос салгах
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <nav className="profile-tabs" aria-label="Профайлын төрөл">
          <button
            type="button"
            className={`profile-tab ${activeTab === 'overview' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            👤 Тойм ба Намтар
          </button>
          <button
            type="button"
            className={`profile-tab ${activeTab === 'timeline' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('timeline')}
          >
            ⏳ Цагийн хэлхээс ({events.length})
          </button>
          <button
            type="button"
            className={`profile-tab ${activeTab === 'relationships' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('relationships')}
          >
            🌿 Ураг төрөл & Гэрлэлт ({person.parents.length + person.spouses.length + person.children.length})
          </button>
          <button
            type="button"
            className={`profile-tab ${activeTab === 'oral_history' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('oral_history')}
          >
            🎙️ Хууч яриа, дурсамж
          </button>
          <button
            type="button"
            className={`profile-tab ${activeTab === 'memories' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('memories')}
          >
            📸 Дурсамж & Архив ({memories.length + (stories?.items.length ?? 0)})
          </button>
        </nav>

        {/* TAB 1: OVERVIEW & BIOGRAPHY */}
        {activeTab === 'overview' && (
          <div className="profile-grid">
            <section className="card profile-card">
              <div className="profile-card-heading">
                <div><p className="eyebrow">IDENTITY</p><h2>Үндсэн мэдээлэл</h2></div>
              </div>
              <dl className="profile-facts">
                <div><dt>Нэр</dt><dd>{personName(person) || 'Нэргүй'}</dd></div>
                <div><dt>Хүйс</dt><dd>{person.gender === 'female' ? 'Эмэгтэй' : person.gender === 'male' ? 'Эрэгтэй' : person.gender === 'other' ? 'Бусад' : 'Тодорхойгүй'}</dd></div>
                <div><dt>Төрсөн огноо</dt><dd>{person.birth_date ?? 'Мэдээлэл оруулаагүй'}</dd></div>
                <div><dt>Төрсөн газар</dt><dd>{person.birth_place ?? 'Мэдээлэл оруулаагүй'}</dd></div>
                <div><dt>Төлөв</dt><dd>{person.is_alive ? '🟢 Амьд сэрүүн' : '🕊️ Мөнхөрсөн'}</dd></div>
                {!person.is_alive && <div><dt>Нас барсан огноо</dt><dd>{person.death_date ?? 'Огноо тодорхойгүй'}</dd></div>}
                {!person.is_alive && <div><dt>Нас барсан газар</dt><dd>{person.death_place ?? 'Мэдээлэл оруулаагүй'}</dd></div>}
                <div><dt>Нууцлал</dt><dd>{person.visibility === 'private' ? 'Хувийн (зөвхөн би)' : person.visibility === 'public' ? 'Нийтийн' : 'Гэр бүлийн хүрээнд'}</dd></div>
                <div><dt>Эрх</dt><dd>{canEdit ? '✨ Засах эрхтэй' : '🔒 Зөвхөн харах эрхтэй'}</dd></div>
              </dl>
            </section>

            <section className="card profile-card">
              <div className="profile-card-heading">
                <div><p className="eyebrow">LINEAGE</p><h2>Удам угсаа</h2></div>
              </div>
              <dl className="profile-facts">
                <div><dt>Удам угсаа</dt><dd>{person.lineage_name ?? 'Одоогоор хуваарилагдаагүй'}</dd></div>
                <div><dt>Салаа</dt><dd>{person.branch_name ?? 'Одоогоор хуваарилагдаагүй'}</dd></div>
                <div><dt>Товч тэмдэглэл</dt><dd>{person.short_description ?? 'Тэмдэглэл байхгүй'}</dd></div>
              </dl>
            </section>

            <section className="card profile-card" style={{ gridColumn: '1 / -1' }}>
              <div className="profile-card-heading">
                <div><p className="eyebrow">BIOGRAPHY</p><h2>Амьдралын түүх, намтар</h2></div>
              </div>
              {biographyState === 'loading' && <p className="profile-empty" role="status">Намтрыг ачаалж байна…</p>}
              {biographyState === 'restricted' && <p className="profile-private">Энэ хүний намтар нууцлагдсан байна.</p>}
              {biographyState === 'error' && <div className="profile-inline-error"><p>Намтрыг ачаалж чадсангүй.</p><button type="button" onClick={() => void retry()}>Дахин оролдох</button></div>}
              {biographyState === 'ready' && (
                <>
                  <p className="profile-text" style={{ fontSize: '14px', lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
                    {biography || 'Одоогоор намтар бичигдээгүй байна.'}
                  </p>
                  {canEdit && (
                    <form onSubmit={saveBiography} style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed #e2d9c8' }}>
                      <label>
                        <span style={{ fontWeight: 700 }}>Намтар шинэчлэн бичих / засах:</span>
                        <textarea
                          value={biography}
                          onChange={(event) => setBiography(event.target.value)}
                          maxLength={50000}
                          placeholder="Намтар, амьдралын замнал, сургууль, гавьяа шагналын түүхийг энд бичнэ үү…"
                          rows={6}
                        />
                      </label>
                      <button className="primary" type="submit" disabled={mutationBusy}>
                        {mutationBusy ? 'Хадгалж байна…' : 'Намтар хадгалах'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: TIMELINE */}
        {activeTab === 'timeline' && (
          <div className="profile-timeline-tab">
            <section className="card profile-card">
              <div className="profile-card-heading">
                <div><p className="eyebrow">CHRONOLOGY</p><h2>Амьдралын үйл явдлын хэлхээс</h2></div>
              </div>
              {eventState === 'loading' && <p className="profile-empty" role="status">Үйл явдлуудыг ачаалж байна…</p>}
              {eventState === 'restricted' && <p className="profile-private">Үйл явдлууд нууцлагдсан байна.</p>}
              {eventState === 'error' && <div className="profile-inline-error"><p>Ачаалж чадсангүй.</p><button type="button" onClick={() => void retry()}>Дахин оролдох</button></div>}
              {eventState === 'ready' && events.length === 0 && (
                <p className="profile-empty">Одоогоор үйл явдал бүртгэгдээгүй байна.</p>
              )}

              {eventState === 'ready' && events.length > 0 && (
                <div className="profile-timeline">
                  {events.map((ev) => {
                    const info = EVENT_TYPE_MAP[ev.event_type] || EVENT_TYPE_MAP.other;
                    return (
                      <div className="profile-timeline-node" key={ev.id}>
                        <div className="profile-timeline-dot" aria-hidden="true">{info.icon}</div>
                        <div className="profile-timeline-main">
                          <div className="profile-timeline-top">
                            <strong>{ev.title}</strong>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="profile-timeline-date">{ev.event_date || 'Огноогүй'}</span>
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEvent(ev.id)}
                                  title="Устгах"
                                  style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                          {ev.description && <p className="profile-timeline-desc">{ev.description}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {canEdit && (
                <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid #e2d9c8' }}>
                  <h3 style={{ fontSize: '15px', color: '#0f172a', margin: '0 0 12px' }}>+ Шинэ үйл явдал нэмэх</h3>
                  <form onSubmit={addEvent}>
                    <div className="profile-form-grid">
                      <label>
                        <span>Төрөл</span>
                        <select name="event_type" defaultValue="school">
                          <option value="school">🎓 Сургууль</option>
                          <option value="career">💼 Ажил, алба</option>
                          <option value="marriage">💍 Гэрлэлт</option>
                          <option value="award">🏆 Шагнал, цол</option>
                          <option value="relocation">📍 Нүүдэл, шилжилт</option>
                          <option value="military">🎖️ Цэргийн алба</option>
                          <option value="other">📜 Бусад</option>
                        </select>
                      </label>
                      <label>
                        <span>Гарчиг</span>
                        <input name="title" required maxLength={180} placeholder="Жишээ: Их сургууль дүүргэв" />
                      </label>
                      <label>
                        <span>Огноо</span>
                        <input name="event_date" type="date" />
                      </label>
                    </div>
                    <label style={{ marginTop: '8px' }}>
                      <span>Тайлбар</span>
                      <textarea name="description" maxLength={10000} placeholder="Дэлгэрэнгүй тэмдэглэл, дурсамж..." rows={3} />
                    </label>
                    <button className="primary" type="submit" disabled={mutationBusy}>
                      {mutationBusy ? 'Нэмж байна…' : 'Үйл явдал нэмэх'}
                    </button>
                  </form>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 3: RELATIONSHIPS & MARRIAGES */}
        {activeTab === 'relationships' && (
          <div className="profile-grid">
            <section className="card profile-card profile-relationships">
              <div className="profile-card-heading">
                <div><p className="eyebrow">KINSHIP</p><h2>Төрөл садангийн холбоос</h2></div>
              </div>
              <div className="relationship-columns">
                <div>
                  <h3>Эцэг / Эх ({person.parents.length})</h3>
                  {person.parents.length === 0 ? (
                    <p className="profile-empty">Эцэг эх бүртгэгдээгүй байна.</p>
                  ) : (
                    person.parents.map((parent) => (
                      <Link
                        className="relationship-item"
                        key={parent.id}
                        href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(parent.id)}`}
                      >
                        <span className="personavatar tiny">{initials(parent)}</span>
                        <span>
                          <strong>{relationName(parent)}</strong>
                          <small>{relationLife(parent)}</small>
                        </span>
                      </Link>
                    ))
                  )}
                </div>

                <div>
                  <h3>Ханиуд ({person.spouses.length})</h3>
                  {person.spouses.length === 0 ? (
                    <p className="profile-empty">Хань бүртгэгдээгүй байна.</p>
                  ) : (
                    person.spouses.map((spouse) => (
                      <Link
                        className="relationship-item"
                        key={spouse.id}
                        href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(spouse.id)}`}
                      >
                        <span className="personavatar tiny">{initials(spouse)}</span>
                        <span>
                          <strong>{relationName(spouse)}</strong>
                          <small>{relationLife(spouse)}</small>
                        </span>
                      </Link>
                    ))
                  )}
                </div>

                <div>
                  <h3>Үр хүүхдүүд ({person.children.length})</h3>
                  {person.children.length === 0 ? (
                    <p className="profile-empty">Үр хүүхэд бүртгэгдээгүй байна.</p>
                  ) : (
                    person.children.map((child) => (
                      <Link
                        className="relationship-item"
                        key={child.id}
                        href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(child.id)}`}
                      >
                        <span className="personavatar tiny">{initials(child)}</span>
                        <span>
                          <strong>{relationName(child)}</strong>
                          <small>{relationLife(child)}</small>
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="card profile-card" style={{ gridColumn: '1 / -1' }}>
              <div className="profile-card-heading">
                <div><p className="eyebrow">MARRIAGES</p><h2>Гэрлэлтийн түүх</h2></div>
              </div>
              {marriageState === 'loading' && <p className="profile-empty">Ачаалж байна…</p>}
              {marriageState === 'ready' && (marriages.length === 0
                ? <p className="profile-empty">Гэрлэлтийн түүх бүртгэгдээгүй байна.</p>
                : marriages.map((marriage) => (
                    <div className="history-item" key={marriage.id}>
                      <strong>{marriage.other_person ? personName(marriage.other_person) : 'Хань'}</strong>
                      <span>{marriage.status === 'married' ? 'Одоо хамт' : marriage.status === 'divorced' ? 'Салсан' : 'Бэлэвсэн'}</span>
                      <small>{marriage.start_date ?? 'Эхэлсэн огноогүй'} – {marriage.end_date ?? (marriage.status === 'married' ? 'Одоо' : 'Дууссан огноогүй')}</small>
                    </div>
                  ))
              )}
            </section>
          </div>
        )}

        {/* TAB 4: ORAL NARRATIVE & CHRONOLOGY */}
        {activeTab === 'oral_history' && (
          <div className="profile-grid">
            <section className="card profile-card" style={{ gridColumn: '1 / -1' }}>
              <div className="profile-card-heading">
                <div><p className="eyebrow">АМАН ДУРСАМЖИЙН САН</p><h2>🎙️ Ахмад дээдсийн хууч яриа, дурсамж</h2></div>
              </div>
              <p style={{ color: '#475569', fontSize: '13px', lineHeight: 1.7, margin: '0 0 16px' }}>
                Ахмад настнуудын хуучилсан ам яриа, дурсамж тэмдэглэлийг энд сийрүүлбэл төрсөн он, сургууль, ажил алба, гэрлэлт, гавьяа шагналын цаг хугацааг тод ялган амьдралын он дарааллын хэлхээс болгон цэгцэлж өгнө.
              </p>

              {canEdit ? (
                <form onSubmit={handleExtractOral} className="profile-oral-box">
                  <label>
                    <span style={{ fontWeight: 700 }}>Аман яриа, дурсамжийн эх бичвэр:</span>
                    <textarea
                      rows={6}
                      required
                      placeholder="Жишээ: Би 1954 онд Завхан аймгийн Тосонцэнгэл суманд төрсөн. 1972 онд 10 жилийн сургууль төгсөөд, 1978 онд МУИС дүүргэж багшаар ажилласан. 1980 онд гэрлэж 3 хүүхэдтэй болсон. 1990 онд Алтан гадас одон хүртсэн…"
                      value={oralNarrative}
                      onChange={(e) => setOralNarrative(e.target.value)}
                      disabled={extracting}
                    />
                  </label>

                  <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={oralAutoEvents}
                        onChange={(e) => setOralAutoEvents(e.target.checked)}
                        disabled={extracting}
                      />
                      <span style={{ fontSize: '12px' }}>Үйл явдлуудыг цагийн хэлхээс рүү шууд автоматаар оруулах</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={oralAutoBio}
                        onChange={(e) => setOralAutoBio(e.target.checked)}
                        disabled={extracting}
                      />
                      <span style={{ fontSize: '12px' }}>Эмхэтгэсэн намтрыг шууд хадгалах</span>
                    </label>
                  </div>

                  <button className="primary" type="submit" disabled={extracting || oralNarrative.trim().length < 10}>
                    {extracting ? 'Эмхэтгэж байна…' : '✨ Түүхээс он цаг цэгцлэх'}
                  </button>
                </form>
              ) : (
                <div style={{ padding: '18px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#64748b' }}>
                  🔒 Та энэ хүний хууч яриа, дурсамжийг засах эрхгүй байна (Зөвхөн админ эсвэл үүсгэсэн хэрэглэгч боломжтой).
                </div>
              )}

              {extractedResult && (
                <div style={{ marginTop: '20px', padding: '16px', background: '#fefce8', border: '1px solid #fef08a', borderRadius: '12px' }}>
                  <h4 style={{ margin: '0 0 8px', color: '#854d0e' }}>Шинжилгээний үр дүн:</h4>
                  <p style={{ fontSize: '12px', color: '#713f12', margin: '0 0 10px' }}>
                    Илэрсэн үйл явдал: <strong>{extractedResult.extracted_events.length}</strong> · Цагийн шугамд нэмэгдсэн: <strong>{extractedResult.created_events_count}</strong>
                  </p>
                  <pre style={{ background: '#ffffff', padding: '12px', borderRadius: '8px', fontSize: '12px', whiteSpace: 'pre-wrap', color: '#1e293b', border: '1px solid #e2e8f0' }}>
                    {extractedResult.suggested_biography}
                  </pre>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 5: MEMORIES & ARCHIVES */}
        {activeTab === 'memories' && (
          <div className="profile-grid">
            <section className="card profile-card">
              <div className="profile-card-heading">
                <div><p className="eyebrow">STORIES</p><h2>Холбогдох түүхүүд</h2></div>
                <Link href={`/stories?family=${encodeURIComponent(family)}`}>Түүх рүү →</Link>
              </div>
              {storyState === 'ready' && (
                stories?.items.length
                  ? <div className="history-list">{stories.items.slice(0, 5).map((story) => (
                      <Link className="history-item" key={story.id} href={`/stories/${story.id}?family=${encodeURIComponent(family)}`}>
                        <strong>{story.title}</strong>
                        <small>{story.event_date ?? 'Огноогүй'}</small>
                      </Link>
                    ))}</div>
                  : <p className="profile-empty">Холбогдох түүх бүртгэгдээгүй байна.</p>
              )}
            </section>

            <section className="card profile-card">
              <div className="profile-card-heading">
                <div><p className="eyebrow">MEMORIES</p><h2>Хадгалсан дурсамжууд</h2></div>
                <Link href={`/memories?family=${encodeURIComponent(family)}`}>Дурсамж руу →</Link>
              </div>
              {memoryState === 'ready' && memories.length === 0 && <p className="profile-empty">Дурсамж байхгүй байна.</p>}
              {memoryState === 'ready' && memories.length > 0 && (
                <div className="history-list">
                  {memories.slice(0, 6).map((memory) => (
                    <div className="history-item" key={memory.id}>
                      <strong>{memory.title}</strong>
                      <span>{memory.memory_date ?? 'Огноогүй'}{memory.description ? ` · ${memory.description}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card profile-card" style={{ gridColumn: '1 / -1' }}>
              <div className="profile-card-heading">
                <div><p className="eyebrow">ARCHIVES</p><h2>Баримт ба архив</h2></div>
                <Link href={`/archives?family=${encodeURIComponent(family)}`}>Архив руу →</Link>
              </div>
              {archiveState === 'ready' && (
                archives?.items.length
                  ? <div className="history-list">{archives.items.map((archive) => (
                      <Link className="history-item" key={archive.id} href={`/archives/${archive.id}?family=${encodeURIComponent(family)}`}>
                        <strong>{archive.title}</strong>
                        <small>{archive.document_date ?? 'Огноогүй'}</small>
                      </Link>
                    ))}</div>
                  : <p className="profile-empty">Холбоотой баримт олдсонгүй.</p>
              )}
            </section>
          </div>
        )}

        {editing && canEdit && (
          <section className="card profile-card profile-editor">
            <div className="profile-card-heading">
              <div><p className="eyebrow">EDIT PROFILE</p><h2>Хувийн мэдээлэл засах</h2></div>
            </div>
            <form onSubmit={saveProfile}>
              <div className="profile-form-grid">
                <label><span>Нэр</span><input name="first_name" defaultValue={person.first_name} required maxLength={120} /></label>
                <label><span>Овог</span><input name="last_name" defaultValue={person.last_name} maxLength={120} /></label>
                <label><span>Ургийн овог / Дундах нэр</span><input name="middle_name" defaultValue={person.middle_name ?? ''} maxLength={120} /></label>
                <label><span>Авгайлах нэр</span><input name="nickname" defaultValue={person.nickname ?? ''} maxLength={120} /></label>
                <label><span>Хүйс</span><select name="gender" defaultValue={person.gender}><option value="unknown">Тодорхойгүй</option><option value="female">Эмэгтэй</option><option value="male">Эрэгтэй</option><option value="other">Бусад</option></select></label>
                <label><span>Төрсөн огноо</span><input name="birth_date" type="date" defaultValue={person.birth_date ?? ''} /></label>
                <label><span>Төрсөн газар</span><input name="birth_place" defaultValue={person.birth_place ?? ''} maxLength={240} /></label>
                <label><span>Амьд сэрүүн эсэх</span><select name="is_alive" defaultValue={String(person.is_alive)}><option value="true">Амьд сэрүүн</option><option value="false">Мөнхөрсөн / Нас барсан</option></select></label>
                <label><span>Нас барсан огноо</span><input name="death_date" type="date" defaultValue={person.death_date ?? ''} /></label>
                <label><span>Нас барсан газар</span><input name="death_place" defaultValue={person.death_place ?? ''} maxLength={240} /></label>
                <label><span>Товч тайлбар</span><input name="short_description" defaultValue={person.short_description ?? ''} maxLength={1000} /></label>
                <label><span>Зургийн холбоос (URL)</span><input name="profile_photo_url" defaultValue={person.profile_photo_url ?? ''} maxLength={1000} placeholder="https://..." /></label>
                <label><span>Нууцлал</span><select name="visibility" defaultValue={person.visibility}><option value="private">Зөвхөн би</option><option value="family">Гэр бүлийнхэн</option><option value="public">Нийтийн</option></select></label>
              </div>
              <div className="profile-form-actions">
                <button type="button" className="button" onClick={() => setEditing(false)}>Болих</button>
                <button className="primary" type="submit" disabled={mutationBusy}>
                  {mutationBusy ? 'Хадгалж байна…' : 'Профайл хадгалах'}
                </button>
              </div>
            </form>
          </section>
        )}

        <footer className="profile-footer">
          <Link href={`/people?family=${encodeURIComponent(family)}`}>← Хүмүүсийн лавлах</Link>
          <Link href={`/tree?family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}>Удмын модонд харах →</Link>
        </footer>
      </section>
      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        busy={mutationBusy}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
    </main>
  );
}

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <main className="profile-page">
          <section className="profile-shell profile-state" aria-live="polite">
            <span className="people-spinner" aria-hidden="true" />
            <p>Профайлыг ачаалж байна…</p>
          </section>
        </main>
      }
    >
      <ProfilePageContent />
    </Suspense>
  );
}
