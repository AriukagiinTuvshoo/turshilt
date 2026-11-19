'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { API_BASE, ApiError, api, Family, MemoryListItem } from '../../../lib/api';
import { PhotoTaggerModal } from '../photo-tagger-modal';
import { ConfirmDialog } from '../../../components/confirm-dialog';

type MemoryPhoto = NonNullable<MemoryListItem['photos']>[number];
type MemoryDetail = Omit<MemoryListItem, 'photos'> & {
  photos: MemoryPhoto[];
  tagged_people?: { id: string; name: string }[];
};

const monthNames = ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар', '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'];

function formatMemoryDate(value: string | null) {
  if (!value) return 'Огноогүй';
  const parts = value.split('-');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return parts.length === 3 && month >= 1 && month <= 12 && day ? `${parts[0]} оны ${monthNames[month - 1]} ${day}` : value;
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('mn-MN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function visibilityLabel(value: string) {
  if (value === 'private') return 'Зөвхөн би';
  if (value === 'public') return 'Нийтийн';
  return 'Гэр бүлийнхэн';
}

function photoUrl(path: string) {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 400) return 'Оруулсан мэдээллээ шалгана уу.';
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ дурсамжид хандах эрхгүй байна.';
    if (cause.status === 404) return 'Дурсамж олдсонгүй.';
    if (cause.status === 409) return 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна. Дахин оролдоно уу.';
    if (cause.status === 413) return 'Зургийн хэмжээ серверийн зөвшөөрсөн хязгаараас хэтэрсэн байна.';
    if (cause.status === 422) return 'Оруулсан мэдээлэл эсвэл зурагны төрлийг шалгана уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}

function MemoryDetailPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const [families, setFamilies] = useState<Family[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [familyId, setFamilyId] = useState('');
  const [memoryId, setMemoryId] = useState('');
  const [memory, setMemory] = useState<MemoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editVisibility, setEditVisibility] = useState('family');
  const [editPeople, setEditPeople] = useState<{ id: string; name: string }[]>([]);
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<{ items: { id: string; name: string; birth_year: number | null }[]; page: number; page_size: number; total: number; has_next: boolean } | null>(null);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const [editDirty, setEditDirty] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<MemoryPhoto | null>(null);
  const [failedPhotoIds, setFailedPhotoIds] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const familyRequestRef = useRef(0);
  const memoryRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const editRequestRef = useRef(0);
  const personRequestRef = useRef(0);
  const personAbortRef = useRef<AbortController | null>(null);
  const familyAbortRef = useRef<AbortController | null>(null);
  const memoryAbortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const editTitleRef = useRef<HTMLInputElement>(null);

  const loadMemory = useCallback(async (fid: string, mid: string) => {
    const requestId = ++memoryRequestRef.current;
    memoryAbortRef.current?.abort();
    const controller = new AbortController();
    memoryAbortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await api<MemoryDetail>(`/families/${fid}/memories/${mid}`, { signal: controller.signal });
      if (requestId !== memoryRequestRef.current) return;
      setMemory(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== memoryRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setMemory(null);
      setError(friendlyError(cause, 'Дурсамжийг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    } finally {
      if (requestId === memoryRequestRef.current) setLoading(false);
    }
  }, [router]);

  const loadFamilyContext = useCallback(async () => {
    const requestId = ++familyRequestRef.current;
    familyAbortRef.current?.abort();
    const controller = new AbortController();
    familyAbortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const items = await api<Family[]>('/families', { signal: controller.signal });
      if (requestId !== familyRequestRef.current) return;
      memoryRequestRef.current += 1;
      memoryAbortRef.current?.abort();
      const mid = params.id ?? '';
      setMemoryId(mid);
      if (!items.length) {
        setFamily(null);
        setFamilyId('');
        setMemory(null);
        setLoading(false);
        setError('Танд одоогоор хандах боломжтой гэр бүл алга.');
        return;
      }
      const requested = searchParams.get('family') ?? '';
      const selected = requested ? items.find((item) => item.id === requested) ?? null : items[0];
      if (!selected) {
        setFamily(null);
        setFamilyId('');
        setMemory(null);
        setLoading(false);
        setError('Энэ гэр бүлийн дурсамжийг харах боломжгүй байна.');
        return;
      }
      setFamilies(items);
      setFamily(selected);
      setFamilyId(selected.id);
      if (!mid) {
        setLoading(false);
        setError('Дурсамжийн хаяг буруу байна.');
        return;
      }
      if (!requested) {
        router.replace(`/memories/${mid}?family=${encodeURIComponent(selected.id)}`);
      }
      await loadMemory(selected.id, mid);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setMemory(null);
      setLoading(false);
      setError(friendlyError(cause, 'Гэр бүлийн орчныг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    }
  }, [loadMemory, params.id, router, searchParams]);

  useEffect(() => {
    void loadFamilyContext();
  }, [loadFamilyContext]);

  useEffect(() => () => {
    familyAbortRef.current?.abort();
    memoryAbortRef.current?.abort();
    personAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!editing) return;
    editTitleRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !editDirty || editSaving) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editing, editDirty, editSaving]);

  useEffect(() => {
    const safeQuery = personQuery.replace(/\s+/g, ' ').trim();
    personAbortRef.current?.abort();
    if (!editing || !familyId || !safeQuery) {
      personRequestRef.current += 1;
      setPersonResults(null);
      return;
    }
    const requestId = ++personRequestRef.current;
    const controller = new AbortController();
    personAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      void api<{ items: { id: string; name: string; birth_year: number | null }[]; page: number; page_size: number; total: number; has_next: boolean }>(
        `/families/${familyId}/persons/search?q=${encodeURIComponent(safeQuery)}&page=1&page_size=20`,
        { signal: controller.signal },
      ).then((result) => {
        if (requestId !== personRequestRef.current) return;
        setPersonResults(result);
      }).catch((cause) => {
        if (controller.signal.aborted || requestId !== personRequestRef.current) return;
        setEditError(friendlyError(cause, 'Хүн хайхад алдаа гарлаа. Дахин оролдоно уу.'));
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (personAbortRef.current === controller) personAbortRef.current = null;
    };
  }, [editing, familyId, personQuery]);

  function beginEdit() {
    if (!memory || editSaving) return;
    setEditTitle(memory.title);
    setEditDescription(memory.description ?? '');
    setEditDate(memory.memory_date ?? '');
    setEditVisibility(memory.visibility);
    setEditPeople(memory.person_ids.map((id, index) => ({ id, name: memory.person_names?.[index] ?? `Person ID: ${id.slice(0, 8)}…` })));
    setPersonQuery('');
    setPersonResults(null);
    setEditError('');
    setEditSuccess('');
    setEditDirty(false);
    setEditing(true);
  }

  function toggleEditPerson(person: { id: string; name: string }) {
    setEditPeople((current) => current.some((item) => item.id === person.id)
      ? current.filter((item) => item.id !== person.id)
      : current.length >= 100 ? current : [...current, person]);
    setEditDirty(true);
  }

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  function executeCancelEdit() {
    setShowCancelConfirm(false);
    personAbortRef.current?.abort();
    personRequestRef.current += 1;
    setEditing(false);
    setEditError('');
    setEditSuccess('');
    setPersonQuery('');
    setPersonResults(null);
    setEditDirty(false);
  }

  function cancelEdit() {
    if (editDirty) {
      setShowCancelConfirm(true);
      return;
    }
    executeCancelEdit();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!familyId || !memoryId || editSaving) return;
    if (!editTitle.trim()) {
      setEditError('Гарчиг хоосон байж болохгүй.');
      return;
    }
    const requestId = ++editRequestRef.current;
    const operationFamilyId = familyId;
    const operationMemoryId = memoryId;
    const operationFamilyRequestId = familyRequestRef.current;
    setEditSaving(true);
    setEditError('');
    setEditSuccess('');
    try {
      await api<MemoryDetail>(`/families/${operationFamilyId}/memories/${operationMemoryId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          memory_date: editDate || null,
          visibility: editVisibility,
          person_ids: editPeople.map((person) => person.id),
        }),
      });
      if (requestId !== editRequestRef.current || operationFamilyRequestId !== familyRequestRef.current || operationFamilyId !== familyId) return;
      const refreshed = await api<MemoryDetail>(`/families/${operationFamilyId}/memories/${operationMemoryId}`);
      if (requestId !== editRequestRef.current || operationFamilyRequestId !== familyRequestRef.current || operationFamilyId !== familyId) return;
      setMemory(refreshed);
      setEditing(false);
      setEditDirty(false);
      setEditSuccess('Дурсамж амжилттай шинэчлэгдлээ.');
    } catch (cause) {
      if (requestId !== editRequestRef.current || operationFamilyRequestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setEditError(friendlyError(cause, 'Дурсамжийг хадгалж чадсангүй. Дахин оролдоно уу.'));
    } finally {
      if (requestId === editRequestRef.current) setEditSaving(false);
    }
  }

  useEffect(() => {
    if (showDelete) cancelRef.current?.focus();
  }, [showDelete]);

  async function removeMemory() {
    if (!familyId || !memoryId || busy) return;
    const requestId = ++mutationRequestRef.current;
    const operationFamilyId = familyId;
    const operationFamilyRequestId = familyRequestRef.current;
    setBusy(true);
    setError('');
    try {
      await api<void>(`/families/${operationFamilyId}/memories/${memoryId}`, { method: 'DELETE' });
      if (requestId !== mutationRequestRef.current || operationFamilyRequestId !== familyRequestRef.current || operationFamilyId !== familyId) return;
      router.replace(`/memories?family=${encodeURIComponent(operationFamilyId)}`);
    } catch (cause) {
      if (requestId !== mutationRequestRef.current || operationFamilyRequestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        setBusy(false);
        return;
      }
      setError(friendlyError(cause, 'Дурсамжийг устгах үед алдаа гарлаа. Дахин оролдоно уу.'));
      setShowDelete(false);
      setBusy(false);
    }
  }

  async function handleUploadPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length || !familyId || !memoryId) return;
    setBusy(true);
    setError('');
    try {
      for (const file of files) {
        await api<MemoryPhoto>(`/families/${familyId}/memories/${memoryId}/photos`, {
          method: 'POST',
          body: file,
          headers: {
            'Content-Type': file.type || 'image/jpeg',
            'X-File-Name': encodeURIComponent(file.name),
          },
        });
      }
      await loadMemory(familyId, memoryId);
    } catch (cause) {
      setError(friendlyError(cause, 'Зураг хуулахад алдаа гарлаа.'));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleTagsUpdated(photoId: string, newPersonIds: string[]) {
    setMemory((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: prev.photos.map((p) =>
          p.id === photoId ? { ...p, person_ids: newPersonIds } : p
        ),
      };
    });
  }

  function handlePhotoDeleted(photoId: string) {
    setMemory((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: prev.photos.filter((p) => p.id !== photoId),
      };
    });
  }

  if (loading) {
    return (
      <main className="memories-page">
        <section className="memories-shell memory-detail-state" aria-live="polite">
          <span className="memory-state-mark" aria-hidden="true" />
          <p className="memories-eyebrow">MEMORY · LOADING</p>
          <h1>Дурсамжийг нээж байна…</h1>
        </section>
      </main>
    );
  }

  if (error && !memory) {
    return (
      <main className="memories-page">
        <section className="memories-shell">
          <div className="memories-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void loadFamilyContext()}>Дахин оролдох</button></div>
          <Link className="memories-secondary memories-link-button" href={familyId ? `/memories?family=${encodeURIComponent(familyId)}` : '/memories'}>← Бүх дурсамж</Link>
        </section>
      </main>
    );
  }

  if (!memory) return null;

  return (
    <main className="memories-page">
      <article className="memories-shell memory-detail">
        <nav className="memories-breadcrumb" aria-label="Замын мөр">
          <Link href={`/memories?family=${encodeURIComponent(familyId)}`}>← Бүх дурсамж</Link>
          <span>{family?.name ?? 'Гэр бүл'}</span>
        </nav>

        {error && <div className="memories-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void loadMemory(familyId, memoryId)}>Дахин оролдох</button></div>}

        <header className="memory-detail-header">
          <div>
            <p className="memories-eyebrow">ГЭР БҮЛИЙН ДУРСАМЖ · {family?.name ?? 'Гэр бүл'}</p>
            <p className="memory-detail-date">{formatMemoryDate(memory.memory_date)}</p>
            <h1>{memory.title}</h1>
            <div className="memory-detail-meta">
              <span>{visibilityLabel(memory.visibility)}</span>
              <span>· Хадгалсан {formatCreatedAt(memory.created_at)}</span>
              <span>· {memory.person_ids.length} холбоотой хүн</span>
            </div>
          </div>
          <div className="memory-detail-header-actions">
            {memory.can_edit ? (
              <>
                <button type="button" className="memories-secondary" onClick={beginEdit} disabled={busy || editSaving}>✏️ Засах</button>
                {memory.can_delete && (
                  <button type="button" className="memories-danger" onClick={() => setShowDelete(true)} disabled={busy || editSaving}>Дурсамж устгах</button>
                )}
              </>
            ) : (
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '6px 12px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
                🔒 Зөвхөн харах эрхтэй
              </span>
            )}
          </div>
        </header>

        {editSuccess && <div className="memories-success" role="status" aria-live="polite">{editSuccess}</div>}

        {editing && (
          <section className="memory-composer memory-edit-form-shell" aria-labelledby="memory-edit-heading">
            <div className="memory-composer-heading">
              <div>
                <p className="memories-eyebrow">FAMILY MEMORIES · EDIT</p>
                <h2 id="memory-edit-heading">Дурсамжийг засах</h2>
              </div>
              <span>Өөрчлөлтийг серверийн existing Memory authorization болон privacy rules шалгана.</span>
            </div>
            {editError && <div className="memories-alert" role="alert" id="memory-edit-error"><span>{editError}</span></div>}
            <form className="memory-composer-form" onSubmit={saveEdit} aria-describedby={editError ? 'memory-edit-error' : undefined}>
              <label>
                <span>Гарчиг *</span>
                <input ref={editTitleRef} value={editTitle} onChange={(event) => { setEditTitle(event.target.value); setEditDirty(true); }} maxLength={180} required />
              </label>
              <label>
                <span>Огноо</span>
                <input type="date" value={editDate} onChange={(event) => { setEditDate(event.target.value); setEditDirty(true); }} />
              </label>
              <label>
                <span>Харагдац</span>
                <select value={editVisibility} onChange={(event) => { setEditVisibility(event.target.value); setEditDirty(true); }}>
                  <option value="private">Зөвхөн би</option>
                  <option value="family">Гэр бүлийнхэн</option>
                  <option value="public">Нийтийн</option>
                </select>
              </label>
              <label className="memory-composer-wide">
                <span>Тайлбар</span>
                <textarea value={editDescription} onChange={(event) => { setEditDescription(event.target.value); setEditDirty(true); }} maxLength={20000} rows={8} />
              </label>
              <fieldset className="memory-composer-wide memory-edit-people">
                <legend>Холбоотой хүмүүс</legend>
                <label>
                  <span>Хүн хайх</span>
                  <input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Нэрээр хайх…" autoComplete="off" />
                </label>
                {editPeople.length > 0 && (
                  <div className="memory-selected-people" aria-label="Сонгосон холбоотой хүмүүс">
                    {editPeople.map((person) => (
                      <button type="button" key={person.id} onClick={() => toggleEditPerson(person)} aria-label={`${person.name} холбоосыг хасах`}>
                        {person.name} ×
                      </button>
                    ))}
                  </div>
                )}
                {personResults && (
                  <div className="memory-person-results" aria-live="polite">
                    {personResults.items.length ? personResults.items.map((person) => {
                      const selected = editPeople.some((item) => item.id === person.id);
                      return (
                        <button type="button" key={person.id} aria-pressed={selected} onClick={() => toggleEditPerson({ id: person.id, name: person.name })}>
                          {selected ? '✓ ' : '+ '}{person.name}
                        </button>
                      );
                    }) : <p>Хүн олдсонгүй.</p>}
                  </div>
                )}
              </fieldset>
              <div className="memory-composer-actions">
                <button type="button" className="memories-secondary" onClick={cancelEdit} disabled={editSaving}>Болих</button>
                <button type="submit" className="memories-primary" disabled={editSaving} aria-busy={editSaving}>
                  {editSaving ? 'Хадгалж байна…' : 'Хадгалах'}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="memory-detail-body" aria-labelledby="memory-detail-content">
          <h2 id="memory-detail-content">Энэ мөчийн тухай</h2>
          {memory.description ? <p>{memory.description}</p> : <p className="memory-muted">Энэ дурсамжид нэмэлт тайлбар хадгалагдаагүй байна.</p>}
        </section>

        <section className="memory-detail-photos" aria-labelledby="memory-detail-photos-heading">
          <div className="memory-detail-section-heading">
            <div>
              <p className="memories-eyebrow">MEMORY PHOTOS</p>
              <h2 id="memory-detail-photos-heading">Гэрэл зураг & Таглалт</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{memory.photos.length} зураг</span>
              {memory.can_edit && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleUploadPhotos}
                  />
                  <button
                    type="button"
                    className="memories-secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    + Зураг нэмэх
                  </button>
                </>
              )}
            </div>
          </div>
          {memory.photos.length ? (
            <div className="memory-detail-gallery">
              {memory.photos.map((photo) => (
                <figure
                  key={photo.id}
                  style={{ cursor: 'pointer', position: 'relative' }}
                  onClick={() => setSelectedPhoto(photo)}
                  title="Зургийг томоор харах & хүн таглах"
                >
                  <img
                    src={photoUrl(photo.content_url)}
                    alt={photo.title ?? `${memory.title} дурсамжийн зураг`}
                    loading="lazy"
                    crossOrigin="use-credentials"
                    onError={(event) => {
                      const image = event.currentTarget;
                      image.alt = 'Зураг ачааллах боломжгүй байна.';
                      image.style.display = 'none';
                      image.parentElement?.classList.add('memory-photo-fallback');
                    }}
                  />
                  {photo.person_ids && photo.person_ids.length > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        background: 'rgba(7, 46, 37, 0.85)',
                        color: '#fcedc7',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        border: '1px solid #d4b26f',
                      }}
                    >
                      👤 {photo.person_ids.length} таглагдсан
                    </span>
                  )}
                  {photo.title && <figcaption>{photo.title}</figcaption>}
                </figure>
              ))}
            </div>
          ) : (
            <div className="memory-detail-no-photos">Энэ дурсамжид зураг хадгалагдаагүй байна.</div>
          )}
        </section>

        <section className="memory-detail-people" aria-labelledby="memory-detail-people-heading">
          <h2 id="memory-detail-people-heading">Холбоотой хүмүүс</h2>
          {memory.person_ids.length ? (
            <div className="memory-related-people">
              {memory.person_ids.map((personId, index) => {
                const name =
                  memory.tagged_people?.find((p) => p.id === personId)?.name ||
                  memory.person_names?.[index] ||
                  editPeople.find((p) => p.id === personId)?.name ||
                  'Хүн үзэх';
                return (
                  <Link
                    key={personId}
                    href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(personId)}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: '#d4b26f',
                        color: '#072e25',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}
                    >
                      {name.slice(0, 1)}
                    </span>
                    <span>{name}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="memory-muted">Холбоотой хүн бүртгэгдээгүй байна.</p>
          )}
        </section>

        <PhotoTaggerModal
          isOpen={Boolean(selectedPhoto)}
          photo={selectedPhoto}
          familyId={familyId}
          memoryTitle={memory.title}
          knownPeople={
            memory.tagged_people ||
            memory.person_ids.map((id, i) => ({
              id,
              name: memory.person_names?.[i] || editPeople.find((p) => p.id === id)?.name || id,
            }))
          }
          canEdit={Boolean(memory.can_edit)}
          onClose={() => setSelectedPhoto(null)}
          onTagsUpdated={handleTagsUpdated}
          onPhotoDeleted={handlePhotoDeleted}
        />

        <footer className="memory-detail-footer">
          <Link href={`/tree?family=${encodeURIComponent(familyId)}`}>← Удмын мод руу буцах</Link>
          <Link href={`/memories?family=${encodeURIComponent(familyId)}`}>← Дурсамжийн архив</Link>
          <span>Бүх өгөгдөл одоогийн family context болон backend authorization-аар шүүгдэнэ.</span>
        </footer>
      </article>

      {showDelete && (
        <div className="memory-dialog-backdrop" role="presentation">
          <section className="memory-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-delete-title" aria-describedby="memory-delete-description">
            <p className="memories-eyebrow">DELETE MEMORY</p>
            <h2 id="memory-delete-title">Энэ дурсамжийг устгах уу?</h2>
            <p id="memory-delete-description">“{memory.title}” дурсамж болон түүнтэй холбоотой memory photo өгөгдөл backend-ийн existing delete contract-ийн дагуу устгагдана.</p>
            <div className="memory-dialog-actions">
              <button ref={cancelRef} type="button" className="memories-secondary" onClick={() => setShowDelete(false)} disabled={busy}>Буцах</button>
              <button type="button" className="memories-danger" onClick={() => void removeMemory()} disabled={busy}>{busy ? 'Устгаж байна…' : 'Устгах'}</button>
            </div>
          </section>
        </div>
      )}
      <ConfirmDialog
        isOpen={showCancelConfirm}
        title="Хадгалаагүй өөрчлөлт"
        message="Та хадгалаагүй өөрчлөлтөө орхин гарахдаа итгэлтэй байна уу?"
        confirmLabel="Гарах"
        variant="warning"
        onConfirm={executeCancelEdit}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </main>
  );
}


export default function MemoryDetailPage() {
  return (
    <Suspense fallback={<main className="memories-page"><section className="memories-shell memory-detail-state" aria-live="polite"><span className="memory-state-mark" aria-hidden="true" /><p className="memories-eyebrow">MEMORY · LOADING</p><h1>Дурсамжийг нээж байна…</h1></section></main>}>
      <MemoryDetailPageContent />
    </Suspense>
  );
}
