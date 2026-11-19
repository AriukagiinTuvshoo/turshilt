'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, RefObject } from 'react';
import {
  Award,
  Download,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  Family,
  FamilyTrashItem,
  MemoryListItem,
  StoryListPage,
} from '../../lib/api';
import {
  AdminTabKey,
  AuditLogItem,
  formatAuditAction,
} from './admin-types';

export interface AdminGovernanceSectionProps {
  activeTab: AdminTabKey;
  selectedFamilyId: string;
  selectedFamily: Family | null;
  isOwner: boolean;
  isAdmin: boolean;
  actionBusy: boolean;
  detailLoading: boolean;
  stories: StoryListPage | null;
  memories: MemoryListItem[];
  setCertificateOpen: (open: boolean) => void;
  handleDeleteStory: (storyId: string) => void;
  handleDeleteMemory: (memoryId: string) => void;
  familyName: string;
  setFamilyName: (name: string) => void;
  familyDescription: string;
  setFamilyDescription: (desc: string) => void;
  handleSaveFamily: (e: FormEvent) => Promise<void>;
  onArchiveFamily: () => void;
  importingBackup: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  gedcomFileInputRef: RefObject<HTMLInputElement | null>;
  handleExportBackup: () => Promise<void>;
  handleImportBackup: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExportGedcom: () => void;
  handleImportGedcom: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  auditLogs: AuditLogItem[];
  filteredAuditLogs: AuditLogItem[];
  auditSearch: string;
  setAuditSearch: (query: string) => void;
  onRefreshDetails: () => void;
  trashItems: FamilyTrashItem[];
  handleEmptyTrash: () => void;
  handleRestoreTrash: (item: FamilyTrashItem) => Promise<void>;
  handlePurgeTrash: (item: FamilyTrashItem) => void;
}

