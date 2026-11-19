'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { FamilyMemberItem, Person, api } from '../../../lib/api';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { useAdminContext } from '../../../components/admin/admin-shell';
import { AdminMembersSection } from '../../../components/admin/admin-members-section';
import { friendlyError, Invitation, roleLabel } from '../../../components/admin/admin-types';

export default function AdminMembersPage() {
  const {
    selectedFamilyId,
    selectedFamily,
    isOwner,
    isAdminRole,
    can,
    setNotice,
    setError,
    refreshOverview,
    reloadFamilies,
  } = useAdminContext();

  const [subView, setSubView] = useState<'members' | 'invitations'>('members');
  const [members, setMembers] = useState<FamilyMemberItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [actionBusy, setActionBusy] = useState(false);

  const [linkingMember, setLinkingMember] = useState<FamilyMemberItem | null>(null);
  const [selectedPersonForLink, setSelectedPersonForLink] = useState('');
  const [linkSearchQuery, setLinkSearchQuery] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'editor'>('member');
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

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

  const canManageMembers = can('manage_members');

  const loadData = useCallback(async () => {
    if (!selectedFamilyId) return;
    try {
      const [memberData, peopleData, inviteData] = await Promise.all([
        api<FamilyMemberItem[]>(`/families/${selectedFamilyId}/members`),
        api<Person[]>(`/families/${selectedFamilyId}/persons`).catch(() => []),
        canManageMembers
          ? api<Invitation[]>(`/families/${selectedFamilyId}/invitations`).catch(() => [])
          : Promise.resolve([]),
      ]);
      setMembers(memberData);
      setPeople(peopleData);
      setInvitations(inviteData);
    } catch (cause) {
      setError(friendlyError(cause, 'Гишүүдийн жагсаалтыг ачаалж чадсангүй.'));
    }
  }, [canManageMembers, selectedFamilyId, setError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleUpdateRole = async (targetUserId: string, nextRole: string) => {
    if (!selectedFamilyId || !isOwner) return;
    const applyUpdate = async () => {
      setActionBusy(true);
      setError('');
      setNotice('');
      try {
        await api(`/families/${selectedFamilyId}/members/${targetUserId}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: nextRole }),
        });
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setNotice(`🛡️ Гишүүний эрх “${roleLabel(nextRole)}” болж шинэчлэгдлээ.`);
        await Promise.all([reloadFamilies(), loadData(), refreshOverview()]);
      } catch (cause) {
        setError(friendlyError(cause, 'Гишүүний эрхийг шинэчилж чадсангүй.'));
      } finally {
        setActionBusy(false);
      }
    };

    if (nextRole === 'owner') {
      const target = members.find((m) => m.user_id === targetUserId);
      setConfirmState({
        isOpen: true,
        title: '👑 Ерөнхий админ эрх шилжүүлэх',
        message: `"${target?.display_name ?? 'Энэ гишүүн'}"-д гэр бүлийн Ерөнхий админы эрх шилжүүлэх үү?`,
        confirmLabel: '👑 Шилжүүлэх',
        variant: 'warning',
        onConfirm: applyUpdate,
      });
      return;
    }

    await applyUpdate();
  };

  const handleRemoveMember = (targetUserId: string, name: string) => {
    setConfirmState({
      isOpen: true,
      title: '🚪 Гишүүнийг гэр бүлээс хасах',
      message: `"${name}" хэрэглэгчийг энэ гэр бүлээс хасах уу?`,
      confirmLabel: 'Хасах',
      variant: 'danger',
      onConfirm: async () => {
        setActionBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/members/${targetUserId}`, {
            method: 'DELETE',
          });
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice(`🚪 “${name}”-г гэр бүлийн гишүүдээс хаслаа.`);
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Гишүүнийг хасаж чадсангүй.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleLinkMember = async (targetUserId: string, personId: string) => {
    if (!selectedFamilyId || !personId) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/families/${selectedFamilyId}/members/${targetUserId}/link-person`, {
        method: 'POST',
        body: JSON.stringify({ person_id: personId }),
      });
      setLinkingMember(null);
      setNotice('🌿 Хэрэглэгчийн account модон дахь хүнтэй амжилттай холбогдлоо.');
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Хүнтэй холбох үед алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleUnlinkMember = (targetUserId: string, memberName: string) => {
    setConfirmState({
      isOpen: true,
      title: '🔌 Модны холбоосыг салгах',
      message: `"${memberName}" гишүүний ургийн модон дахь хүнтэй холбосон холбоосыг салгах уу?`,
      confirmLabel: 'Салгах',
      variant: 'warning',
      onConfirm: async () => {
        setActionBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/members/${targetUserId}/unlink-person`, {
            method: 'DELETE',
          });
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice(`🔌 “${memberName}”-ийн модны холбоосыг салгалаа.`);
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Холбоосыг салгах үед алдаа гарлаа.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleSendInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !inviteEmail.trim() || !canManageMembers) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api<{ invite_url?: string }>(`/families/${selectedFamilyId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail('');
      setCreatedInviteUrl(res.invite_url ?? null);
      setNotice('✉️ Шинэ урилга амжилттай үүсгэгдлээ.');
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          'Урилга илгээхэд алдаа гарлаа.',
          'Энэ хаяг аль хэдийн гишүүн эсвэл идэвхтэй урилгатай байна.',
        ),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleRevokeInvite = (invitationId: string, email: string) => {
    setConfirmState({
      isOpen: true,
      title: '🚫 Урилга цуцлах',
      message: `"${email}" руу илгээсэн урилгыг хүчингүй болгох уу?`,
      confirmLabel: 'Цуцлах',
      variant: 'danger',
      onConfirm: async () => {
        setActionBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/invitations/${invitationId}`, {
            method: 'DELETE',
          });
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice('🚫 Урилга цуцлагдлаа.');
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Урилга цуцлах үед алдаа гарлаа.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  if (!selectedFamily) return null;

  return (
    <div className="admin-section-stack">
      <div className="admin-subnav" role="tablist" aria-label="Гишүүд ба урилгын хэсэг">
        <button
          type="button"
          onClick={() => setSubView('members')}
          className={`homev2-button admin-subtab-btn ${subView === 'members' ? 'homev2-button--primary' : 'homev2-button--light'}`}
        >
          👥 Гишүүд ба Мод холболт ({members.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('invitations')}
          className={`homev2-button admin-subtab-btn ${subView === 'invitations' ? 'homev2-button--primary' : 'homev2-button--light'}`}
        >
          ✉️ Урилга илгээх ({invitations.length})
        </button>
      </div>

      <AdminMembersSection
        activeTab={subView}
        selectedFamily={selectedFamily}
        people={people}
        members={members}
        invitations={invitations}
        isOwner={isOwner}
        isAdmin={isAdminRole}
        canManageMembers={canManageMembers}
        actionBusy={actionBusy}
        handleUpdateRole={handleUpdateRole}
        handleRemoveMember={handleRemoveMember}
        handleUnlinkMember={handleUnlinkMember}
        linkingMember={linkingMember}
        setLinkingMember={setLinkingMember}
        selectedPersonForLink={selectedPersonForLink}
        setSelectedPersonForLink={setSelectedPersonForLink}
        linkSearchQuery={linkSearchQuery}
        setLinkSearchQuery={setLinkSearchQuery}
        handleLinkMember={handleLinkMember}
        inviteEmail={inviteEmail}
        setInviteEmail={setInviteEmail}
        inviteRole={inviteRole}
        setInviteRole={setInviteRole}
        createdInviteUrl={createdInviteUrl}
        setCreatedInviteUrl={setCreatedInviteUrl}
        copiedInvite={copiedInvite}
        setCopiedInvite={setCopiedInvite}
        handleSendInvite={handleSendInvite}
        handleRevokeInvite={handleRevokeInvite}
      />

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        busy={actionBusy}
        onConfirm={() => void confirmState.onConfirm()}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
