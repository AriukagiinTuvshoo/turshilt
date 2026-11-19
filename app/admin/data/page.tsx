'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  AdminDataRefreshResult,
  FamilyTrashItem,
  api,
} from '../../../lib/api';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { useAdminContext } from '../../../components/admin/admin-shell';
import {
  AuditLogItem,
  formatAuditAction,
  friendlyError,
} from '../../../components/admin/admin-types';

export default function AdminDataPage() {
  const {
    selectedFamilyId,
    selectedFamily,
    can,
    setNotice,
    setError,
    refreshOverview,
    reloadFamilies,
  } = useAdminContext();

  const [trashItems, setTrashItems] = useState<FamilyTrashItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState<AdminDataRefreshResult | null>(null);

  const [familyName, setFamilyName] = useState('');
  const [familyDescription, setFamilyDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'warning' | 'primary';
    onConfirm: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Батлах',
    variant: 'danger',
    onConfirm: async () => {},
  });

  const canManageData = can('manage_data');
  const canViewAudit = can('view_audit');
  const canManageSettings = can('manage_settings');

  useEffect(() => {
    if (selectedFamily) {
      setFamilyName(selectedFamily.name);
      setFamilyDescription(selectedFamily.description ?? '');
    }
  }, [selectedFamily]);

  const loadData = useCallback(async () => {
    if (!selectedFamilyId) return;
    setLoading(true);
    try {
      const [trashRes, auditRes] = await Promise.all([
        canManageData
          ? api<FamilyTrashItem[]>(`/families/${selectedFamilyId}/trash`).catch(() => [])
          : Promise.resolve([]),
        canViewAudit
          ? api<AuditLogItem[]>(`/families/${selectedFamilyId}/audit?limit=100`).catch(() => [])
          : Promise.resolve([]),
      ]);
      setTrashItems(trashRes);
      setAuditLogs(auditRes);
    } catch (cause) {
      setError(friendlyError(cause, 'Систем болон аудитын өгөгдөл ачаалж чадсангүй.'));
    } finally {
      setLoading(false);
    }
  }, [canManageData, canViewAudit, selectedFamilyId, setError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredAuditLogs = useMemo(() => {
    if (!auditSearch.trim()) return auditLogs;
    const q = auditSearch.toLowerCase();
    return auditLogs.filter(
      (log) =>
        log.action.toLowerCase().includes(q) ||
        log.target_type.toLowerCase().includes(q) ||
        (log.actor_name && log.actor_name.toLowerCase().includes(q)) ||
        log.actor_id.toLowerCase().includes(q) ||
        (log.target_id && log.target_id.toLowerCase().includes(q)),
    );
  }, [auditLogs, auditSearch]);

  const handleReindexData = async () => {
    if (!selectedFamilyId || !canManageData || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api<AdminDataRefreshResult>(
        `/families/${selectedFamilyId}/admin/reindex-data`,
        { method: 'POST' },
      );
      setLastRefresh(res);
      setNotice(
        `🔄 Өгөгдөл амжилттай шинэчлэгдлээ: ${res.refreshed_persons} хүний хайлтын индекс цэгцлэгдэж, ${res.pruned_trash} хуучин хогийн бүртгэл цэвэрлэгдлээ.`,
      );
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Өгөгдөл шинэчлэх үед алдаа гарлаа.'));
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreTrash = async (item: FamilyTrashItem) => {
    if (!selectedFamilyId) return;
    setBusy(true);
    try {
      await api(`/families/${selectedFamilyId}/trash/${item.id}/restore`, { method: 'POST' });
      setNotice(`🌱 “${item.person_name}” модонд амжилттай сэргээгдлээ.`);
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Сэргээх үед алдаа гарлаа.'));
    } finally {
      setBusy(false);
    }
  };

  const handlePurgeTrash = (item: FamilyTrashItem) => {
    setConfirmState({
      isOpen: true,
      title: '🗑️ Бүрмөсөн устгах',
      message: `"${item.person_name}"-ийг хогийн савнаас бүрмөсөн устгах уу? Сэргээх боломжгүй.`,
      confirmLabel: 'Бүрмөсөн устгах',
      variant: 'danger',
      onConfirm: async () => {
        setBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/trash/${item.id}`, { method: 'DELETE' });
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice('🗑️ Хогийн савнаас устгалаа.');
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Устгах үед алдаа гарлаа.'));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const handleEmptyTrash = () => {
    setConfirmState({
      isOpen: true,
      title: '🗑️ Хогийн савыг бүрэн цэвэрлэх',
      message: `Хогийн саванд буй бүх ${trashItems.length} бүртгэлийг бүрмөсөн устгах уу?`,
      confirmLabel: 'Бүгдийг устгах',
      variant: 'danger',
      onConfirm: async () => {
        setBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/trash/empty`, { method: 'POST' });
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice('🗑️ Хогийн сав бүрэн цэвэрлэгдлээ.');
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Хогийн сав цэвэрлэхэд алдаа гарлаа.'));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !canManageSettings) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/families/${selectedFamilyId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: familyName.trim(),
          description: familyDescription.trim() || null,
        }),
      });
      setNotice('⚙️ Гэр бүлийн тохиргоо амжилттай хадгалагдлаа.');
      await Promise.all([reloadFamilies(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Тохиргоо хадгалах үед алдаа гарлаа.'));
    } finally {
      setBusy(false);
    }
  };

  if (!selectedFamily) return null;

  return (
    <div className="admin-section-stack">
      <section className="families-main-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">🔄 Өгөгдөл шинэчлэх &amp; Хайлтын индекс</h2>
            <p className="admin-muted-text" style={{ margin: '4px 0 0' }}>
              Бүх хүний овог нэрийн хоосон зайг цэгцлэн нормалчилж, хайлтын угтварыг шинэчилж, хугацаа дууссан хогийн бүртгэлийг цэвэрлэнэ.
            </p>
          </div>
          {canManageData ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleReindexData()}
              className="admin-action-accent-btn"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              {busy ? 'Шинэчилж байна…' : '🔄 Өгөгдөл шинэчлэх'}
            </button>
          ) : (
            <span className="admin-pill-neutral">🔒 Дата шинэчлэх эрхгүй</span>
          )}
        </div>
        {lastRefresh && (
          <div className="admin-alert-notice" style={{ marginBottom: 0 }}>
            <span>
              ✅ Сүүлд шинэчилсэн: {new Date(lastRefresh.refreshed_at).toLocaleString('mn-MN')} ·{' '}
              {lastRefresh.refreshed_persons} хүн индексжсэн · {lastRefresh.pruned_trash} хуучин хог цэвэрлэгдсэн
            </span>
          </div>
        )}
      </section>

      {canManageData && (
        <section className="families-main-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">🗑️ Хогийн сав ({trashItems.length})</h3>
            {trashItems.length > 0 && (
              <button
                type="button"
                onClick={handleEmptyTrash}
                disabled={busy}
                className="admin-remove-btn"
                style={{ fontSize: 12, padding: '6px 14px' }}
              >
                <Trash2 size={13} style={{ display: 'inline', marginRight: 6 }} />
                Хогийн сав цэвэрлэх
              </button>
            )}
          </div>
          {trashItems.length === 0 ? (
            <div className="admin-trash-empty">
              <div style={{ fontSize: 32, marginBottom: 8 }}>🌱</div>
              <strong style={{ display: 'block', marginBottom: 4 }}>Хогийн сав цэвэрхэн байна</strong>
              <span className="admin-muted-text">Устгагдсан хүний бүртгэл алга.</span>
            </div>
          ) : (
            <div className="admin-list-stack">
              {trashItems.map((item) => (
                <div key={item.id} className="admin-trash-row">
                  <div>
                    <strong style={{ fontSize: 14.5, color: 'var(--ui-text)' }}>
                      {item.person_name}
                    </strong>
                    <div className="admin-muted-text" style={{ marginTop: 3 }}>
                      Устгасан: {new Date(item.deleted_at).toLocaleString('mn-MN')} · 👤 {item.deleted_by_name}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRestoreTrash(item)}
                      className="admin-action-accent-btn"
                    >
                      <RefreshCw size={13} /> 🌱 Сэргээх
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handlePurgeTrash(item)}
                      className="admin-remove-btn"
                      aria-label={`${item.person_name}-ийг бүрмөсөн устгах`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {canViewAudit && (
        <section className="families-main-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">📋 Үйлдлийн бүртгэл ({auditLogs.length})</h3>
            <div className="admin-header-actions">
              <div className="admin-search-box">
                <input
                  type="text"
                  placeholder="Ажилтан, үйлдлээр хайх…"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="admin-search-input"
                />
                <Search size={14} className="admin-search-icon" />
              </div>
              <button
                type="button"
                onClick={() => void loadData()}
                className="homev2-button homev2-button--light"
                style={{ fontSize: 12, padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Шинэчлэх
              </button>
            </div>
          </div>

          {filteredAuditLogs.length > 0 ? (
            <div className="admin-list-stack">
              {filteredAuditLogs.map((log) => {
                const meta = formatAuditAction(log.action);
                return (
                  <div key={log.id} className="admin-audit-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <span className="admin-audit-icon" style={{ background: meta.bg }}>
                        {meta.icon}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ui-text)' }}>
                            {meta.label}
                          </span>
                          <span className="admin-pill-neutral">{log.action}</span>
                          <span className="admin-pill-neutral">{log.target_type}</span>
                        </div>
                        <div className="admin-muted-text" style={{ marginTop: 2 }}>
                          👤 {log.actor_name || log.actor_id.slice(0, 8)}
                          {log.target_id ? ` · 🎯 ${log.target_id.slice(0, 8)}…` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="admin-muted-text" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div>{new Date(log.created_at).toLocaleDateString('mn-MN')}</div>
                      <div>
                        {new Date(log.created_at).toLocaleTimeString('mn-MN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="admin-muted-text">Хайлтад тохирох үйлдэл олдсонгүй.</p>
          )}
        </section>
      )}

      {canManageSettings && (
        <section className="families-main-card">
          <h3 className="admin-card-title" style={{ marginBottom: 14 }}>
            ⚙️ Гэр бүлийн ерөнхий тохиргоо
          </h3>
          <form onSubmit={handleSaveSettings} style={{ display: 'grid', gap: 14, maxWidth: 620 }}>
            <label className="admin-field-label">
              Гэр бүлийн нэр *
              <input
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                required
                maxLength={180}
                disabled={busy}
                className="admin-field-input"
              />
            </label>
            <label className="admin-field-label">
              Тайлбар / Түүхэн товчоо
              <textarea
                value={familyDescription}
                onChange={(e) => setFamilyDescription(e.target.value)}
                rows={4}
                maxLength={10000}
                disabled={busy}
                className="admin-field-input"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="homev2-button homev2-button--primary"
              style={{ width: 'max-content', padding: '10px 22px' }}
            >
              {busy ? 'Хадгалж байна…' : '💾 Тохиргоо хадгалах'}
            </button>
          </form>

        </section>
      )}

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        busy={busy}
        onConfirm={() => void confirmState.onConfirm()}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
