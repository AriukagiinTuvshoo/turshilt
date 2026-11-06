'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Family, StoryListPage } from '../../lib/api';

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ гэр бүлийн түүхийг харах эрхгүй байна.';
    if (cause.status === 404) return 'Гэр бүлийн түүх олдсонгүй.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Холболтоо шалгаад дахин оролдоно уу.';
  }
  return fallback;
}

const PAGE_SIZE = 12;

function StoriesPageContent() {
  const [family, setFamily] = useState<Family | null>(null);
  const [familyId, setFamilyId] = useState('');
  const [families, setFamilies] = useState<Family[]>([]);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [authorFilter, setAuthorFilter] = useState<'all' | 'mine'>('all');
  const familyRequestRef = useRef(0);
  const storyRequestRef = useRef(0);
  const storyAbortRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const loadStories = useCallback(async (fid: string, page = 1, q = query) => {
    if (!fid) return;
    const requestId = ++storyRequestRef.current;
    storyAbortRef.current?.abort();
    const controller = new AbortController();
    storyAbortRef.current = controller;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      const safeQuery = q.replace(/\s+/g, ' ').trim();
      if (safeQuery) params.set('q', safeQuery);
      const result = await api<StoryListPage>('/families/' + fid + '/stories?' + params.toString(), { signal: controller.signal });
      if (requestId !== storyRequestRef.current) return;
      setStories(result);
    } catch (cause) {
      if (requestId !== storyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(friendlyError(cause, 'Түүхийг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    } finally {
      if (requestId === storyRequestRef.current) {
        setLoading(false);
        setBusy(false);
      }
    }
  }, [query, router]);

  const loadFamilies = useCallback(async () => {
    const requestId = ++familyRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const items = await api<Family[]>('/families');
      if (requestId !== familyRequestRef.current) return;
      setFamilies(items);
      storyRequestRef.current += 1;
      if (!items.length) {
        setFamily(null);
        setFamilyId('');
        setStories(null);
        setLoading(false);
        return;
      }
      const requested = searchParams.get('family') ?? '';
      const selected = requested ? items.find((item) => item.id === requested) ?? null : items[0];
      if (!selected) {
        setFamily(null);
        setFamilyId('');
        setStories(null);
        setLoading(false);
        setError('Энэ гэр бүлийн түүхийг харах боломжгүй байна.');
        return;
      }
      setFamily(selected);
      setFamilyId(selected.id);
      setStories(null);
      if (!requested) {
        router.replace('/stories?family=' + encodeURIComponent(selected.id));
      }
    } catch (cause) {
      if (requestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setLoading(false);
      setError(friendlyError(cause, 'Гэр бүлийн орчныг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    }
  }, [router, searchParams]);

  useEffect(() => {
    storyAbortRef.current?.abort();
    setFamily(null);
    setFamilyId('');
    setStories(null);
    setError('');
    storyRequestRef.current += 1;
    void loadFamilies();
  }, [loadFamilies]);

  useEffect(() => {
    if (!familyId) return;
    const timer = window.setTimeout(() => void loadStories(familyId, 1), 120);
    return () => window.clearTimeout(timer);
  }, [familyId, loadStories]);

  function chooseFamily(next: string) {
    storyAbortRef.current?.abort();
    storyRequestRef.current += 1;
    const selected = families.find((item) => item.id === next) ?? null;
    setFamily(selected);
    setFamilyId(next);
    setStories(null);
    setError('');
    router.replace('/stories?family=' + encodeURIComponent(next));
  }

  useEffect(() => () => storyAbortRef.current?.abort(), []);

  const page = stories?.page ?? 1;
  const canCreate = family?.role === 'owner' || family?.role === 'editor';

  return (
    <main className="stories-page">
      <section className="stories-shell">
        <header className="stories-heading">
          <div>
            <Link href={family ? '/tree?family=' + encodeURIComponent(family.id) : '/tree'}>← Удмын мод руу буцах</Link>
            <p className="eyebrow">ГУУЛИНГИЙНХАН · FAMILY STORY</p>
            <h1>Манай түүх</h1>
            <p className="stories-lede">Гэр бүлийн үйл явдал, дурсамжит өгүүлэмж, огноо, газар болон холбоотой хүмүүсийг гэр бүлийн түүхийн санд хадгална.</p>
          </div>
          <div className="stories-actions">
            {families.length > 1 && (
              <label className="stories-family">
                <span>Гэр бүл</span>
                <select value={familyId} onChange={(event) => chooseFamily(event.target.value)} aria-label="Гэр бүл сонгох">
                  {families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            {familyId && canCreate && (
              <Link className="button primary" href={'/stories/new?family=' + encodeURIComponent(familyId)}>+ Түүх нэмэх</Link>
            )}
          </div>
        </header>

        {error && (
          <div className="error stories-error" role="alert">
            <span>{error}</span>
            <div className="stories-error-actions">
              <button type="button" onClick={() => void loadFamilies()}>Дахин оролдох</button>
              {familyId && <button type="button" onClick={() => void loadStories(familyId, page)} disabled={busy}>Түүх дахин ачаалах</button>}
            </div>
          </div>
        )}

        <form className="stories-toolbar card" aria-label="Түүх хайх" onSubmit={(event) => { event.preventDefault(); void loadStories(familyId, 1); }}>
          <label htmlFor="story-search">
            Түүх хайх
            <input
              id="story-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadStories(familyId, 1); }} placeholder="Гарчиг эсвэл агуулгаар хайх…" />
          </label>
          <button type="submit" disabled={busy}>Хайх</button>
        </form>

        {loading && !stories ? (
          <section className="stories-state card" aria-live="polite"><span className="people-spinner" aria-hidden="true" /><p>Гэр бүлийн түүхийг ачаалж байна…</p></section>
        ) : !families.length ? (
          <section className="stories-state card"><h2>Гэр бүл олдсонгүй.</h2><p>Танд одоогоор хандах боломжтой гэр бүл алга.</p><Link className="button" href="/families">Гэр бүлүүд</Link></section>
        ) : stories && stories.items.length === 0 ? (
          <section className="stories-state card">
            <h2>Одоогоор гэр бүлийн түүх нэмэгдээгүй байна.</h2>
            <p>Анхны түүхээ хадгалж, гэр бүлийнхээ чухал үйл явдлыг үлдээгээрэй.</p>
            {canCreate && <Link className="button primary" href={'/stories/new?family=' + encodeURIComponent(familyId)}>Анхны түүх нэмэх</Link>}
          </section>
        ) : (
          <>
            {(() => {
              const allStories = stories?.items ?? [];
              const myCount = allStories.filter((s) => s.can_edit).length;
              const displayStories = allStories.filter((s) => {
                if (authorFilter === 'mine' && !s.can_edit) return false;
                return true;
              });

              return (
                <>
                  {/* Filter and stats row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', margin: '14px 0 18px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setAuthorFilter('all')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: '20px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          border: '1.5px solid',
                          borderColor: authorFilter === 'all' ? '#d97706' : '#cbd5e1',
                          background: authorFilter === 'all' ? '#d97706' : 'transparent',
                          color: authorFilter === 'all' ? '#ffffff' : '#475569',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        Бүх түүх ({allStories.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthorFilter('mine')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: '20px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          border: '1.5px solid',
                          borderColor: authorFilter === 'mine' ? '#16a34a' : '#cbd5e1',
                          background: authorFilter === 'mine' ? '#16a34a' : 'transparent',
                          color: authorFilter === 'mine' ? '#ffffff' : '#475569',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        ✨ Миний бичсэн ({myCount})
                      </button>
                    </div>
                    <div className="stories-results-head" style={{ margin: 0 }}>
                      <strong>{displayStories.length} түүх харагдаж байна</strong>
                      {busy && <span role="status"> Шинэчилж байна…</span>}
                    </div>
                  </div>

                  <div className="story-grid story-timeline" aria-busy={busy}>
                    {displayStories.map((story) => (
                      <article className="card story-card" key={story.id} style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div className="story-card-timeline-date" style={{ margin: 0 }}>
                            <strong>{story.event_date ? story.event_date.slice(0, 4) : '—'}</strong>
                            <time dateTime={story.event_date ?? undefined}>{story.event_date ?? 'Огноогүй'}</time>
                          </div>
                          {story.can_edit ? (
                            <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#15803d', background: '#dcfce7', border: '1px solid #86efac', padding: '2px 8px', borderRadius: '12px' }}>
                              ✨ Таны бичсэн
                            </span>
                          ) : (
                            <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#64748b', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '12px' }}>
                              🔒 Зөвхөн унших
                            </span>
                          )}
                        </div>

                        <div className="story-card-meta">
                          {story.place && <span>📍 {story.place}</span>}
                          <span>{story.visibility === 'private' ? 'Зөвхөн би' : story.visibility === 'family' ? 'Гэр бүлийнхэн' : 'Нээлттэй'}</span>
                        </div>
                        <h2>{story.title}</h2>
                        <p>{story.excerpt}</p>
                        <div className="story-card-footer">
                          <span>✍️ {story.author_name}</span>
                          <span>👥 {story.related_people_count} холбоотой хүн</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' }}>
                          <Link className="button story-open" href={'/stories/' + story.id + '?family=' + encodeURIComponent(familyId)} style={{ flex: 1 }}>
                            Түүхийг унших →
                          </Link>
                          {story.can_edit && (
                            <Link
                              className="button"
                              href={'/stories/' + story.id + '/edit?family=' + encodeURIComponent(familyId)}
                              style={{ padding: '8px 12px', fontSize: '11px', fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}
                            >
                              ✏️ Засах
                            </Link>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              );
            })()}
            {stories && stories.total > PAGE_SIZE && (
              <nav className="stories-pagination" aria-label="Түүхийн хуудаслалт">
                <button type="button" disabled={page <= 1 || busy} onClick={() => void loadStories(familyId, page - 1)}>← Өмнөх</button>
                <span>{page} / {Math.max(1, Math.ceil(stories.total / PAGE_SIZE))}</span>
                <button type="button" disabled={!stories.has_next || busy} onClick={() => void loadStories(familyId, page + 1)}>Дараагийн →</button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}


export default function StoriesPage() {
  return (
    <Suspense fallback={<main className="stories-page"><section className="stories-shell stories-state" aria-live="polite"><span className="people-spinner" aria-hidden="true" /><p>Гэр бүлийн түүхийг ачаалж байна…</p></section></main>}>
      <StoriesPageContent />
    </Suspense>
  );
}