export function AdminGovernanceSection({
  activeTab,
  selectedFamilyId,
  isOwner,
  isAdmin,
  actionBusy,
  detailLoading,
  stories,
  memories,
  setCertificateOpen,
  handleDeleteStory,
  handleDeleteMemory,
  familyName,
  setFamilyName,
  familyDescription,
  setFamilyDescription,
  handleSaveFamily,
  onArchiveFamily,
  importingBackup,
  fileInputRef,
  gedcomFileInputRef,
  handleExportBackup,
  handleImportBackup,
  handleExportGedcom,
  handleImportGedcom,
  auditLogs,
  filteredAuditLogs,
  auditSearch,
  setAuditSearch,
  onRefreshDetails,
  trashItems,
  handleEmptyTrash,
  handleRestoreTrash,
  handlePurgeTrash,
}: AdminGovernanceSectionProps) {
  if (activeTab === 'heritage') {
    return (
      <div className="admin-section-stack">
        <div className="families-main-card admin-cert-card">
          <div>
            <h3 className="admin-card-subtitle" style={{ marginBottom: 4 }}>
              Ургийн Батламж үүсгэх
            </h3>
            <p style={{ fontSize: 12.5, color: 'var(--ink-secondary, #485c53)', margin: 0 }}>
              Уламжлалт хэв маяг, тамга бүхий дурсгалын батламж үүсгэж хэвлэх эсвэл PDF татаж авна.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCertificateOpen(true)}
            className="homev2-button homev2-button--primary"
            style={{ fontSize: 12.5, padding: '8px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Award size={15} /> Батламж үүсгэх
          </button>
        </div>

        <div className="families-main-card">
          <h3 className="admin-card-subtitle">Манай түүхүүд ({stories?.items?.length ?? 0})</h3>
          {stories?.items?.length ? (
            <div className="admin-list-stack">
              {stories.items.map((st) => (
                <div key={st.id} className="admin-item-row">
                  <div>
                    <strong style={{ fontSize: 13.5, color: 'var(--ink-primary, #17372b)' }}>
                      {st.title}
                    </strong>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-muted, #74857b)' }}>
                      Огноо: {st.event_date || 'Тодорхойгүй'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Link
                      href={`/stories/${st.id}?family=${encodeURIComponent(selectedFamilyId)}`}
                      className="homev2-button homev2-button--light"
                      style={{ fontSize: 11, padding: '4px 8px' }}
                    >
                      Үзэх
                    </Link>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteStory(st.id)}
                        className="admin-remove-btn"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                      >
                        Устгах
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#74857b' }}>Одоогоор нийтлэгдсэн түүх алга.</p>
          )}
        </div>

        <div className="families-main-card">
          <h3 className="admin-card-title" style={{ marginBottom: 10 }}>
            📷 Дурсамж & Гэрэл зургууд ({memories.length})
          </h3>
          {memories.length ? (
            <div className="admin-memory-grid">
              {memories.map((mem) => (
                <div key={mem.id} className="admin-memory-card">
                  <div>
                    <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                      {mem.title}
                    </strong>
                    <small style={{ color: 'var(--ink-muted, #74857b)', fontSize: 11 }}>
                      {mem.memory_date || 'Огноогүй'}
                    </small>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
                    <Link
                      href={`/memories?family=${encodeURIComponent(selectedFamilyId)}`}
                      className="homev2-button homev2-button--light"
                      style={{ fontSize: 10, padding: '3px 8px' }}
                    >
                      Нээх
                    </Link>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteMemory(mem.id)}
                        className="admin-remove-btn"
                        style={{ fontSize: 10, padding: '3px 8px' }}
                      >
                        Устгах
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#74857b' }}>Одоогоор хадгалсан дурсамж алга.</p>
          )}
        </div>
      </div>
    );
  }

  if (activeTab === 'settings') {
    return (
      <div className="families-main-card">
        <h3 className="admin-card-title" style={{ marginBottom: 16 }}>
          ⚙️ Гэр бүлийн ерөнхий тохиргоо
        </h3>

        <form
          onSubmit={handleSaveFamily}
          style={{ display: 'grid', gap: 14, maxWidth: 600, marginBottom: 32 }}
        >
          <label className="admin-field-label" style={{ fontSize: 13 }}>
            Гэр бүлийн нэр:
            <input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              maxLength={180}
              required
              disabled={actionBusy}
              className="admin-field-input"
              style={{ padding: '10px 14px', marginTop: 6 }}
            />
          </label>
          <label className="admin-field-label" style={{ fontSize: 13 }}>
            Тайлбар:
            <textarea
              value={familyDescription}
              onChange={(e) => setFamilyDescription(e.target.value)}
              maxLength={10000}
              rows={4}
              disabled={actionBusy}
              className="admin-field-input"
              style={{ padding: '10px 14px', marginTop: 6 }}
            />
          </label>
          {isAdmin && (
            <button
              type="submit"
              className="homev2-button homev2-button--primary"
              disabled={actionBusy}
              style={{ width: 'max-content', padding: '10px 24px' }}
            >
              {actionBusy ? 'Хадгалж байна…' : 'Мэдээлэл хадгалах'}
            </button>
          )}
        </form>

        {isOwner && (
          <div className="admin-danger-box">
            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#dc2626', margin: '0 0 6px' }}>
              Аюултай бүс: Гэр бүлийг архивлах
            </h4>
            <p style={{ fontSize: 12, color: 'var(--ink-secondary, #485c53)', margin: '0 0 14px' }}>
              Гэр бүлийг архивласнаар идэвхтэй жагсаалтаас гарах бөгөөд зөвхөн сэргээх замаар ашиглана.
            </p>
            <button
              type="button"
              className="admin-remove-btn"
              onClick={onArchiveFamily}
              disabled={actionBusy}
            >
              Гэр бүлийг архивлах
            </button>
          </div>
        )}

        <div style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid var(--parchment-border, #e2d9c8)' }}>
          <details style={{ cursor: 'pointer' }}>
            <summary style={{ fontSize: 12, color: 'var(--ink-muted, #74857b)', userSelect: 'none' }}>
              Нөөц өгөгдөл татах, сэргээх (JSON / GEDCOM)
            </summary>
            <div style={{ marginTop: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => void handleExportBackup()}
                className="homev2-button homev2-button--light"
                style={{ fontSize: 11.5, padding: '6px 14px' }}
              >
                <Download size={13} style={{ display: 'inline', marginRight: 4 }} /> JSON нөөц татах
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={(e) => void handleImportBackup(e)}
                style={{ display: 'none' }}
                id="admin-backup-file-input"
                disabled={importingBackup}
              />
              <label
                htmlFor="admin-backup-file-input"
                className="homev2-button homev2-button--light"
                style={{
                  fontSize: 11.5,
                  padding: '6px 14px',
                  cursor: importingBackup ? 'not-allowed' : 'pointer',
                }}
              >
                {importingBackup ? 'Уншиж байна…' : 'JSON файл оруулах'}
              </label>

              <button
                type="button"
                onClick={handleExportGedcom}
                className="homev2-button homev2-button--light"
                style={{ fontSize: 11.5, padding: '6px 14px' }}
              >
                <Download size={13} style={{ display: 'inline', marginRight: 4 }} /> GEDCOM (.ged) татах
              </button>

              <input
                ref={gedcomFileInputRef}
                type="file"
                accept=".ged"
                onChange={(e) => void handleImportGedcom(e)}
                style={{ display: 'none' }}
                id="admin-gedcom-file-input"
                disabled={importingBackup}
              />
              <label
                htmlFor="admin-gedcom-file-input"
                className="homev2-button homev2-button--light"
                style={{
                  fontSize: 11.5,
                  padding: '6px 14px',
                  cursor: importingBackup ? 'not-allowed' : 'pointer',
                }}
              >
                {importingBackup ? 'Уншиж байна…' : 'GEDCOM (.ged) оруулах'}
              </label>
            </div>
          </details>
        </div>
      </div>
    );
  }

  if (activeTab === 'audit') {
    return (
      <div className="families-main-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">Үйлдлийн бүртгэл ({auditLogs.length})</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="admin-search-box">
              <input
                type="text"
                placeholder="Үйлдэл, ID-аар хайх…"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="admin-search-input"
              />
              <Search size={14} className="admin-search-icon" />
            </div>
            <button
              type="button"
              onClick={onRefreshDetails}
              className="homev2-button homev2-button--light"
              style={{ fontSize: 12, padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={13} className={detailLoading ? 'animate-spin' : ''} /> Шинэчлэх
            </button>
          </div>
        </div>

        {filteredAuditLogs.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
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
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-primary, #17372b)' }}>
                          {meta.label}
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: meta.bg,
                            color: meta.color,
                            fontWeight: 600,
                          }}
                        >
                          {log.action}
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: '#f1f5f9',
                            color: '#475569',
                          }}
                        >
                          Төрөл: {log.target_type}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted, #74857b)', marginTop: 2, display: 'flex', gap: 12 }}>
                        <span>Ажилтан: {log.actor_id.slice(0, 8)}…</span>
                        <span>Бай: {log.target_id.slice(0, 8)}…</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted, #74857b)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <div>{new Date(log.created_at).toLocaleDateString('mn-MN')}</div>
                    <div style={{ fontSize: 10.5 }}>
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
          <p style={{ fontSize: 13, color: '#74857b', padding: '16px 0' }}>
            {auditSearch
              ? 'Хайлтад тохирох үйлдэл олдсонгүй.'
              : 'Одоогоор бүртгэгдсэн үйлдлийн түүх байхгүй байна.'}
          </p>
        )}
      </div>
    );
  }

  if (activeTab === 'trash') {
    return (
      <div className="families-main-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">Хогийн сав ({trashItems.length})</h3>
          {trashItems.length > 0 && isAdmin && (
            <button
              type="button"
              onClick={handleEmptyTrash}
              className="admin-remove-btn"
              disabled={actionBusy}
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              <Trash2 size={13} style={{ display: 'inline', marginRight: 6 }} />
              Хогийн савыг бүрэн цэвэрлэх
            </button>
          )}
        </div>

        {trashItems.length === 0 ? (
          <div className="admin-trash-empty">
            <div style={{ fontSize: 32, marginBottom: 10 }}>🌱</div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Хогийн сав хоосон байна</p>
            <p style={{ margin: '4px 0 0', fontSize: 12 }}>
              Модноос хасагдсан гишүүн одоогоор байхгүй байна.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {trashItems.map((item) => (
              <div key={item.id} className="admin-trash-row">
                <div>
                  <strong style={{ fontSize: 15, color: 'var(--ink-primary, #17372b)' }}>
                    {item.person_name}
                  </strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 11.5, color: 'var(--ink-muted, #74857b)' }}>
                    <span>Устгасан: {new Date(item.deleted_at).toLocaleString('mn-MN')}</span>
                    <span>·</span>
                    <span>Хассан гишүүн: {item.deleted_by_name}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => void handleRestoreTrash(item)}
                    className="homev2-button homev2-button--primary"
                    disabled={actionBusy}
                    style={{
                      fontSize: 11.5,
                      padding: '6px 14px',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      border: 'none',
                      color: '#fff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <RefreshCw size={13} />
                    Буцаан сэргээх
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePurgeTrash(item)}
                    className="admin-remove-btn"
                    disabled={actionBusy}
                    style={{ fontSize: 11.5, padding: '6px 12px' }}
                    title="Бүрмөсөн устгах"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}
