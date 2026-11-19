'use client';

import { FormEvent, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Mail,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Family, FamilyMemberItem, Person } from '../../lib/api';
import { useFocusTrap } from '../../lib/use-focus-trap';
import {
  AdminTabKey,
  Invitation,
  RoleBadge,
  roleLabel,
  permissionEmojiMeta,
} from './admin-types';

export interface AdminMembersSectionProps {
  activeTab: AdminTabKey;
  selectedFamily: Family | null;
  people: Person[];
  members: FamilyMemberItem[];
  invitations: Invitation[];
  isOwner: boolean;
  isAdmin: boolean;
  canManageMembers: boolean;
  actionBusy: boolean;
  handleUpdateRole: (targetUserId: string, nextRole: string) => Promise<void>;
  handleRemoveMember: (targetUserId: string, name: string) => void;
  handleUnlinkMember: (targetUserId: string, memberName: string) => void;
  linkingMember: FamilyMemberItem | null;
  setLinkingMember: (member: FamilyMemberItem | null) => void;
  selectedPersonForLink: string;
  setSelectedPersonForLink: (personId: string) => void;
  linkSearchQuery: string;
  setLinkSearchQuery: (query: string) => void;
  handleLinkMember: (targetUserId: string, personId: string) => Promise<void>;
  inviteEmail: string;
  setInviteEmail: (email: string) => void;
  inviteRole: 'admin' | 'member' | 'editor';
  setInviteRole: (role: 'admin' | 'member' | 'editor') => void;
  createdInviteUrl: string | null;
  setCreatedInviteUrl: (url: string | null) => void;
  copiedInvite: boolean;
  setCopiedInvite: (copied: boolean) => void;
  handleSendInvite: (e: FormEvent) => Promise<void>;
  handleRevokeInvite: (invitationId: string, email: string) => void;
}

