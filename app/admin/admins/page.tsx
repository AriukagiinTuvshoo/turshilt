'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Crown, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { api, FamilyMemberItem } from '../../../lib/api';
import { useFocusTrap } from '../../../lib/use-focus-trap';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { useAdminContext } from '../../../components/admin/admin-shell';
import {
  ADMIN_ROLE_PRESETS,
  AdminPermissionKey,
  friendlyError,
  Invitation,
  PERMISSION_CATALOG,
  permissionEmojiMeta,
  RoleBadge,
  roleLabel,
} from '../../../components/admin/admin-types';

const DEFAULT_ALL_PERMS: AdminPermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);

export default function AdminRolesPage() {
  const {
    selectedFamilyId,
    selectedFamily,
    isOwner,
    can,
    setNotice,
    setError,
    refreshOverview,
    reloadFamilies,
  } = useAdminContext();

  const [members, setMembers] = useState<FamilyMemberItem[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState(false);

  // Promote existing member form
  const [promoteUserId, setPromoteUserId] = useState('');
  const [promoteTitle, setPromoteTitle] = useState('');
  const [promotePerms, setPromotePerms] = useState<AdminPermissionKey[]>(DEFAULT_ALL_PERMS);
  const [selectedPresetId, setSelectedPresetId] = useState('full-helper');

  // Direct sub-admin invite
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit existing admin/member modal
  const [editingMember, setEditingMember] = useState<FamilyMemberItem | null>(null);
  const [editRole, setEditRole] = useState<'admin' | 'editor' | 'member'>('admin');
  const [editTitle, setEditTitle] = useState('');
  const [editPerms, setEditPerms] = useState<AdminPermissionKey[]>(DEFAULT_ALL_PERMS);

  const editModalRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(Boolean(editingMember), editModalRef, {
    onEscape: () => setEditingMember(null),
  });

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
    variant: 'warning',
    onConfirm: async () => {},
  });

  const loadMembers = useCallback(async () => {
    if (!selectedFamilyId) return;
    setLoadingList(true);
    try {
      const [memberData, inviteData] = await Promise.all([
        api<FamilyMemberItem[]>(`/families/${selectedFamilyId}/members`),
        can('manage_members')
          ? api<Invitation[]>(`/families/${selectedFamilyId}/invitations`).catch(() => [])
          : Promise.resolve([]),
      ]);
      setMembers(memberData);
      setInvitations(inviteData);
      const firstNonOwner = memberData.find((m) => m.role !== 'owner');
      setPromoteUserId((curr) =>
        curr && memberData.some((m) => m.user_id === curr && m.role !== 'owner')
          ? curr
          : firstNonOwner?.user_id ?? '',
      );
    } catch (cause) {
      setError(friendlyError(cause, 'Админы бүрэлдэхүүнийг ачаалж чадсангүй.'));
    } finally {
      setLoadingList(false);
    }
  }, [can, selectedFamilyId, setError]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const adminTeam = useMemo(
    () => members.filter((m) => m.role === 'owner' || m.role === 'admin'),
    [members],
  );
  const promotableMembers = useMemo(
    () => members.filter((m) => m.role !== 'owner'),
    [members],
  );
  const pendingAdminInvites = useMemo(
    () => invitations.filter((inv) => inv.role === 'admin'),
    [invitations],
  );

  const togglePerm = (
    list: AdminPermissionKey[],
    setter: (next: AdminPermissionKey[]) => void,
    key: AdminPermissionKey,
  ) => {
    setter(list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
  };

  const applyPreset = (presetId: string) => {
    const preset = ADMIN_ROLE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(preset.id);
    setPromotePerms([...preset.permissions]);
    setPromoteTitle(preset.title);
  };

  const handlePromoteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !promoteUserId || !isOwner) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api<FamilyMemberItem>(
        `/families/${selectedFamilyId}/members/${promoteUserId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            role: 'admin',
            admin_title: promoteTitle.trim() || null,
            permissions: promotePerms,
          }),
        },
      );
      setNotice(
        `🛡️ “${updated.display_name}” хэрэглэгчийг ${updated.admin_title || 'Туслах админ'}-аар томиллоо!`,
      );
      await Promise.all([loadMembers(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Туслах админ томилох үед алдаа гарлаа.'));
    } finally {
      setBusy(false);
    }
  };

  const handleInviteSubAdmin = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !inviteEmail.trim() || !isOwner) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api<{ invite_url?: string }>(`/families/${selectedFamilyId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: 'admin' }),
      });
      setInviteEmail('');
      setInviteUrl(res.invite_url ?? null);
      setNotice('✉️ Шинэ туслах админы урилгын холбоос үүсгэгдлээ.');
      await Promise.all([loadMembers(), refreshOverview()]);
    } catch (cause) {
      setError(
        friendlyError(cause, 'Урилга илгээхэд алдаа гарлаа.', 'Энэ хаяг аль хэдийн гишүүн эсвэл идэвхтэй урилгатай байна.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const openEditModal = (member: FamilyMemberItem) => {
    setEditingMember(member);
    setEditRole(
      member.role === 'admin' || member.role === 'editor' || member.role === 'member'
        ? member.role
        : 'admin',
    );
    setEditTitle(member.admin_title ?? '');
    const currentPerms = (member.permissions ?? []).filter((p): p is AdminPermissionKey =>
      PERMISSION_CATALOG.some((c) => c.key === p),
    );
    setEditPerms(
      member.role === 'admin' ? currentPerms : DEFAULT_ALL_PERMS,
    );
  };

  const handleSaveEditModal = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !editingMember || !isOwner) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/families/${selectedFamilyId}/members/${editingMember.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          role: editRole,
          ...(editRole === 'admin'
            ? {
                admin_title: editTitle.trim() || null,
                permissions: editPerms,
              }
            : {}),
        }),
      });
      setNotice(`🎛️ “${editingMember.display_name}” гишүүний админ эрх амжилттай шинэчлэгдлээ.`);
      setEditingMember(null);
      await Promise.all([loadMembers(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Эрх шинэчлэх үед алдаа гарлаа.'));
    } finally {
      setBusy(false);
    }
  };

  const requestTransferOwnership = (member: FamilyMemberItem) => {
    setConfirmState({
      isOpen: true,
      title: '👑 Ерөнхий админы эрх шилжүүлэх',
      message: `Та "${member.display_name}"-д Ерөнхий админ (Owner) эрхийг бүрэн шилжүүлэхдээ итгэлтэй байна уу? Та өөрөө Туслах админ (Sub-Admin) болно.`,
      confirmLabel: '👑 Эрх шилжүүлэх',
      variant: 'warning',
      onConfirm: async () => {
        setBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/members/${member.user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: 'owner' }),
          });
          setEditingMember(null);
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice(`👑 Ерөнхий админы эрх “${member.display_name}” руу шилжлээ.`);
          await Promise.all([reloadFamilies(), loadMembers(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Эзэмшигч шилжүүлэхэд алдаа гарлаа.'));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const requestRemoveMember = (member: FamilyMemberItem) => {
    setConfirmState({
      isOpen: true,
      title: '🚪 Гэр бүлээс хасах',
      message: `"${member.display_name}" хэрэглэгчийг гэр бүлийн бүртгэлээс хасах уу?`,
      confirmLabel: 'Хасах',
      variant: 'danger',
      onConfirm: async () => {
        setBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/members/${member.user_id}`, {
            method: 'DELETE',
          });
          setEditingMember(null);
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice(`🚪 “${member.display_name}”-г гэр бүлийн багаас хаслаа.`);
          await Promise.all([loadMembers(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Гишүүн хасах үед алдаа гарлаа.'));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  if (!selectedFamily) return null;

  return (
    <div className="admin-section-stack">
      <section className="families-main-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">👑 Админ баг ба Туслах үүргүүд ({adminTeam.length})</h2>
            <p className="admin-muted-text" style={{ margin: '4px 0 0' }}>
              Ерөнхий админ (Owner) нь бусад гишүүдийг Туслах админ болгон дэвшүүлж, хийж чадах үйлдлийг нь нарийн сонгож олгоно.
            </p>
          </div>
          {!isOwner && (
            <span className="admin-pill-neutral">
              🔒 Зөвхөн Ерөнхий админ (Owner) админ нэмэх/өөрчлөх эрхтэй
            </span>
          )}
        </div>

        {loadingList ? (
          <div className="admin-trash-empty">👑 Админ багийг ачаалж байна…</div>
        ) : (
          <div className="admin-list-stack">
            {adminTeam.map((member) => (
              <div key={member.user_id} className="admin-item-row">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: '1 1 280px' }}>
                  <div className="admin-person-avatar is-male">
                    {member.display_name?.slice(0, 1).toUpperCase() || '?'}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: 'var(--ui-text)' }}>
                        {member.display_name}
                      </strong>
                      <RoleBadge role={member.role} adminTitle={member.admin_title} />
                    </div>
                    {member.email && (
                      <div className="admin-muted-text" style={{ marginTop: 2 }}>
                        ✉️ {member.email}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {(member.permissions ?? []).map((perm) => {
                        const meta = permissionEmojiMeta(perm);
                        return (
                          <span key={perm} className="admin-perm-chip">
                            <span>{meta.emoji}</span>
                            <span>{meta.label}</span>
                          </span>
                        );
                      })}
                      {member.role === 'admin' && (member.permissions ?? []).length === 0 && (
                        <span className="admin-pill-neutral">Онцгой эрх сонгоогүй</span>
                      )}
                    </div>
                  </div>
                </div>

                {isOwner && member.role !== 'owner' && (
                  <button
                    type="button"
                    onClick={() => openEditModal(member)}
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: 12, padding: '7px 14px' }}
                  >
                    🎛️ Эрх &amp; Үүрэг засах
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {isOwner && (
        <section className="families-main-card">
          <h3 className="admin-card-subtitle">🛡️ Туслах админ томилох (Одоо байгаа гишүүдээс)</h3>
          {promotableMembers.length === 0 ? (
            <p className="admin-muted-text">
              Дэвшүүлэх боломжтой өөр гишүүн одоогоор алга байна. Доорх хэсгээр шинэ туслах админыг имэйлээр шууд урина уу.
            </p>
          ) : (
            <form onSubmit={handlePromoteSubmit}>
              <div className="admin-form-grid">
                <label className="admin-field-label">
                  Гишүүн сонгох *
                  <select
                    value={promoteUserId}
                    onChange={(e) => setPromoteUserId(e.target.value)}
                    className="admin-field-input"
                    required
                  >
                    {promotableMembers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name} — {roleLabel(m.role, m.admin_title)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-field-label">
                  Туслах үүргийн нэр (жишээ нь: Дата шинэчлэгч)
                  <input
                    value={promoteTitle}
                    onChange={(e) => setPromoteTitle(e.target.value)}
                    maxLength={80}
                    placeholder="Ж: Өгөгдөл ба Мод хариуцагч"
                    className="admin-field-input"
                  />
                </label>
              </div>

              <div style={{ marginBottom: 10 }}>
                <span className="admin-field-label" style={{ marginBottom: 8 }}>
                  ⚡ 1 даралтаар туслах загвар сонгох:
                </span>
                <div className="admin-preset-grid">
                  {ADMIN_ROLE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset.id)}
                      className={`admin-preset-card ${selectedPresetId === preset.id ? 'is-selected' : ''}`}
                    >
                      <strong>
                        {preset.emoji} {preset.title}
                      </strong>
                      <span>{preset.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <span className="admin-field-label" style={{ marginBottom: 8 }}>
                  🎛️ Олгох админ эрхүүд ({promotePerms.length}/{PERMISSION_CATALOG.length}):
                </span>
                <div className="admin-perm-grid">
                  {PERMISSION_CATALOG.map((perm) => {
                    const checked = promotePerms.includes(perm.key);
                    return (
                      <label
                        key={perm.key}
                        className={`admin-perm-toggle ${checked ? 'is-checked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePerm(promotePerms, setPromotePerms, perm.key)}
                        />
                        <span>
                          <strong>
                            {perm.emoji} {perm.label}
                          </strong>
                          <small>{perm.description}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={busy || !promoteUserId}
                className="homev2-button homev2-button--primary"
                style={{ fontSize: 12.5, padding: '10px 20px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <ShieldCheck size={15} />
                {busy ? 'Хадгалж байна…' : '🛡️ Туслах админаар томилох'}
              </button>
            </form>
          )}
        </section>
      )}

      {isOwner && (
        <section className="families-main-card">
          <h3 className="admin-card-subtitle">✉️ Шинэ туслах админ имэйлээр шууд урих</h3>

          {inviteUrl && (
            <div className="admin-invite-banner">
              <div className="admin-card-header" style={{ marginBottom: 10 }}>
                <strong style={{ color: 'var(--ui-success-text)' }}>
                  🔗 Туслах админы урилгын холбоос бэлэн боллоо!
                </strong>
                <button
                  type="button"
                  onClick={() => setInviteUrl(null)}
                  className="admin-icon-close"
                  aria-label="Урилгын баннер хаах"
                >
                  <X size={16} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  onFocus={(e) => e.target.select()}
                  className="admin-invite-url-input"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(inviteUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2400);
                  }}
                  className="admin-action-accent-btn"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Хуулагдлаа!' : 'Хуулах'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(`Гуулингийнхан — "${selectedFamily.name}" ургийн бичгийн Туслах админаар нэгдэх урилга:`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="homev2-button homev2-button--light"
                  style={{ fontSize: 11.5, padding: '5px 12px' }}
                >
                  ✈️ Telegram
                </a>
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Гуулингийнхан — "${selectedFamily.name}" ургийн бичгийн Туслах админаар нэгдэх урилга: ${inviteUrl}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="homev2-button homev2-button--light"
                  style={{ fontSize: 11.5, padding: '5px 12px' }}
                >
                  💬 WhatsApp
                </a>
              </div>
            </div>
          )}

          <form onSubmit={handleInviteSubAdmin} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="admin-field-label" style={{ flex: '1 1 260px' }}>
              Урих хүний имэйл хаяг *
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="helper-admin@example.mn"
                required
                disabled={busy}
                className="admin-field-input"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="homev2-button homev2-button--primary"
              style={{ fontSize: 12.5, padding: '9px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <UserPlus size={14} /> 🛡️ Туслах админаар урих
            </button>
          </form>

          {pendingAdminInvites.length > 0 && (
            <div className="admin-list-stack" style={{ marginTop: 16 }}>
              {pendingAdminInvites.map((inv) => (
                <div key={inv.id} className="admin-item-row">
                  <span>✉️ {inv.email}</span>
                  <RoleBadge role={inv.role} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {editingMember && (
        <div className="admin-modal-backdrop" role="presentation">
          <div
            ref={editModalRef}
            className="admin-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-admin-modal-title"
          >
            <div className="admin-modal-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 id="edit-admin-modal-title" className="admin-modal-title">
                    🎛️ {editingMember.display_name} — Админ эрх засах
                  </h3>
                  <p className="admin-modal-sub">{editingMember.email || editingMember.user_id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="admin-icon-close"
                  aria-label="Цонх хаах"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveEditModal}>
              <div className="admin-modal-body">
                <div className="admin-form-grid">
                  <label className="admin-field-label">
                    Эрхийн түвшин
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as 'admin' | 'editor' | 'member')}
                      className="admin-field-input"
                    >
                      <option value="admin">🛡️ Туслах админ (Sub-Admin)</option>
                      <option value="editor">✏️ Засварлагч (Editor)</option>
                      <option value="member">👤 Энгийн гишүүн (Member)</option>
                    </select>
                  </label>

                  {editRole === 'admin' && (
                    <label className="admin-field-label">
                      Туслах үүргийн нэр
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        maxLength={80}
                        placeholder="Ж: Архив хариуцагч"
                        className="admin-field-input"
                      />
                    </label>
                  )}
                </div>

                {editRole === 'admin' && (
                  <div className="admin-perm-grid">
                    {PERMISSION_CATALOG.map((perm) => {
                      const checked = editPerms.includes(perm.key);
                      return (
                        <label
                          key={perm.key}
                          className={`admin-perm-toggle ${checked ? 'is-checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePerm(editPerms, setEditPerms, perm.key)}
                          />
                          <span>
                            <strong>
                              {perm.emoji} {perm.label}
                            </strong>
                            <small>{perm.description}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--ui-border)' }}>
                  <button
                    type="button"
                    onClick={() => requestTransferOwnership(editingMember)}
                    disabled={busy}
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: 11.5, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <Crown size={13} /> 👑 Ерөнхий админ болгох
                  </button>
                  <button
                    type="button"
                    onClick={() => requestRemoveMember(editingMember)}
                    disabled={busy}
                    className="admin-remove-btn"
                    style={{ fontSize: 11.5, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <Trash2 size={13} /> 🚪 Гэр бүлээс хасах
                  </button>
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="homev2-button homev2-button--light"
                >
                  Болих
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="homev2-button homev2-button--primary"
                >
                  {busy ? 'Хадгалж байна…' : '💾 Хадгалах'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
