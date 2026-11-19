'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Award, Trash2 } from 'lucide-react';
import {
  ArchiveListPage,
  FamilyEvent,
  FamilyStats,
  Fund,
  MemoryListItem,
  ParentChildRelationshipItem,
  Person,
  StoryListPage,
  api,
} from '../../../lib/api';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { PedigreeCertificateModal } from '../../../components/pedigree-certificate-modal';
import { useAdminContext } from '../../../components/admin/admin-shell';
import { friendlyError } from '../../../components/admin/admin-types';

export default function AdminContentPage() {
  const {
    selectedFamilyId,
    selectedFamily,
    overview,
    can,
    withFamilyHref,
    setNotice,
    setError,
    refreshOverview,
  } = useAdminContext();

  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [stats, setStats] = useState<FamilyStats | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [edges, setEdges] = useState<ParentChildRelationshipItem[]>([]);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Устгах',
    onConfirm: async () => {},
  });

  const canManageContent = can('manage_content');

  const loadContent = useCallback(async () => {
    if (!selectedFamilyId) return;
    setLoading(true);
    try {
      const [
        storiesRes,
        memoriesRes,
        archivesRes,
        fundsRes,
        eventsRes,
        statsRes,
        peopleRes,
        edgesRes,
      ] = await Promise.all([
        api<StoryListPage>(`/families/${selectedFamilyId}/stories?page=1&page_size=25`).catch(
          () => null,
        ),
        api<MemoryListItem[] | { items?: MemoryListItem[] }>(
          `/families/${selectedFamilyId}/memories`,
        ).catch(() => []),
        api<ArchiveListPage>(`/families/${selectedFamilyId}/archives?page=1&page_size=25`).catch(
          () => null,
        ),
        api<Fund[]>(`/families/${selectedFamilyId}/funds`).catch(() => []),
        api<FamilyEvent[]>(`/families/${selectedFamilyId}/events`).catch(() => []),
        api<FamilyStats>(`/families/${selectedFamilyId}/stats`).catch(() => null),
        api<Person[]>(`/families/${selectedFamilyId}/persons`).catch(() => []),
        api<ParentChildRelationshipItem[]>(
          `/families/${selectedFamilyId}/relationships/parent-child`,
        ).catch(() => []),
      ]);
      setStories(storiesRes);
      setMemories(Array.isArray(memoriesRes) ? memoriesRes : memoriesRes?.items ?? []);
      setArchives(archivesRes);
      setFunds(fundsRes);
      setEvents(eventsRes);
      setStats(statsRes);
      setPeople(peopleRes);
      setEdges(edgesRes);
    } catch (cause) {
      setError(friendlyError(cause, 'Өв сан ба санхүүгийн мэдээллийг ачаалж чадсангүй.'));
    } finally {
      setLoading(false);
    }
  }, [selectedFamilyId, setError]);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  const confirmDelete = (
    title: string,
    message: string,
    endpoint: string,
    successMsg: string,
  ) => {
    setConfirmState({
      isOpen: true,
      title,
      message,
      confirmLabel: 'Устгах',
      onConfirm: async () => {
        setBusy(true);
        try {
          await api(endpoint, { method: 'DELETE' });
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice(successMsg);
          await Promise.all([loadContent(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Устгах үед алдаа гарлаа.'));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  if (!selectedFamily) return null;

  return (
    <div className="admin-section-stack">
      <section className="families-main-card admin-cert-card">
        <div>
          <h2 className="admin-card-subtitle" style={{ marginBottom: 4 }}>
            🏅 Ургийн Батламж үүсгэх
          </h2>
          <p className="admin-muted-text" style={{ margin: 0 }}>
            Уламжлалт хэв маяг, тамга бүхий дурсгалын батламж үүсгэж хэвлэх эсвэл PDF хэлбэрээр татна.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCertificateOpen(true)}
          className="homev2-button homev2-button--primary"
          style={{ fontSize: 12.5, padding: '9px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Award size={15} /> 🏅 Батламж үүсгэх
        </button>
      </section>

      <section className="families-main-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">💰 Гэр бүлийн сан &amp; Уулзалт</h2>
            <p className="admin-muted-text" style={{ margin: '4px 0 0' }}>
              Нийт санг ({funds.length}) болон уулзалт арга хэмжээг ({events.length}) нэг дор хянаж удирдах.
            </p>
          </div>
          <Link
            href={withFamilyHref('/activities')}
            className="homev2-button homev2-button--primary"
            style={{ fontSize: 12, padding: '8px 16px' }}
          >
            💰 Сан ба Уулзалт удирдах →
          </Link>
        </div>

        <div className="admin-kpi-grid">
          <div className="admin-kpi-box">
            <small>📥 Баталгаажсан орлого</small>
            <strong>{(overview?.confirmed_income_minor ?? 0).toLocaleString('mn-MN')} ₮</strong>
          </div>
          <div className="admin-kpi-box">
            <small>🧾 Нийт зарлага</small>
            <strong>{(overview?.total_expenses_minor ?? 0).toLocaleString('mn-MN')} ₮</strong>
          </div>
          <div className="admin-kpi-box">
            <small>💎 Цэвэр үлдэгдэл</small>
            <strong>{(overview?.net_balance_minor ?? 0).toLocaleString('mn-MN')} ₮</strong>
          </div>
          <div className="admin-kpi-box">
            <small>🎉 Идэвхтэй уулзалт</small>
            <strong>{events.length}</strong>
          </div>
        </div>
      </section>

      <section className="families-main-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">📖 Манай түүхүүд ({stories?.total ?? stories?.items?.length ?? 0})</h3>
          <Link
            href={withFamilyHref('/stories/new')}
            className="homev2-button homev2-button--light"
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            + Шинэ түүх бичих
          </Link>
        </div>
        {loading && !stories ? (
          <div className="admin-muted-text">Ачаалж байна…</div>
        ) : stories?.items?.length ? (
          <div className="admin-list-stack">
            {stories.items.map((st) => (
              <div key={st.id} className="admin-item-row">
                <div>
                  <strong style={{ fontSize: 14, color: 'var(--ui-text)' }}>{st.title}</strong>
                  <div className="admin-muted-text">
                    ✍️ {st.author_name} · 📅 {st.event_date || 'Огноогүй'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Link
                    href={`/stories/${st.id}?family=${encodeURIComponent(selectedFamilyId)}`}
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: 11.5, padding: '4px 10px' }}
                  >
                    Үзэх
                  </Link>
                  {canManageContent && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        confirmDelete(
                          '🗑️ Түүх устгах',
                          `"${st.title}" түүхийг устгах уу?`,
                          `/families/${selectedFamilyId}/stories/${st.id}`,
                          '🗑️ Түүхийг устгалаа.',
                        )
                      }
                      className="admin-remove-btn"
                      style={{ fontSize: 11.5, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <Trash2 size={12} /> Устгах
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-muted-text">Одоогоор нийтлэгдсэн түүх алга.</p>
        )}
      </section>

      <section className="families-main-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">📸 Дурсамж &amp; Гэрэл зургууд ({memories.length})</h3>
          <Link
            href={withFamilyHref('/memories')}
            className="homev2-button homev2-button--light"
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            📸 Дурсамжийн цомог нээх →
          </Link>
        </div>
        {memories.length ? (
          <div className="admin-memory-grid">
            {memories.map((mem) => (
              <div key={mem.id} className="admin-memory-card">
                <div>
                  <strong style={{ fontSize: 13.5, display: 'block', marginBottom: 4 }}>
                    {mem.title}
                  </strong>
                  <small className="admin-muted-text">
                    📅 {mem.memory_date || 'Огноогүй'} · ❤️ {mem.like_count ?? 0} · 💬 {mem.comment_count ?? 0}
                  </small>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
                  <Link
                    href={`/memories/${mem.id}?family=${encodeURIComponent(selectedFamilyId)}`}
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: 11, padding: '4px 9px' }}
                  >
                    Нээх
                  </Link>
                  {canManageContent && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        confirmDelete(
                          '🗑️ Дурсамж устгах',
                          `"${mem.title}" дурсамжийг зургийн хамт устгах уу?`,
                          `/families/${selectedFamilyId}/memories/${mem.id}`,
                          '🗑️ Дурсамжийг устгалаа.',
                        )
                      }
                      className="admin-remove-btn"
                      style={{ fontSize: 11, padding: '4px 9px' }}
                    >
                      Устгах
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-muted-text">Одоогоор хадгалсан дурсамж алга.</p>
        )}
      </section>

      <section className="families-main-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">🗂️ Архив баримтууд ({archives?.total ?? archives?.items?.length ?? 0})</h3>
          <Link
            href={withFamilyHref('/archives/new')}
            className="homev2-button homev2-button--light"
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            + Шинэ архив нэмэх
          </Link>
        </div>
        {archives?.items?.length ? (
          <div className="admin-list-stack">
            {archives.items.map((arc) => (
              <div key={arc.id} className="admin-item-row">
                <div>
                  <strong style={{ fontSize: 14, color: 'var(--ui-text)' }}>{arc.title}</strong>
                  <div className="admin-muted-text">
                    ✍️ {arc.author_name} · 📅 {arc.document_date || 'Огноогүй'}
                    {arc.place ? ` · 📍 ${arc.place}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Link
                    href={`/archives/${arc.id}?family=${encodeURIComponent(selectedFamilyId)}`}
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: 11.5, padding: '4px 10px' }}
                  >
                    Үзэх
                  </Link>
                  {canManageContent && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        confirmDelete(
                          '🗑️ Архив устгах',
                          `"${arc.title}" архивын баримтыг устгах уу?`,
                          `/families/${selectedFamilyId}/archives/${arc.id}`,
                          '🗑️ Архивын баримтыг устгалаа.',
                        )
                      }
                      className="admin-remove-btn"
                      style={{ fontSize: 11.5, padding: '4px 10px' }}
                    >
                      Устгах
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-muted-text">Одоогоор бүртгэгдсэн архивын баримт алга.</p>
        )}
      </section>

      <PedigreeCertificateModal
        isOpen={certificateOpen}
        onClose={() => setCertificateOpen(false)}
        family={selectedFamily}
        stats={stats}
        people={people}
        relationships={edges}
      />

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant="danger"
        busy={busy}
        onConfirm={() => void confirmState.onConfirm()}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
