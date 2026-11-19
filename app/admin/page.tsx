'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Sparkles,
  TreeDeciduous,
  X,
} from 'lucide-react';
import {
  ApiError,
  api,
  Family,
  FamilyImportResult,
  FamilyStats,
  FamilyTrashItem,
  Marriage,
  MemoryListItem,
  Person,
  StoryListPage,
  TreeData,
} from '../../lib/api';
import { PedigreeWizardModal, RelativeRole } from '../../components/pedigree-wizard-modal';
import { PedigreeCertificateModal } from '../../components/pedigree-certificate-modal';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { exportToGedcom, parseGedcom } from '../../lib/gedcom';
import { DuplicateCandidatePair as DuplicateCandidate, findDuplicatePeople } from '../../lib/duplicates';
import {
  AdminTabKey,
  AuditLogItem,
  friendlyError,
  Invitation,
  Member,
  RoleBadge,
  roleLabel,
} from '../../components/admin/admin-types';
import { AdminPeopleSection } from '../../components/admin/admin-people-section';
import { AdminMembersSection } from '../../components/admin/admin-members-section';
import { AdminGovernanceSection } from '../../components/admin/admin-governance-section';
import './admin.css';

function AdminContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedFamilyId = searchParams.get('family')?.trim() ?? '';

  const [families, setFamilies] = useState<Family[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [stats, setStats] = useState<FamilyStats | null>(null);
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [trashItems, setTrashItems] = useState<FamilyTrashItem[]>([]);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gedcomFileInputRef = useRef<HTMLInputElement>(null);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'warning' | 'primary';
    onConfirm: () => Promise<void> | void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const requestConfirm = (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'warning' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => {
    setConfirmState({
      isOpen: true,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Батлах',
      variant: opts.variant ?? 'danger',
      onConfirm: opts.onConfirm,
    });
  };

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAnchorId, setWizardAnchorId] = useState<string | null>(null);
  const [wizardRole, setWizardRole] = useState<RelativeRole>('son');

  const [activeTab, setActiveTab] = useState<AdminTabKey>('people');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [personSearch, setPersonSearch] = useState('');

  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonLastName, setNewPersonLastName] = useState('');
  const [newPersonFirstName, setNewPersonFirstName] = useState('');
  const [newPersonGender, setNewPersonGender] = useState<'male' | 'female'>('male');
  const [newPersonBirthDate, setNewPersonBirthDate] = useState('');
  const [newPersonIsAlive, setNewPersonIsAlive] = useState(true);
  const [newPersonDeathDate, setNewPersonDeathDate] = useState('');
  const [newPersonLineage, setNewPersonLineage] = useState('');

  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editLastName, setEditLastName] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editGender, setEditGender] = useState<'male' | 'female'>('male');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [editIsAlive, setEditIsAlive] = useState(true);
  const [editDeathDate, setEditDeathDate] = useState('');

  const [relParentId, setRelParentId] = useState('');
  const [relChildId, setRelChildId] = useState('');
  const [marriageP1, setMarriageP1] = useState('');
  const [marriageP2, setMarriageP2] = useState('');
  const [marriageStartDate, setMarriageStartDate] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'editor'>('member');
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const [linkingMember, setLinkingMember] = useState<Member | null>(null);
  const [selectedPersonForLink, setSelectedPersonForLink] = useState('');
  const [linkSearchQuery, setLinkSearchQuery] = useState('');

  const [familyName, setFamilyName] = useState('');
  const [familyDescription, setFamilyDescription] = useState('');

  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const selectedFamilyRef = useRef('');

  const selectedFamily = useMemo(
    () => families.find((f) => f.id === selectedFamilyId) ?? null,
    [families, selectedFamilyId],
  );

  const isOwner = selectedFamily?.role === 'owner';
  const isEditor = selectedFamily?.role === 'editor';
  const isAdmin = isOwner || isEditor;

  const loadFamilies = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const data = await api<Family[]>('/families');
      if (current !== sequence.current) return;
      setFamilies(data);
      const validExplicit = requestedFamilyId && data.some((f) => f.id === requestedFamilyId);
      if (validExplicit) {
        setSelectedFamilyId(requestedFamilyId);
      } else if (!requestedFamilyId && data[0]) {
        setSelectedFamilyId(data[0].id);
        router.replace('/admin?family=' + encodeURIComponent(data[0].id));
      } else {
        setSelectedFamilyId('');
      }
    } catch (cause) {
      if (current !== sequence.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(friendlyError(cause, 'Гэр бүлүүдийг ачаалж чадсангүй.'));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [requestedFamilyId, router]);

  const loadDetails = useCallback(async (familyId: string) => {
    const current = ++detailSequence.current;
    setDetailLoading(true);
    setError('');
    try {
      const [
        peopleData,
        memberData,
        invitationData,
        statsData,
        marriageData,
        memoriesData,
        storiesData,
        treeResult,
        auditResult,
        trashResult,
      ] = await Promise.all([
        api<Person[]>(`/families/${familyId}/persons`),
        api<Member[]>(`/families/${familyId}/members`),
        api<Invitation[]>(`/families/${familyId}/invitations`).catch(() => []),
        api<FamilyStats>(`/families/${familyId}/stats`).catch(() => null),
        api<Marriage[]>(`/families/${familyId}/marriages`).catch(() => []),
        api<MemoryListItem[] | { items?: MemoryListItem[] }>(`/families/${familyId}/memories`).catch(() => []),
        api<StoryListPage>(`/families/${familyId}/stories?page=1&page_size=20`).catch(() => null),
        api<TreeData>(`/families/${familyId}/tree?depth=10`).catch(() => null),
        api<AuditLogItem[]>(`/families/${familyId}/audit`).catch(() => []),
        api<FamilyTrashItem[]>(`/families/${familyId}/trash`).catch(() => []),
      ]);
      if (current !== detailSequence.current || selectedFamilyRef.current !== familyId) return;
      setPeople(peopleData);
      setMembers(memberData);
      setInvitations(invitationData);
      setStats(statsData);
      setMarriages(marriageData);
      const rawMems = Array.isArray(memoriesData) ? memoriesData : memoriesData?.items || [];
      setMemories(rawMems);
      setStories(storiesData);
      setTreeData(treeResult);
      setAuditLogs(auditResult);
      setTrashItems(trashResult);
    } catch (cause) {
      if (current === detailSequence.current && selectedFamilyRef.current === familyId) {
        setError(friendlyError(cause, 'Админ мэдээллийг ачаалж чадсангүй.'));
      }
    } finally {
      if (current === detailSequence.current && selectedFamilyRef.current === familyId) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFamilies();
    return () => {
      sequence.current += 1;
    };
  }, [loadFamilies]);

  useEffect(() => {
    selectedFamilyRef.current = selectedFamilyId;
  }, [selectedFamilyId]);

  useEffect(() => {
    if (!selectedFamily) {
      setPeople([]);
      setMembers([]);
      setInvitations([]);
      setMarriages([]);
      setStats(null);
      setTrashItems([]);
      return;
    }
    setFamilyName(selectedFamily.name);
    setFamilyDescription(selectedFamily.description ?? '');
    void loadDetails(selectedFamily.id);
  }, [selectedFamily, loadDetails]);

  const switchFamily = (id: string) => {
    setSelectedFamilyId(id);
    router.replace('/admin?family=' + encodeURIComponent(id));
    setNotice('');
  };

  const handleAddPerson = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || actionBusy) return;
    if (!newPersonFirstName.trim() || !newPersonLastName.trim()) {
      setError('Овог болон нэрийг заавал оруулна уу.');
      return;
    }
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api<Person>(`/families/${selectedFamilyId}/persons`, {
        method: 'POST',
        body: JSON.stringify({
          last_name: newPersonLastName.trim(),
          first_name: newPersonFirstName.trim(),
          gender: newPersonGender,
          birth_date: newPersonBirthDate || null,
          is_alive: newPersonIsAlive,
          death_date: !newPersonIsAlive && newPersonDeathDate ? newPersonDeathDate : null,
          lineage_name: newPersonLineage.trim() || null,
        }),
      });
      setNotice(`"${newPersonLastName} ${newPersonFirstName}" амжилттай бүртгэгдлээ.`);
      setNewPersonFirstName('');
      setNewPersonLastName('');
      setNewPersonBirthDate('');
      setNewPersonDeathDate('');
      setNewPersonLineage('');
      setNewPersonIsAlive(true);
      setShowAddPerson(false);
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Хүн нэмэхэд алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const openEditPerson = (person: Person) => {
    setEditingPerson(person);
    setEditLastName(person.last_name || '');
    setEditFirstName(person.first_name || '');
    setEditGender(person.gender === 'female' ? 'female' : 'male');
    setEditBirthDate(person.birth_date || '');
    setEditIsAlive(person.is_alive);
    setEditDeathDate(person.death_date || '');
  };

  const handleUpdatePerson = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !editingPerson || actionBusy) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api<Person>(`/families/${selectedFamilyId}/persons/${editingPerson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          last_name: editLastName.trim(),
          first_name: editFirstName.trim(),
          gender: editGender,
          birth_date: editBirthDate || null,
          is_alive: editIsAlive,
          death_date: !editIsAlive && editDeathDate ? editDeathDate : null,
        }),
      });
      setNotice(`"${editLastName} ${editFirstName}" амжилттай засагдлаа.`);
      setEditingPerson(null);
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Хүний мэдээлэл засахад алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeletePerson = (person: Person) => {
    if (!selectedFamilyId || actionBusy) return;
    const name = `${person.last_name ? person.last_name + ' ' : ''}${person.first_name}`;
    const childEdges = (treeData?.parent_child_relationships || []).filter(
      (rel) => rel.parent_id === person.id,
    );
    const childCount = childEdges.length;
    const confirmPrompt =
      childCount > 0
        ? `"${name}" хүнд модонд шууд холбогдсон ${childCount} үр хүүхэд байна. Энэ хүнийг модноос хасвал үр хүүхдүүдийнх нь уг шугам тасрах эрсдэлтэй.\n\nХасвал 30 хоногийн дотор Хогийн савнаас буцаан сэргээж болно.`
        : `"${name}" хүнийг ургийн модноос хасах уу? Хассаны дараа 30 хоногийн дотор Хогийн савнаас буцаан сэргээх боломжтой.`;

    requestConfirm({
      title: 'Хүний бүртгэлийг модноос хасах',
      message: confirmPrompt,
      confirmLabel: 'Хогийн сав руу шилжүүлэх',
      variant: childCount > 0 ? 'danger' : 'warning',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setActionBusy(true);
        setError('');
        setNotice('');
        try {
          await api<void>(`/families/${selectedFamilyId}/persons/${person.id}`, {
            method: 'DELETE',
          });
          setNotice(`"${name}" хүн хогийн сав руу шилжлээ.`);
          await loadDetails(selectedFamilyId);
        } catch (cause) {
          setError(friendlyError(cause, 'Хүн устгаж чадсангүй.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleMergeDuplicate = (dup: DuplicateCandidate) => {
    if (!selectedFamilyId || actionBusy) return;
    const nameA = `${dup.personA.last_name} ${dup.personA.first_name}`.trim();
    const nameB = `${dup.personB.last_name} ${dup.personB.first_name}`.trim();
    requestConfirm({
      title: 'Давхардсан бүртгэл нэгтгэх',
      message: `“${nameB}” бүртгэлийн бүх үр хүүхэд, гэрлэлт, дурсамж, намтрыг “${nameA}” бүртгэл рүү шилжүүлэн нэгтгэх үү? (Нэгтгэсний дараа Хогийн савнаас буцаах боломжтой)`,
      confirmLabel: 'Нэгтгэх',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setActionBusy(true);
        setError('');
        setNotice('');
        try {
          await api(
            `/families/${selectedFamilyId}/persons/${dup.personA.id}/merge/${dup.personB.id}`,
            { method: 'POST' },
          );
          setNotice(`"${nameB}" бүртгэлийг "${nameA}" руу амжилттай нэгтгэлээ.`);
          await loadDetails(selectedFamilyId);
        } catch (cause) {
          setError(friendlyError(cause, 'Бүртгэлийг нэгтгэж чадсангүй.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleAddParentChild = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !relParentId || !relChildId || actionBusy) return;
    if (relParentId === relChildId) {
      setError('Эцэг эх болон хүүхэд ижил хүн байж болохгүй.');
      return;
    }
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/families/${selectedFamilyId}/relationships/parent-child`, {
        method: 'POST',
        body: JSON.stringify({ parent_id: relParentId, child_id: relChildId, relationship_type: 'biological' }),
      });
      setNotice('Эцэг эх - Хүүхдийн холбоос амжилттай үүслээ.');
      setRelParentId('');
      setRelChildId('');
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Ургийн холбоос үүсгэхэд алдаа гарлаа.', 'Энэ холбоос өмнө нь бүртгэгдсэн эсвэл мөчлөгт алдаа үүсгэж байна.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddMarriage = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !marriageP1 || !marriageP2 || actionBusy) return;
    if (marriageP1 === marriageP2) {
      setError('Гэрлэлтийн 2 хүн ижил байж болохгүй.');
      return;
    }
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api<Marriage>(`/families/${selectedFamilyId}/marriages`, {
        method: 'POST',
        body: JSON.stringify({
          person_1_id: marriageP1,
          person_2_id: marriageP2,
          status: 'married',
          start_date: marriageStartDate || null,
        }),
      });
      setNotice('Гэрлэлтийн холбоо амжилттай бүртгэгдлээ.');
      setMarriageP1('');
      setMarriageP2('');
      setMarriageStartDate('');
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Гэрлэлт бүртгэхэд алдаа гарлаа.', 'Энэ хосын гэрлэлт өмнө нь бүртгэгдсэн байна.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteMarriage = (marriageId: string) => {
    if (!selectedFamilyId || actionBusy) return;
    requestConfirm({
      title: 'Гэрлэлтийн холбоос цуцлах',
      message: 'Энэ хосын гэрлэлтийн холбоосыг ургийн модноос устгах уу?',
      confirmLabel: 'Холбоос цуцлах',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setActionBusy(true);
        setError('');
        setNotice('');
        try {
          await api<void>(`/families/${selectedFamilyId}/marriages/${marriageId}`, {
            method: 'DELETE',
          });
          setNotice('Гэрлэлтийн холбоосыг устгалаа.');
          await loadDetails(selectedFamilyId);
        } catch (cause) {
          setError(friendlyError(cause, 'Гэрлэлт цуцлахад алдаа гарлаа.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleUpdateRole = async (targetUserId: string, nextRole: string) => {
    if (!selectedFamilyId || actionBusy) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api<Member>(`/families/${selectedFamilyId}/members/${targetUserId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      setNotice('Гишүүний эрх, үүргийн түвшин амжилттай шинэчлэгдлээ.');
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Гишүүний үүргийг өөрчилж чадсангүй.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemoveMember = (targetUserId: string, name: string) => {
    if (!selectedFamilyId || actionBusy) return;
    requestConfirm({
      title: 'Гишүүнийг гэр бүлээс хасах',
      message: `"${name}" хэрэглэгчийг энэ гэр бүлийн гишүүнчлэлээс хасах уу?`,
      confirmLabel: 'Гишүүнийг хасах',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setActionBusy(true);
        setError('');
        setNotice('');
        try {
          await api<void>(`/families/${selectedFamilyId}/members/${targetUserId}`, {
            method: 'DELETE',
          });
          setNotice(`"${name}" хэрэглэгчийг гэр бүлээс хаслаа.`);
          await loadDetails(selectedFamilyId);
        } catch (cause) {
          setError(friendlyError(cause, 'Гишүүнийг хасаж чадсангүй.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleLinkMember = async (targetUserId: string, personId: string) => {
    if (!selectedFamilyId || !targetUserId || !personId || actionBusy) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/families/${selectedFamilyId}/members/${targetUserId}/link-person`, {
        method: 'POST',
        body: JSON.stringify({ person_id: personId }),
      });
      setNotice('Гишүүнийг ургийн модны хүнтэй амжилттай холболоо.');
      setLinkingMember(null);
      setSelectedPersonForLink('');
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Ургийн хүнтэй холбож чадсангүй.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleUnlinkMember = (targetUserId: string, memberName: string) => {
    if (!selectedFamilyId || !targetUserId || actionBusy) return;
    requestConfirm({
      title: 'Хүнтэй холбосон холбоос салгах',
      message: `“${memberName}” гишүүний ургийн модон дахь хүний холбоосыг салгах уу?`,
      confirmLabel: 'Холбоос салгах',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setActionBusy(true);
        setError('');
        setNotice('');
        try {
          await api(`/families/${selectedFamilyId}/members/${targetUserId}/unlink-person`, {
            method: 'DELETE',
          });
          setNotice(`"${memberName}" гишүүний ургийн холбоосыг салгалаа.`);
          await loadDetails(selectedFamilyId);
        } catch (cause) {
          setError(friendlyError(cause, 'Холбоосыг салгаж чадсангүй.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleSendInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || actionBusy) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api<{ id: string; email: string; role: string; invite_url?: string }>(
        `/families/${selectedFamilyId}/invitations`,
        {
          method: 'POST',
          body: JSON.stringify({ email, role: inviteRole }),
        },
      );
      setNotice(`${email} хаяг руу урилга амжилттай үүсгэгдлээ.`);
      setInviteEmail('');
      if (res.invite_url) {
        setCreatedInviteUrl(res.invite_url);
      }
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Урилга илгээж чадсангүй.', 'Энэ имэйл хаягт идэвхтэй урилга байгаа эсвэл аль хэдийн гишүүн байна.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleRevokeInvite = (invitationId: string, email: string) => {
    if (!selectedFamilyId || actionBusy) return;
    requestConfirm({
      title: 'Урилга цуцлах',
      message: `“${email}” хаягийн урилгыг хүчингүй болгох уу?`,
      confirmLabel: 'Урилга цуцлах',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        setActionBusy(true);
        setError('');
        setNotice('');
        try {
          await api<void>(`/families/${selectedFamilyId}/invitations/${invitationId}`, { method: 'DELETE' });
          setNotice('Урилгыг цуцаллаа.');
          await loadDetails(selectedFamilyId);
        } catch (cause) {
          setError(friendlyError(cause, 'Урилгыг цуцалж чадсангүй.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleDeleteStory = (storyId: string) => {
    if (!selectedFamilyId) return;
    requestConfirm({
      title: 'Түүх устгах',
      message: 'Энэ түүхийг устгах уу?',
      confirmLabel: 'Түүх устгах',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        try {
          await api<void>(`/families/${selectedFamilyId}/stories/${storyId}`, { method: 'DELETE' });
          setNotice('Түүх устгагдлаа.');
          await loadDetails(selectedFamilyId);
        } catch (cause) {
          setError(friendlyError(cause, 'Түүхийг устгаж чадсангүй.'));
        }
      },
    });
  };

  const handleDeleteMemory = (memoryId: string) => {
    if (!selectedFamilyId) return;
    requestConfirm({
      title: 'Дурсамж устгах',
      message: 'Энэ дурсамжийг устгах уу?',
      confirmLabel: 'Дурсамж устгах',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        try {
          await api<void>(`/families/${selectedFamilyId}/memories/${memoryId}`, { method: 'DELETE' });
          setNotice('Дурсамж устгагдлаа.');
          await loadDetails(selectedFamilyId);
        } catch (cause) {
          setError(friendlyError(cause, 'Дурсамжийг устгаж чадсангүй.'));
        }
      },
    });
  };

  const handleSaveFamily = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || actionBusy) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api<Family>(`/families/${selectedFamilyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: familyName.trim(), description: familyDescription.trim() || null }),
      });
      setFamilies((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setNotice('Гэр бүлийн мэдээлэл хадгалагдлаа.');
    } catch (cause) {
      setError(friendlyError(cause, 'Гэр бүлийн мэдээлэл хадгалж чадсангүй.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleArchiveFamily = () => {
    if (!selectedFamily) return;
    requestConfirm({
      title: 'Гэр бүлийг архивлах',
      message: `“${selectedFamily.name}” гэр бүлийг архивлах уу?`,
      confirmLabel: 'Архивлах',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        try {
          await api(`/families/${selectedFamily.id}`, { method: 'DELETE' });
          router.replace('/admin');
        } catch (cause) {
          setError(friendlyError(cause, 'Архивлаж чадсангүй.'));
        }
      },
    });
  };

  const handleExportBackup = async () => {
    if (!selectedFamily || !selectedFamilyId) return;
    try {
      setActionBusy(true);
      setError('');
      const backupData = await api<Record<string, unknown>>(`/families/${selectedFamilyId}/export`);
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `guulin-backup-${selectedFamily.name.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Гэр бүлийн нөөц өгөгдлийг (бүрэн мод, харилцаатай) амжилттай татаж авлаа.');
    } catch (cause) {
      setError(friendlyError(cause, 'Нөөц татахад алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleRestoreTrash = async (item: FamilyTrashItem) => {
    if (!selectedFamilyId || actionBusy) return;
    try {
      setActionBusy(true);
      setError('');
      setNotice('');
      await api<{ restored: boolean }>(`/families/${selectedFamilyId}/trash/${item.id}/restore`, {
        method: 'POST',
      });
      setNotice(`"${item.person_name}" модонд амжилттай буцаан залгагдлаа.`);
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Буцаан сэргээж чадсангүй.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handlePurgeTrash = (item: FamilyTrashItem) => {
    if (!selectedFamilyId || actionBusy) return;
    requestConfirm({
      title: 'Хогийн савнаас бүрмөсөн устгах',
      message: `"${item.person_name}" хүний түүхийг хогийн савнаас бүрмөсөн устгах уу? Энэ үйлдлийг буцаах боломжгүй.`,
      confirmLabel: 'Бүрмөсөн устгах',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        try {
          setActionBusy(true);
          setError('');
          setNotice('');
          await api<void>(`/families/${selectedFamilyId}/trash/${item.id}`, {
            method: 'DELETE',
          });
          setNotice(`"${item.person_name}" хогийн савнаас бүрмөсөн устгагдлаа.`);
          setTrashItems((prev) => prev.filter((t) => t.id !== item.id));
        } catch (cause) {
          setError(friendlyError(cause, 'Устгаж чадсангүй.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleEmptyTrash = () => {
    if (!selectedFamilyId || actionBusy || trashItems.length === 0) return;
    requestConfirm({
      title: 'Хогийн сав цэвэрлэх',
      message: `Хогийн саванд буй бүх (${trashItems.length}) бичлэгийг бүрмөсөн цэвэрлэх үү? Энэ үйлдлийг буцаах боломжгүй.`,
      confirmLabel: 'Бүгдийг цэвэрлэх',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
        try {
          setActionBusy(true);
          setError('');
          setNotice('');
          await api<void>(`/families/${selectedFamilyId}/trash/empty`, {
            method: 'POST',
          });
          setNotice('Хогийн сав бүрэн цэвэрлэгдлээ.');
          setTrashItems([]);
        } catch (cause) {
          setError(friendlyError(cause, 'Хогийн савыг цэвэрлэж чадсангүй.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedFamilyId) return;

    try {
      setImportingBackup(true);
      setError('');
      setNotice('');
      const text = await file.text();
      const parsed = JSON.parse(text);

      const peopleList = Array.isArray(parsed.people) ? parsed.people : [];
      const relationships = Array.isArray(parsed.parent_child_relationships) ? parsed.parent_child_relationships : [];
      const marriagesList = Array.isArray(parsed.marriages) ? parsed.marriages : [];

      if (peopleList.length === 0 && relationships.length === 0 && marriagesList.length === 0) {
        throw new Error('Оруулсан JSON файлд хүчинтэй өгөгдөл олдсонгүй.');
      }

      const res = await api<FamilyImportResult>(`/families/${selectedFamilyId}/import`, {
        method: 'POST',
        body: JSON.stringify({
          people: peopleList,
          parent_child_relationships: relationships,
          marriages: marriagesList,
        }),
      });

      const warningSuffix =
        res.warnings && res.warnings.length > 0 ? ` (Анхааруулга: ${res.warnings.join('; ')})` : '';
      setNotice(
        `Өгөгдөл амжилттай импортлогдлоо: ${res.imported_people} хүн, ${res.imported_relationships} эцэг эхийн холбоос, ${res.imported_marriages} гэрлэлт оруулав.${warningSuffix}`,
      );
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Өгөгдөл оруулахад алдаа гарлаа. Файлын бүтэц шалгана уу.'));
    } finally {
      setImportingBackup(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportGedcom = () => {
    if (!selectedFamily || !people.length) return;
    const gedString = exportToGedcom(
      selectedFamily.name,
      people,
      treeData?.parent_child_relationships || [],
      marriages,
    );
    const blob = new Blob([gedString], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guulin-${selectedFamily.name.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.ged`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('GEDCOM 5.5.1 (.ged) файлыг амжилттай татаж авлаа.');
  };

  const handleImportGedcom = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedFamilyId) return;
    try {
      setImportingBackup(true);
      setError('');
      setNotice('');
      const text = await file.text();
      const parsed = parseGedcom(text);
      if (parsed.people.length === 0) {
        throw new Error('Оруулсан GEDCOM файлд хүний бүртгэл олдсонгүй.');
      }
      const res = await api<FamilyImportResult>(`/families/${selectedFamilyId}/import`, {
        method: 'POST',
        body: JSON.stringify({
          people: parsed.people,
          parent_child_relationships: parsed.parent_child_relationships,
          marriages: parsed.marriages,
        }),
      });
      setNotice(
        `GEDCOM файл амжилттай импортлогдлоо: ${res.imported_people} хүн, ${res.imported_relationships} эцэг эхийн холбоос, ${res.imported_marriages} гэрлэлт оруулав.`,
      );
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'GEDCOM файл уншихад алдаа гарлаа.'));
    } finally {
      setImportingBackup(false);
      if (gedcomFileInputRef.current) gedcomFileInputRef.current.value = '';
    }
  };

  const duplicateCandidates = useMemo(() => findDuplicatePeople(people), [people]);

  const filteredPeople = useMemo(() => {
    if (!personSearch.trim()) return people;
    const q = personSearch.toLowerCase();
    return people.filter(
      (p) =>
        p.first_name.toLowerCase().includes(q) ||
        p.last_name.toLowerCase().includes(q) ||
        (p.nickname && p.nickname.toLowerCase().includes(q)) ||
        (p.birth_date && p.birth_date.includes(q)),
    );
  }, [people, personSearch]);

  const filteredAuditLogs = useMemo(() => {
    if (!auditSearch.trim()) return auditLogs;
    const q = auditSearch.toLowerCase();
    return auditLogs.filter(
      (log) =>
        log.action.toLowerCase().includes(q) ||
        log.target_type.toLowerCase().includes(q) ||
        log.actor_id.toLowerCase().includes(q) ||
        log.target_id.toLowerCase().includes(q),
    );
  }, [auditLogs, auditSearch]);

  return (
    <div className="families-page" aria-busy={loading}>
      <div className="families-shell">
        <div className="families-header">
          <div>
            <div className="admin-header-badge-row">
              <span className="admin-header-kicker">
                <Sparkles size={13} />
                ГЭР БҮЛИЙН УДИРДЛАГЫН ТАНХИМ
              </span>
              {selectedFamily && <RoleBadge role={selectedFamily.role} />}
            </div>
            <h1>Ургийн бичгийн нэгдсэн удирдлага</h1>
            <p>
              Гэр бүлийн хүмүүс, ураг төрлийн холбоос, гишүүдийн бүртгэл болон тохиргоог нэгтгэн удирдах төв.
            </p>
          </div>

          <div className="admin-header-actions">
            {selectedFamily && (
              <Link
                href={`/tree?family=${encodeURIComponent(selectedFamily.id)}`}
                className="homev2-button homev2-button--primary admin-btn-tree-link"
              >
                <TreeDeciduous size={14} /> Ургийн мод руу очих →
              </Link>
            )}
          </div>
        </div>

        {notice && (
          <div className="admin-alert-notice">
            <div className="admin-alert-inner">
              <CheckCircle2 size={18} />
              <span>{notice}</span>
            </div>
            <button type="button" onClick={() => setNotice('')} className="admin-icon-close">
              <X size={16} />
            </button>
          </div>
        )}

        {error && (
          <div className="admin-alert-error">
            <div className="admin-alert-inner">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError('')} className="admin-icon-close">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="admin-master-bar">
          <div className="admin-family-selector-wrap">
            <span className="admin-family-selector-label">Идэвхтэй гэр бүл:</span>
            <select
              value={selectedFamilyId}
              onChange={(e) => switchFamily(e.target.value)}
              className="admin-role-select"
              style={{ fontWeight: 700, fontSize: 13.5, padding: '6px 14px' }}
            >
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({roleLabel(f.role)})
                </option>
              ))}
            </select>
          </div>

          <div className="admin-primary-tabs">
            <button
              type="button"
              onClick={() => setActiveTab('people')}
              className={`homev2-button admin-tab-btn ${activeTab === 'people' || activeTab === 'relationships' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Хүмүүс ба Ураг ({people.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`homev2-button admin-tab-btn ${activeTab === 'members' || activeTab === 'invitations' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Гишүүд ба Урилга ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('heritage')}
              className={`homev2-button admin-tab-btn ${activeTab === 'heritage' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Өв сан ({memories.length + (stories?.items?.length ?? 0)})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`homev2-button admin-tab-btn ${activeTab === 'settings' || activeTab === 'audit' || activeTab === 'trash' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Тохиргоо {trashItems.length > 0 ? `(${trashItems.length})` : ''}
            </button>
          </div>
        </div>

        {(activeTab === 'people' || activeTab === 'relationships') && (
          <div className="admin-subnav">
            <button
              type="button"
              onClick={() => setActiveTab('people')}
              className={`homev2-button admin-subtab-btn ${activeTab === 'people' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Хүмүүсийн бүртгэл ({people.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('relationships')}
              className={`homev2-button admin-subtab-btn ${activeTab === 'relationships' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Ураг ба Гэрлэлтийн холбоос ({marriages.length})
            </button>
          </div>
        )}

        {(activeTab === 'members' || activeTab === 'invitations') && (
          <div className="admin-subnav">
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`homev2-button admin-subtab-btn ${activeTab === 'members' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Гишүүд ба Эрх ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('invitations')}
              className={`homev2-button admin-subtab-btn ${activeTab === 'invitations' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Урилга илгээх ({invitations.length})
            </button>
          </div>
        )}

        {(activeTab === 'settings' || activeTab === 'audit' || activeTab === 'trash') && (
          <div className="admin-subnav">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`homev2-button admin-subtab-btn ${activeTab === 'settings' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Ерөнхий тохиргоо
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`homev2-button admin-subtab-btn ${activeTab === 'audit' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Үйлдлийн бүртгэл ({auditLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trash')}
              className={`homev2-button admin-subtab-btn ${activeTab === 'trash' ? 'homev2-button--primary' : 'homev2-button--light'}`}
            >
              Хогийн сав ({trashItems.length})
            </button>
          </div>
        )}

        <AdminPeopleSection
          activeTab={activeTab}
          selectedFamilyId={selectedFamilyId}
          people={people}
          filteredPeople={filteredPeople}
          marriages={marriages}
          duplicateCandidates={duplicateCandidates}
          isAdmin={isAdmin}
          actionBusy={actionBusy}
          detailLoading={detailLoading}
          personSearch={personSearch}
          setPersonSearch={setPersonSearch}
          showAddPerson={showAddPerson}
          setShowAddPerson={setShowAddPerson}
          newPersonLastName={newPersonLastName}
          setNewPersonLastName={setNewPersonLastName}
          newPersonFirstName={newPersonFirstName}
          setNewPersonFirstName={setNewPersonFirstName}
          newPersonGender={newPersonGender}
          setNewPersonGender={setNewPersonGender}
          newPersonBirthDate={newPersonBirthDate}
          setNewPersonBirthDate={setNewPersonBirthDate}
          newPersonIsAlive={newPersonIsAlive}
          setNewPersonIsAlive={setNewPersonIsAlive}
          newPersonDeathDate={newPersonDeathDate}
          setNewPersonDeathDate={setNewPersonDeathDate}
          newPersonLineage={newPersonLineage}
          setNewPersonLineage={setNewPersonLineage}
          handleAddPerson={handleAddPerson}
          editingPerson={editingPerson}
          setEditingPerson={setEditingPerson}
          openEditPerson={openEditPerson}
          editLastName={editLastName}
          setEditLastName={setEditLastName}
          editFirstName={editFirstName}
          setEditFirstName={setEditFirstName}
          editGender={editGender}
          setEditGender={setEditGender}
          editBirthDate={editBirthDate}
          setEditBirthDate={setEditBirthDate}
          editIsAlive={editIsAlive}
          setEditIsAlive={setEditIsAlive}
          editDeathDate={editDeathDate}
          setEditDeathDate={setEditDeathDate}
          handleUpdatePerson={handleUpdatePerson}
          handleDeletePerson={handleDeletePerson}
          onMergeDuplicate={handleMergeDuplicate}
          onOpenWizard={(anchorId, role) => {
            setWizardAnchorId(anchorId);
            setWizardRole(role);
            setWizardOpen(true);
          }}
          relParentId={relParentId}
          setRelParentId={setRelParentId}
          relChildId={relChildId}
          setRelChildId={setRelChildId}
          handleAddParentChild={handleAddParentChild}
          marriageP1={marriageP1}
          setMarriageP1={setMarriageP1}
          marriageP2={marriageP2}
          setMarriageP2={setMarriageP2}
          marriageStartDate={marriageStartDate}
          setMarriageStartDate={setMarriageStartDate}
          handleAddMarriage={handleAddMarriage}
          handleDeleteMarriage={handleDeleteMarriage}
        />

        <AdminMembersSection
          activeTab={activeTab}
          selectedFamily={selectedFamily}
          people={people}
          members={members}
          invitations={invitations}
          isOwner={isOwner}
          isAdmin={isAdmin}
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

        <AdminGovernanceSection
          activeTab={activeTab}
          selectedFamilyId={selectedFamilyId}
          selectedFamily={selectedFamily}
          isOwner={isOwner}
          isAdmin={isAdmin}
          actionBusy={actionBusy}
          detailLoading={detailLoading}
          stories={stories}
          memories={memories}
          setCertificateOpen={setCertificateOpen}
          handleDeleteStory={handleDeleteStory}
          handleDeleteMemory={handleDeleteMemory}
          familyName={familyName}
          setFamilyName={setFamilyName}
          familyDescription={familyDescription}
          setFamilyDescription={setFamilyDescription}
          handleSaveFamily={handleSaveFamily}
          onArchiveFamily={handleArchiveFamily}
          importingBackup={importingBackup}
          fileInputRef={fileInputRef}
          gedcomFileInputRef={gedcomFileInputRef}
          handleExportBackup={handleExportBackup}
          handleImportBackup={handleImportBackup}
          handleExportGedcom={handleExportGedcom}
          handleImportGedcom={handleImportGedcom}
          auditLogs={auditLogs}
          filteredAuditLogs={filteredAuditLogs}
          auditSearch={auditSearch}
          setAuditSearch={setAuditSearch}
          onRefreshDetails={() => selectedFamilyId && void loadDetails(selectedFamilyId)}
          trashItems={trashItems}
          handleEmptyTrash={handleEmptyTrash}
          handleRestoreTrash={handleRestoreTrash}
          handlePurgeTrash={handlePurgeTrash}
        />

        <PedigreeWizardModal
          familyId={selectedFamilyId}
          people={people}
          marriages={marriages}
          parentChildEdges={treeData?.parent_child_relationships || []}
          initialAnchorPersonId={wizardAnchorId}
          initialRole={wizardRole}
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onSuccess={async (_newPerson, msg) => {
            setWizardOpen(false);
            setNotice(msg);
            await loadDetails(selectedFamilyId);
          }}
        />

        <PedigreeCertificateModal
          isOpen={certificateOpen}
          onClose={() => setCertificateOpen(false)}
          family={selectedFamily}
          stats={stats}
          people={people}
          relationships={treeData?.parent_child_relationships || []}
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
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="admin-trash-empty">
          Бүрэн админ удирдлагын төвийг ачаалж байна…
        </div>
      }
    >
      <AdminContent />
    </Suspense>
  );
}