export function AdminMembersSection({
  activeTab,
  selectedFamily,
  people,
  members,
  invitations,
  isOwner,
  isAdmin,
  canManageMembers,
  actionBusy,
  handleUpdateRole,
  handleRemoveMember,
  handleUnlinkMember,
  linkingMember,
  setLinkingMember,
  selectedPersonForLink,
  setSelectedPersonForLink,
  linkSearchQuery,
  setLinkSearchQuery,
  handleLinkMember,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  createdInviteUrl,
  setCreatedInviteUrl,
  copiedInvite,
  setCopiedInvite,
  handleSendInvite,
  handleRevokeInvite,
}: AdminMembersSectionProps) {
  const [nowMs] = useState(() => Date.now());
  const linkModalRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(Boolean(linkingMember), linkModalRef, {
    onEscape: () => setLinkingMember(null),
  });

  const canLink = isAdmin || canManageMembers;

  return (
    <>
      {activeTab === 'members' && (
        <div className="families-main-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">👥 Гэр бүлийн гишүүд ({members.length})</h3>
          </div>

          <div className="admin-members-list">
            {members.map((member) => {
              const linkedP = member.person_id
                ? people.find((p) => p.id === member.person_id)
                : undefined;

              return (
                <div key={member.user_id} className="admin-member-card">
                  <div className="admin-member-left">
                    <div className="admin-member-avatar">
                      {member.display_name?.slice(0, 1).toUpperCase() || '?'}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 14.5, color: 'var(--ui-text)' }}>
                        {member.display_name}
                      </strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        <RoleBadge role={member.role} adminTitle={member.admin_title} />
                        {member.email ? (
                          <span className="admin-muted-text">✉️ {member.email}</span>
                        ) : (
                          <span className="admin-muted-text">ID: {member.user_id.slice(0, 8)}…</span>
                        )}
                        {member.person_id ? (
                          <span className="admin-linked-pill">
                            🌿 Модон дахь хүн:{' '}
                            {linkedP ? `${linkedP.last_name} ${linkedP.first_name}` : 'Холбогдсон'}
                            {canLink && (
                              <button
                                type="button"
                                onClick={() => handleUnlinkMember(member.user_id, member.display_name)}
                                className="admin-inline-btn-link is-danger"
                                title="Энэ холбоосыг салгах"
                              >
                                Салгах
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="admin-unlinked-pill">
                            ⚠️ Модонд холбогдоогүй
                            {canLink && (
                              <button
                                type="button"
                                onClick={() => {
                                  setLinkingMember(member);
                                  setSelectedPersonForLink('');
                                  setLinkSearchQuery('');
                                }}
                                className="admin-inline-btn-link is-info"
                              >
                                + Хүнтэй холбох
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                      {member.role === 'admin' && (member.permissions?.length ?? 0) > 0 && (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                          {member.permissions!.map((perm) => {
                            const meta = permissionEmojiMeta(perm);
                            return (
                              <span key={perm} className="admin-perm-chip">
                                {meta.emoji} {meta.label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="admin-member-right">
                    {isOwner ? (
                      <>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ui-text-secondary)' }}>
                          <span>Эрх:</span>
                          <select
                            value={member.role}
                            onChange={(e) => void handleUpdateRole(member.user_id, e.target.value)}
                            disabled={actionBusy}
                            className="admin-role-select"
                          >
                            <option value="owner">👑 Ерөнхий админ</option>
                            <option value="admin">🛡️ Туслах админ</option>
                            <option value="editor">✏️ Засварлагч</option>
                            <option value="member">👤 Гишүүн</option>
                          </select>
                        </label>
                        {member.role !== 'owner' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.user_id, member.display_name)}
                            disabled={actionBusy}
                            className="admin-remove-btn"
                          >
                            <Trash2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                            Хасах
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <RoleBadge role={member.role} adminTitle={member.admin_title} />
                        {canManageMembers && member.role !== 'owner' && member.role !== 'admin' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.user_id, member.display_name)}
                            disabled={actionBusy}
                            className="admin-remove-btn"
                          >
                            <Trash2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                            Хасах
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'invitations' && (
        <div className="families-main-card">
          <h3 className="admin-card-title" style={{ marginBottom: 16 }}>
            ✉️ Урилга илгээх ба Хүлээгдэж буй холбоос
          </h3>

          {createdInviteUrl && (
            <div className="admin-invite-banner">
              <div className="admin-card-header" style={{ marginBottom: 10 }}>
                <div className="admin-alert-inner">
                  <CheckCircle2 size={18} style={{ color: 'var(--ui-success-text)' }} />
                  <strong style={{ fontSize: 15, color: 'var(--ui-success-text)' }}>
                    Шинэ урилгын нууц холбоос амжилттай үүсгэгдлээ!
                  </strong>
                </div>
                <button
                  type="button"
                  onClick={() => setCreatedInviteUrl(null)}
                  className="admin-icon-close"
                  aria-label="Урилгын баннер хаах"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="admin-muted-text" style={{ margin: '0 0 12px' }}>
                Уригдсан хүн рүүгээ доорх холбоосыг Telegram, Messenger, SMS эсвэл WhatsApp-аар шууд илгээнэ үү:
              </p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                <input
                  type="text"
                  readOnly
                  value={createdInviteUrl}
                  onFocus={(e) => e.target.select()}
                  className="admin-invite-url-input"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(createdInviteUrl);
                    setCopiedInvite(true);
                    setTimeout(() => setCopiedInvite(false), 2400);
                  }}
                  className="admin-action-accent-btn"
                >
                  {copiedInvite ? <Check size={14} /> : <Copy size={14} />}
                  {copiedInvite ? 'Хуулагдлаа!' : '1-Click Холбоос хуулах'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="admin-muted-text">Шууд хуваалцах:</span>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(createdInviteUrl)}&text=${encodeURIComponent(`Сайн байна уу? Гуулингийнхан систем дэх “${selectedFamily?.name}” ургийн бичигт нэгдэх урилга:`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="homev2-button homev2-button--light"
                  style={{ fontSize: 11.5, padding: '4px 12px' }}
                >
                  ✈️ Telegram
                </a>
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Сайн байна уу? Гуулингийнхан систем дэх “${selectedFamily?.name}” ургийн бичигт нэгдэх урилга: ${createdInviteUrl}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="homev2-button homev2-button--light"
                  style={{ fontSize: 11.5, padding: '4px 12px' }}
                >
                  💬 WhatsApp
                </a>
              </div>
            </div>
          )}

          {canManageMembers ? (
            <form onSubmit={handleSendInvite} className="admin-inline-form">
              <h4 className="admin-form-heading">✨ Шинэ гишүүн урих &amp; Холбоос үүсгэх</h4>
              <div className="admin-form-grid">
                <label className="admin-field-label">
                  Имэйл хаяг:
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="gerbul@example.mn"
                    required
                    disabled={actionBusy}
                    className="admin-field-input"
                  />
                </label>
                <label className="admin-field-label">
                  Олгох эрхийн үүрэг:
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'editor')}
                    disabled={actionBusy}
                    className="admin-field-input"
                  >
                    <option value="member">👤 Гишүүн (Мод, түүх, чат)</option>
                    <option value="editor">✏️ Засварлагч (Мод ба хүмүүс засна)</option>
                    {isOwner && (
                      <option value="admin">🛡️ Туслах админ (Бүрэн админ эрх)</option>
                    )}
                  </select>
                </label>
              </div>
              <button
                type="submit"
                className="homev2-button homev2-button--primary"
                disabled={actionBusy}
                style={{ fontSize: 12.5, padding: '9px 20px' }}
              >
                {actionBusy ? 'Илгээж байна…' : '✉️ Урилга үүсгэх & Холбоос авах'}
              </button>
            </form>
          ) : (
            <p className="admin-muted-text" style={{ marginBottom: 16 }}>
              🔒 Урилга илгээхийн тулд &quot;Гишүүд &amp; Урилга&quot; админ эрх шаардлагатай.
            </p>
          )}

          <h4 className="admin-form-heading">
            Хүлээгдэж буй идэвхтэй урилгууд ({invitations.length})
          </h4>
          {invitations.length ? (
            <div className="admin-list-stack">
              {invitations.map((inv) => {
                const daysLeft = Math.max(
                  0,
                  Math.ceil((new Date(inv.expires_at).getTime() - nowMs) / (1000 * 60 * 60 * 24)),
                );
                return (
                  <div key={inv.id} className="admin-item-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Mail size={18} style={{ color: 'var(--ui-accent-text)' }} />
                      <div>
                        <strong style={{ fontSize: 14, color: 'var(--ui-text)' }}>
                          {inv.email}
                        </strong>
                        <div className="admin-muted-text">
                          Хүчинтэй хугацаа: {new Date(inv.expires_at).toLocaleDateString('mn-MN')} ({daysLeft} хоног үлдсэн)
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <RoleBadge role={inv.role} />
                      {canManageMembers && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleRevokeInvite(inv.id, inv.email)}
                          className="admin-remove-btn"
                          style={{ padding: '4px 10px', fontSize: 11.5 }}
                        >
                          Цуцлах
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="admin-muted-text" style={{ padding: '12px 0' }}>
              Идэвхтэй хүлээгдэж буй урилга алга байна.
            </p>
          )}
        </div>
      )}

      {linkingMember && (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLinkingMember(null);
          }}
        >
          <div
            ref={linkModalRef}
            className="admin-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-member-modal-title"
          >
            <div className="admin-modal-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 id="link-member-modal-title" className="admin-modal-title">
                    👤 Гишүүнийг модон дахь хүнтэй холбох
                  </h3>
                  <p className="admin-modal-sub">
                    Хэрэглэгч: <strong>{linkingMember.display_name || linkingMember.email}</strong> (
                    {roleLabel(linkingMember.role, linkingMember.admin_title)})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLinkingMember(null)}
                  className="admin-icon-close"
                  aria-label="Цонх хаах"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="admin-modal-body">
              <p className="admin-modal-desc">
                Энэ хэрэглэгчийг ургийн модон дахь өөрийнх нь бие хүнтэй холбосноор өөрийн нэр дээрх мэдээлэл, дурсамж, ураг төрлийн тооцоолуурыг шууд уялдуулан харна.
              </p>

              <div className="admin-search-box" style={{ marginBottom: 14 }}>
                <Search size={16} className="admin-search-icon" />
                <input
                  type="text"
                  value={linkSearchQuery}
                  onChange={(e) => setLinkSearchQuery(e.target.value)}
                  placeholder="Хүний нэр, овгоор хайх..."
                  className="admin-search-input"
                />
              </div>

              <div className="admin-link-list">
                {people
                  .filter((p) => {
                    if (!linkSearchQuery.trim()) return true;
                    const q = linkSearchQuery.toLowerCase();
                    const fn = (p.first_name || '').toLowerCase();
                    const ln = (p.last_name || '').toLowerCase();
                    const mn = (p.middle_name || '').toLowerCase();
                    return fn.includes(q) || ln.includes(q) || mn.includes(q);
                  })
                  .map((p) => {
                    const isSelected = selectedPersonForLink === p.id;
                    const isCurrent = linkingMember.person_id === p.id;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => setSelectedPersonForLink(p.id)}
                        className={`admin-link-option ${isSelected ? 'is-selected' : isCurrent ? 'is-current' : ''}`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className={`admin-link-avatar ${p.gender === 'female' ? 'is-female' : ''}`}>
                            {(p.first_name || '?')[0]}
                          </div>
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ui-text)' }}>
                              {p.last_name ? `${p.last_name} ` : ''}
                              {p.first_name}
                              {p.gender === 'female' ? ' ♀' : p.gender === 'male' ? ' ♂' : ''}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>
                              {p.birth_date ? p.birth_date.slice(0, 4) : 'Төрсөн он тодорхойгүй'}
                              {p.is_alive ? ' (Энх тунх)' : p.death_date ? ` - ${p.death_date.slice(0, 4)}` : ''}
                            </div>
                          </div>
                        </div>
                        {isCurrent && (
                          <span className="admin-linked-pill">Одоогийн холбоос</span>
                        )}
                        {isSelected && !isCurrent && (
                          <CheckCircle2 size={18} style={{ color: 'var(--ui-success-text)' }} />
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                onClick={() => setLinkingMember(null)}
                className="homev2-button homev2-button--light"
              >
                Болих
              </button>
              <button
                type="button"
                disabled={!selectedPersonForLink || actionBusy}
                onClick={() => void handleLinkMember(linkingMember.user_id, selectedPersonForLink)}
                className="homev2-button homev2-button--primary"
              >
                {actionBusy ? 'Холбож байна…' : '🔗 Холбоосыг батлах'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
