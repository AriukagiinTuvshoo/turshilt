'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldCheck,
  Users,
  UserCheck,
  UserPlus,
  Trash2,
  Edit3,
  Mail,
  Calendar,
  ArrowRight,
  Clock,
  TreeDeciduous,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  UserRound,
  Shield,
  Lock,
  GitFork,
  Heart,
  Download,
  BookOpen,
  Camera,
  Archive,
  RefreshCw,
  Search,
  Check,
  Copy,
  X,
  Award,
} from 'lucide-react';
import {
  ApiError,
  api,
  Family,
  FamilyStats,
  Person,
  Marriage,
  TreeData,
  MemoryListItem,
  StoryListPage,
  personName,
  FamilyTrashItem,
  FamilyImportResult,
} from '../../lib/api';
import { PedigreeWizardModal, RelativeRole } from '../../components/pedigree-wizard-modal';
import { PedigreeCertificateModal } from '../../components/pedigree-certificate-modal';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { exportToGedcom, parseGedcom } from '../../lib/gedcom';
import { findDuplicatePeople } from '../../lib/duplicates';

type Member = {
  user_id: string;
  display_name: string;
  role: string;
  person_id?: string | null;
  email?: string | null;
};
type Invitation = { id: string; email: string; role: 'member' | 'editor'; expires_at: string; created_at: string; status: 'pending' };

interface AuditLogItem {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  created_at: string;
}

function formatAuditAction(action: string) {
  switch (action) {
    case 'person.created':
      return { label: 'Шинэ хүн бүртгэсэн', icon: '👤', color: '#0284c7', bg: 'rgba(2,132,199,0.1)' };
    case 'person.updated':
      return { label: 'Хүний мэдээлэл зассан', icon: '✏️', color: '#0d9488', bg: 'rgba(13,148,136,0.1)' };
    case 'person.detached':
      return { label: 'Ургийн холбоосыг салгасан', icon: '✂️', color: '#ea580c', bg: 'rgba(234,88,12,0.1)' };
    case 'relationship.parent_child.created':
      return { label: 'Эцэг/эхийн ураг зангидсан', icon: '🌿', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' };
    case 'marriage.created':
      return { label: 'Гэрлэлтийн холбоос үүсгэсэн', icon: '💍', color: '#d97706', bg: 'rgba(217,119,6,0.1)' };
    case 'marriage.updated':
      return { label: 'Гэрлэлтийн мэдээлэл шинэчилсэн', icon: '📝', color: '#b45309', bg: 'rgba(180,83,9,0.1)' };
    case 'marriage.deleted':
      return { label: 'Гэрлэлтийн холбоос устгасан', icon: '🗑️', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
    case 'family.created':
      return { label: 'Гэр бүлийн сан үүсгэсэн', icon: '🏛️', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' };
    case 'family.updated':
      return { label: 'Гэр бүлийн тохиргоо зассан', icon: '⚙️', color: '#4b5563', bg: 'rgba(75,85,99,0.1)' };
    case 'family.owner_transferred':
      return { label: 'Эзэмшигчийн эрх шилжүүлсэн', icon: '👑', color: '#eab308', bg: 'rgba(234,179,8,0.1)' };
    case 'family_member.role_updated':
      return { label: 'Гишүүний хандах эрх өөрчилсөн', icon: '🛡️', color: '#0284c7', bg: 'rgba(2,132,199,0.1)' };
    case 'family_member.removed':
      return { label: 'Гишүүнийг гэр бүлээс хассан', icon: '🚪', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
    case 'invitation.created':
    case 'invitation.sent':
      return { label: 'Урилга илгээсэн', icon: '✉️', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' };
    case 'invitation.accepted':
      return { label: 'Урилга хүлээн авч гишүүн болсон', icon: '🤝', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' };
    case 'invitation.revoked':
      return { label: 'Урилгыг цуцалсан', icon: '🚫', color: '#9ca3af', bg: 'rgba(156,163,175,0.1)' };
    case 'memory.created':
      return { label: 'Дурсамж нийтэлсэн', icon: '❤️', color: '#e11d48', bg: 'rgba(225,29,72,0.1)' };
    case 'memory.deleted':
      return { label: 'Дурсамж устгасан', icon: '🗑️', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
    case 'story.created':
      return { label: 'Түүх бичсэн', icon: '📖', color: '#0284c7', bg: 'rgba(2,132,199,0.1)' };
    case 'story.deleted':
      return { label: 'Түүх устгасан', icon: '🗑️', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
    case 'archive.created':
      return { label: 'Архив баримт оруулсан', icon: '📜', color: '#b45309', bg: 'rgba(180,83,9,0.1)' };
    case 'archive.deleted':
      return { label: 'Архив баримт устгасан', icon: '🗑️', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
    default:
      return { label: action, icon: '⚡', color: '#4b5563', bg: 'rgba(75,85,99,0.1)' };
  }
}

function roleLabel(role: string) {
  if (role === 'owner') return 'Эзэмшигч (Ерөнхий Админ)';
  if (role === 'editor') return 'Засварлагч (Editor)';
  return 'Гишүүн (Member)';
}

function RoleBadge({ role }: { role: string }) {
  if (role === 'owner') {
    return (
      <span className="admin-badge-owner">
        <Sparkles size={12} />
        <span>👑 Эзэмшигч (Админ)</span>
      </span>
    );
  }
  if (role === 'editor') {
    return (
      <span className="admin-badge-editor">
        <ShieldCheck size={12} />
        <span>✏️ Засварлагч</span>
      </span>
    );
  }
  return (
    <span className="admin-badge-member">
      <UserRound size={12} />
      <span>👤 Гишүүн</span>
    </span>
  );
}

function friendlyError(
  cause: unknown,
  fallback: string,
  conflictMessage = 'Энэ үйлдэл зөрчилтэй байна. Дахин оролдоно уу.',
) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай. Дахин нэвтэрнэ үү.';
    if (cause.status === 403) return 'Энэ үйлдлийг хийх админ эрхгүй байна.';
    if (cause.status === 404) return 'Мэдээлэл олдсонгүй эсвэл хандах эрхгүй байна.';
    if (cause.status === 409) return conflictMessage;
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
  }
  return fallback;
}

type AdminTabKey = 'people' | 'relationships' | 'members' | 'invitations' | 'heritage' | 'audit' | 'settings' | 'trash';

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

  // Accessible Confirmation Dialog State
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

  // Pedigree Wizard Modal State
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAnchorId, setWizardAnchorId] = useState<string | null>(null);
  const [wizardRole, setWizardRole] = useState<RelativeRole>('son');

  const [activeTab, setActiveTab] = useState<AdminTabKey>('people');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Filter & Search
  const [personSearch, setPersonSearch] = useState('');

  // Add Person Form State
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonLastName, setNewPersonLastName] = useState('');
  const [newPersonFirstName, setNewPersonFirstName] = useState('');
  const [newPersonGender, setNewPersonGender] = useState<'male' | 'female'>('male');
  const [newPersonBirthDate, setNewPersonBirthDate] = useState('');
  const [newPersonIsAlive, setNewPersonIsAlive] = useState(true);
  const [newPersonDeathDate, setNewPersonDeathDate] = useState('');
  const [newPersonLineage, setNewPersonLineage] = useState('');

  // Edit Person Form State
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editLastName, setEditLastName] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editGender, setEditGender] = useState<'male' | 'female'>('male');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [editIsAlive, setEditIsAlive] = useState(true);
  const [editDeathDate, setEditDeathDate] = useState('');
  const [editLineage, setEditLineage] = useState('');

  // Add Relationship States
  const [relParentId, setRelParentId] = useState('');
  const [relChildId, setRelChildId] = useState('');
  const [marriageP1, setMarriageP1] = useState('');
  const [marriageP2, setMarriageP2] = useState('');
  const [marriageStartDate, setMarriageStartDate] = useState('');

  // Invite Form State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'editor'>('member');
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Link Member to Person Modal
  const [linkingMember, setLinkingMember] = useState<Member | null>(null);
  const [selectedPersonForLink, setSelectedPersonForLink] = useState('');
  const [linkSearchQuery, setLinkSearchQuery] = useState('');

  // Family Info State
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

  // 1. ADD PERSON
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

  // 2. EDIT PERSON
  const openEditPerson = (person: Person) => {
    setEditingPerson(person);
    setEditLastName(person.last_name || '');
    setEditFirstName(person.first_name || '');
    setEditGender(person.gender === 'female' ? 'female' : 'male');
    setEditBirthDate(person.birth_date || '');
    setEditIsAlive(person.is_alive);
    setEditDeathDate(person.death_date || '');
    setEditLineage(person.nickname || '');
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

  // 3. DELETE PERSON (With Orphan Prevention Guard)
  const handleDeletePerson = (person: Person) => {
    if (!selectedFamilyId || actionBusy) return;
    const name = `${person.last_name ? person.last_name + ' ' : ''}${person.first_name}`;
    const childEdges = (treeData?.parent_child_relationships || []).filter(
      (rel) => rel.parent_id === person.id
    );
    const childCount = childEdges.length;
    const confirmPrompt = childCount > 0
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

  // 4. ADD PARENT-CHILD RELATIONSHIP
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

  // 5. ADD MARRIAGE
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

  // 6. DELETE MARRIAGE
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

  // 7. UPDATE MEMBER ROLE
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

  // 8. REMOVE MEMBER
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

  // 9. SEND INVITATION
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

  // 10. REVOKE INVITATION
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

  // 11. DELETE STORY / MEMORY
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

  // 12. SAVE FAMILY INFO
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

  // 13. FULL JSON BACKUP DOWNLOAD
  const handleExportBackup = async () => {
    if (!selectedFamily || !selectedFamilyId) return;
    try {
      setActionBusy(true);
      setError('');
      const backupData = await api<any>(`/families/${selectedFamilyId}/export`);
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

  // 14. RESTORE TRASH PERSON
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

  // 15. PURGE SINGLE TRASH RECORD
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

  // 16. EMPTY ALL TRASH
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

  // 17. IMPORT BACKUP JSON DATA
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

      const warningSuffix = res.warnings && res.warnings.length > 0
        ? ` (Анхааруулга: ${res.warnings.join('; ')})`
        : '';
      setNotice(
        `Өгөгдөл амжилттай импортлогдлоо: ${res.imported_people} хүн, ${res.imported_relationships} эцэг эхийн холбоос, ${res.imported_marriages} гэрлэлт оруулав.${warningSuffix}`
      );
      await loadDetails(selectedFamilyId);
    } catch (cause) {
      setError(friendlyError(cause, 'Өгөгдөл оруулахад алдаа гарлаа. Файлын бүтэц шалгана уу.'));
    } finally {
      setImportingBackup(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 18. GEDCOM EXPORT & IMPORT
  const handleExportGedcom = () => {
    if (!selectedFamily || !people.length) return;
    const gedString = exportToGedcom(
      selectedFamily.name,
      people,
      treeData?.parent_child_relationships || [],
      marriages
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
        `GEDCOM файл амжилттай импортлогдлоо: ${res.imported_people} хүн, ${res.imported_relationships} эцэг эхийн холбоос, ${res.imported_marriages} гэрлэлт оруулав.`
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
        {/* Top Header */}
        <div className="families-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 12px',
                  borderRadius: '9999px',
                  background: 'rgba(217, 119, 6, 0.15)',
                  color: '#b45309',
                  border: '1px solid rgba(217, 119, 6, 0.35)',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                }}
              >
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

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {selectedFamily && (
              <Link
                href={`/tree?family=${encodeURIComponent(selectedFamily.id)}`}
                className="homev2-button homev2-button--primary"
                style={{ fontSize: '12px', padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <TreeDeciduous size={14} /> Ургийн мод руу очих →
              </Link>
            )}
          </div>
        </div>

        {/* Global Notices */}
        {notice && (
          <div
            style={{
              padding: '12px 18px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#047857',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={18} />
              <span>{notice}</span>
            </div>
            <button type="button" onClick={() => setNotice('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#047857' }}>
              <X size={16} />
            </button>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '12px 18px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#b91c1c',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}>
              <X size={16} />
            </button>
          </div>
        )}

        {/* Master Context & Navigation Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
            marginBottom: '24px',
            padding: '14px 20px',
            borderRadius: '16px',
            background: 'var(--parchment-card, #fffdf9)',
            border: '1px solid var(--parchment-border, #e2d9c8)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          }}
        >
          {/* Family Selector & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink-secondary, #485c53)' }}>
              Идэвхтэй гэр бүл:
            </span>
            <select
              value={selectedFamilyId}
              onChange={(e) => switchFamily(e.target.value)}
              className="admin-role-select"
              style={{ fontWeight: 700, fontSize: '13.5px', padding: '6px 14px' }}
            >
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({roleLabel(f.role)})
                </option>
              ))}
            </select>
          </div>

          {/* Primary 4-Group Navigation (Hick's Law) */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('people')}
              className={`homev2-button ${activeTab === 'people' || activeTab === 'relationships' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '12px', padding: '6px 14px' }}
            >
              Хүмүүс ба Ураг ({people.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`homev2-button ${activeTab === 'members' || activeTab === 'invitations' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '12px', padding: '6px 14px' }}
            >
              Гишүүд ба Урилга ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('heritage')}
              className={`homev2-button ${activeTab === 'heritage' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '12px', padding: '6px 14px' }}
            >
              Өв сан ({memories.length + (stories?.items?.length ?? 0)})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`homev2-button ${activeTab === 'settings' || activeTab === 'audit' || activeTab === 'trash' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '12px', padding: '6px 14px' }}
            >
              Тохиргоо {trashItems.length > 0 ? `(${trashItems.length})` : ''}
            </button>
          </div>
        </div>

        {/* Sub-navigation pills for active group */}
        {(activeTab === 'people' || activeTab === 'relationships') && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('people')}
              className={`homev2-button ${activeTab === 'people' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '11.5px', padding: '5px 14px' }}
            >
              Хүмүүсийн бүртгэл ({people.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('relationships')}
              className={`homev2-button ${activeTab === 'relationships' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '11.5px', padding: '5px 14px' }}
            >
              Ураг ба Гэрлэлтийн холбоос ({marriages.length})
            </button>
          </div>
        )}

        {(activeTab === 'members' || activeTab === 'invitations') && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`homev2-button ${activeTab === 'members' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '11.5px', padding: '5px 14px' }}
            >
              Гишүүд ба Эрх ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('invitations')}
              className={`homev2-button ${activeTab === 'invitations' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '11.5px', padding: '5px 14px' }}
            >
              Урилга илгээх ({invitations.length})
            </button>
          </div>
        )}

        {(activeTab === 'settings' || activeTab === 'audit' || activeTab === 'trash') && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`homev2-button ${activeTab === 'settings' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '11.5px', padding: '5px 14px' }}
            >
              Ерөнхий тохиргоо
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`homev2-button ${activeTab === 'audit' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '11.5px', padding: '5px 14px' }}
            >
              Үйлдлийн бүртгэл ({auditLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trash')}
              className={`homev2-button ${activeTab === 'trash' ? 'homev2-button--primary' : 'homev2-button--light'}`}
              style={{ fontSize: '11.5px', padding: '5px 14px' }}
            >
              Хогийн сав ({trashItems.length})
            </button>
          </div>
        )}

        {/* TAB 1: PEOPLE & TREE CRUD */}
        {activeTab === 'people' && (
          <div className="families-main-card">
            {duplicateCandidates.length > 0 && (
              <details
                style={{
                  marginBottom: '18px',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  background: 'rgba(217, 119, 6, 0.08)',
                  border: '1px solid rgba(217, 119, 6, 0.3)',
                }}
              >
                <summary style={{ cursor: 'pointer', fontSize: '12.5px', fontWeight: 700, color: '#b45309' }}>
                  Давхардсан байж болзошгүй {duplicateCandidates.length} бүртгэл илэрлээ (шалгах)
                </summary>
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {duplicateCandidates.map((dup, idx) => (
                    <div
                      key={`${dup.personA.id}-${dup.personB.id}-${idx}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        background: '#ffffff',
                        border: '1px solid var(--parchment-border, #e2d9c8)',
                        fontSize: '12px',
                      }}
                    >
                      <div>
                        <strong>{dup.personA.last_name} {dup.personA.first_name}</strong> ({dup.personA.birth_date?.slice(0, 4) || '—'})
                        {' '}↔{' '}
                        <strong>{dup.personB.last_name} {dup.personB.first_name}</strong> ({dup.personB.birth_date?.slice(0, 4) || '—'})
                        <span style={{ marginLeft: '8px', color: '#74857b' }}>
                          [{dup.reasons.join(', ')}]
                        </span>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => {
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
                                    { method: 'POST' }
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
                          }}
                          className="admin-remove-btn"
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                        >
                          Нэгтгэх
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
              <div>
                <h3 style={{ font: '600 18px Georgia, serif', margin: 0, color: 'var(--ink-primary, #17372b)' }}>
                  Хүмүүсийн бүртгэл ({people.length})
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', minWidth: '220px' }}>
                  <input
                    type="text"
                    placeholder="Нэр, огноогоор хайх…"
                    value={personSearch}
                    onChange={(e) => setPersonSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px 8px 32px',
                      borderRadius: '10px',
                      border: '1px solid var(--parchment-border, #e2d9c8)',
                      fontSize: '12px',
                    }}
                  />
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                </div>
                {isAdmin && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setWizardAnchorId(null);
                        setWizardRole('standalone');
                        setWizardOpen(true);
                      }}
                      className="homev2-button homev2-button--primary"
                      style={{
                        fontSize: '12px',
                        padding: '8px 16px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'linear-gradient(135deg, #059669, #047857)',
                        border: 'none',
                        color: '#fff',
                        boxShadow: '0 2px 8px rgba(5,150,105,0.25)',
                      }}
                    >
                      <Sparkles size={14} /> + Ухаалаг Wizard-аар хүн нэмэх
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddPerson((prev) => !prev)}
                      className="homev2-button homev2-button--light"
                      style={{ fontSize: '12px', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <UserPlus size={14} /> {showAddPerson ? 'Хаах' : 'Энгийн хэлбэр'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ADD PERSON INLINE FORM */}
            {showAddPerson && (
              <form
                onSubmit={handleAddPerson}
                style={{
                  padding: '20px',
                  borderRadius: '14px',
                  background: 'rgba(217, 184, 93, 0.1)',
                  border: '1px solid rgba(217, 184, 93, 0.35)',
                  marginBottom: '24px',
                }}
              >
                <h4 style={{ font: '600 16px Georgia, serif', margin: '0 0 14px', color: 'var(--ink-primary, #17372b)' }}>
                  + Шинэ хүн ургийн бүртгэлд нэмэх
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Овог (Last Name) *
                    <input
                      value={newPersonLastName}
                      onChange={(e) => setNewPersonLastName(e.target.value)}
                      placeholder="Жишээ: Боржигон"
                      required
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Өөрийн нэр (First Name) *
                    <input
                      value={newPersonFirstName}
                      onChange={(e) => setNewPersonFirstName(e.target.value)}
                      placeholder="Жишээ: Батбаяр"
                      required
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Хүйс *
                    <select
                      value={newPersonGender}
                      onChange={(e) => setNewPersonGender(e.target.value as 'male' | 'female')}
                      className="admin-role-select"
                      style={{ width: '100%', marginTop: '4px', height: '36px' }}
                    >
                      <option value="male">Эрэгтэй</option>
                      <option value="female">Эмэгтэй</option>
                    </select>
                  </label>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Төрсөн огноо (YYYY эсвэл YYYY-MM-DD)
                    <input
                      value={newPersonBirthDate}
                      onChange={(e) => setNewPersonBirthDate(e.target.value)}
                      placeholder="1960-05-12"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Амьд сэрүүн эсэх
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                      <input
                        type="checkbox"
                        checked={newPersonIsAlive}
                        onChange={(e) => setNewPersonIsAlive(e.target.checked)}
                        style={{ width: '16px', height: '16px', accentColor: '#d97706' }}
                      />
                      <span style={{ fontSize: '12px' }}>{newPersonIsAlive ? 'Амьд сэрүүн' : 'Тэнгэрт хальсан'}</span>
                    </div>
                  </label>
                  {!newPersonIsAlive && (
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>
                      Нас барсан огноо
                      <input
                        value={newPersonDeathDate}
                        onChange={(e) => setNewPersonDeathDate(e.target.value)}
                        placeholder="2010"
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                      />
                    </label>
                  )}
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Ургийн овог / Яс салбар
                    <input
                      value={newPersonLineage}
                      onChange={(e) => setNewPersonLineage(e.target.value)}
                      placeholder="Жишээ: Хиад Боржигон"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                    />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="submit"
                    className="homev2-button homev2-button--primary"
                    disabled={actionBusy}
                    style={{ fontSize: '12px', padding: '8px 20px' }}
                  >
                    {actionBusy ? 'Бүртгэж байна…' : 'Хүн бүртгэх'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddPerson(false)}
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: '12px' }}
                  >
                    Болих
                  </button>
                </div>
              </form>
            )}

            {/* EDIT PERSON MODAL */}
            {editingPerson && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 100,
                  display: 'grid',
                  placeItems: 'center',
                  padding: '16px',
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <div
                  style={{
                    width: 'min(540px, 100%)',
                    background: 'var(--parchment-card, #fffdf9)',
                    border: '1px solid var(--parchment-border, #e2d9c8)',
                    borderRadius: '16px',
                    padding: '24px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ font: '600 18px Georgia, serif', margin: 0, color: 'var(--ink-primary, #17372b)' }}>
                      ✏️ Хүний мэдээлэл засах
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingPerson(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <form onSubmit={handleUpdatePerson}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>
                        Овог *
                        <input
                          value={editLastName}
                          onChange={(e) => setEditLastName(e.target.value)}
                          required
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                        />
                      </label>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>
                        Өөрийн нэр *
                        <input
                          value={editFirstName}
                          onChange={(e) => setEditFirstName(e.target.value)}
                          required
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                        />
                      </label>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>
                        Хүйс
                        <select
                          value={editGender}
                          onChange={(e) => setEditGender(e.target.value as 'male' | 'female')}
                          className="admin-role-select"
                          style={{ width: '100%', marginTop: '4px', height: '36px' }}
                        >
                          <option value="male">Эрэгтэй</option>
                          <option value="female">Эмэгтэй</option>
                        </select>
                      </label>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>
                        Төрсөн огноо
                        <input
                          value={editBirthDate}
                          onChange={(e) => setEditBirthDate(e.target.value)}
                          placeholder="1970-01-01"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                        />
                      </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                      <input
                        type="checkbox"
                        checked={editIsAlive}
                        onChange={(e) => setEditIsAlive(e.target.checked)}
                        style={{ width: '16px', height: '16px', accentColor: '#d97706' }}
                      />
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>
                        {editIsAlive ? 'Амьд сэрүүн' : 'Тэнгэрт хальсан'}
                      </span>
                    </div>
                    {!editIsAlive && (
                      <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '14px' }}>
                        Нас барсан огноо
                        <input
                          value={editDeathDate}
                          onChange={(e) => setEditDeathDate(e.target.value)}
                          placeholder="2015"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                        />
                      </label>
                    )}
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => setEditingPerson(null)}
                        className="homev2-button homev2-button--light"
                        style={{ fontSize: '12px' }}
                      >
                        Болих
                      </button>
                      <button
                        type="submit"
                        className="homev2-button homev2-button--primary"
                        disabled={actionBusy}
                        style={{ fontSize: '12px', padding: '8px 18px' }}
                      >
                        {actionBusy ? 'Хадгалж байна…' : 'Өөрчлөлтийг хадгалах'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* PEOPLE TABLE */}
            {detailLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#74857b' }}>Хүмүүсийн бүртгэлийг ачаалж байна…</div>
            ) : filteredPeople.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredPeople.map((person) => {
                  const isMale = person.gender === 'male';
                  const isFemale = person.gender === 'female';
                  return (
                    <div
                      key={person.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        background: 'var(--parchment-canvas, #f6f2e8)',
                        border: '1px solid var(--parchment-border, #e2d9c8)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '13px',
                            color: '#ffffff',
                            background: isMale
                              ? 'linear-gradient(135deg, #1e3a8a, #0284c7)'
                              : isFemale
                              ? 'linear-gradient(135deg, #9f1239, #ea580c)'
                              : '#64748b',
                            border: '1.5px solid var(--gold, #d9b85d)',
                          }}
                        >
                          {person.last_name?.slice(0, 1)}
                          {person.first_name?.slice(0, 1)}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '14.5px', color: 'var(--ink-primary, #17372b)' }}>
                              {person.last_name} {person.first_name}
                            </strong>
                            {(person.is_minor || (person.birth_date && person.is_alive && (new Date().getFullYear() - parseInt(person.birth_date.slice(0, 4), 10) < 18))) && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '10px',
                                  padding: '2px 7px',
                                  borderRadius: '999px',
                                  background: 'rgba(2, 132, 199, 0.1)',
                                  color: '#0284c7',
                                  fontWeight: 600,
                                  border: '1px solid rgba(2, 132, 199, 0.25)',
                                }}
                                title="Насанд хүрээгүй гишүүний хувийн нууцлал хамгаалагдсан"
                              >
                                <Shield size={10} /> Хүүхдийн хамгаалалт
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', fontSize: '11px', color: 'var(--ink-muted, #74857b)' }}>
                            <span>{isMale ? 'Эрэгтэй' : isFemale ? 'Эмэгтэй' : 'Бусад'}</span>
                            <span>·</span>
                            <span>{person.birth_date?.slice(0, 4) || '—'} {person.is_alive ? '(амьд сэрүүн)' : `– ${person.death_date?.slice(0, 4) || '?'}`}</span>
                            {person.created_by && (
                              <>
                                <span>·</span>
                                <span>Нэмсэн: {person.created_by.slice(0, 6)}…</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Link
                          href={`/profile?family=${encodeURIComponent(selectedFamilyId)}&person=${encodeURIComponent(person.id)}`}
                          className="homev2-button homev2-button--light"
                          style={{ fontSize: '11px', padding: '4px 10px' }}
                        >
                          Профайл
                        </Link>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setWizardAnchorId(person.id);
                                setWizardRole('son');
                                setWizardOpen(true);
                              }}
                              className="homev2-button homev2-button--primary"
                              style={{
                                fontSize: '11px',
                                padding: '4px 10px',
                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                border: 'none',
                                color: '#fff',
                              }}
                              title="Энэ хүнд үр хүүхэд, хань, эсвэл эцэг эх ухаалгаар холбох"
                            >
                              <GitFork size={12} style={{ display: 'inline', marginRight: '4px' }} /> + Ураг зангидах
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditPerson(person)}
                              className="homev2-button homev2-button--light"
                              style={{ fontSize: '11px', padding: '4px 10px' }}
                            >
                              <Edit3 size={12} style={{ display: 'inline', marginRight: '4px' }} /> Засах
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeletePerson(person)}
                              className="admin-remove-btn"
                              style={{ fontSize: '11px', padding: '4px 10px' }}
                            >
                              <Trash2 size={12} style={{ display: 'inline', marginRight: '4px' }} /> Устгах
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ fontSize: '13px', color: '#74857b', padding: '16px 0' }}>Бүртгэлтэй хүн олдсонгүй.</p>
            )}
          </div>
        )}

        {/* TAB 2: RELATIONSHIPS MANAGER */}
        {activeTab === 'relationships' && (
          <div style={{ display: 'grid', gap: '20px' }}>
            {/* PARENT-CHILD BUILDER */}
            <div className="families-main-card">
              <h3 style={{ font: '600 17px Georgia, serif', margin: '0 0 16px', color: 'var(--ink-primary, #17372b)' }}>
                Эцэг эх — Хүүхдийн холбоос үүсгэх
              </h3>

              <form onSubmit={handleAddParentChild} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, minWidth: '220px' }}>
                  Эцэг / Эх:
                  <select
                    value={relParentId}
                    onChange={(e) => setRelParentId(e.target.value)}
                    required
                    className="admin-role-select"
                    style={{ width: '100%', marginTop: '4px', height: '38px' }}
                  >
                    <option value="">-- Сонгох --</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.last_name} {p.first_name} ({p.gender === 'female' ? 'Эх' : 'Эцэг'})
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ paddingBottom: '10px', color: '#d97706', fontWeight: 700 }}>→</div>

                <label style={{ fontSize: '12px', fontWeight: 600, minWidth: '220px' }}>
                  Хүүхэд:
                  <select
                    value={relChildId}
                    onChange={(e) => setRelChildId(e.target.value)}
                    required
                    className="admin-role-select"
                    style={{ width: '100%', marginTop: '4px', height: '38px' }}
                  >
                    <option value="">-- Сонгох --</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.last_name} {p.first_name}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="submit"
                  className="homev2-button homev2-button--primary"
                  disabled={actionBusy}
                  style={{ fontSize: '12px', padding: '8px 18px', height: '38px' }}
                >
                  Холбоос үүсгэх
                </button>
              </form>
            </div>

            {/* MARRIAGES MANAGER */}
            <div className="families-main-card">
              <h3 style={{ font: '600 17px Georgia, serif', margin: '0 0 16px', color: 'var(--ink-primary, #17372b)' }}>
                Гэрлэлтийн холбоо ({marriages.length})
              </h3>

              <form onSubmit={handleAddMarriage} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '24px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, minWidth: '180px' }}>
                  1-р хүн:
                  <select
                    value={marriageP1}
                    onChange={(e) => setMarriageP1(e.target.value)}
                    required
                    className="admin-role-select"
                    style={{ width: '100%', marginTop: '4px', height: '38px' }}
                  >
                    <option value="">-- Сонгох --</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.last_name} {p.first_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ fontSize: '12px', fontWeight: 600, minWidth: '180px' }}>
                  2-р хүн (Хань):
                  <select
                    value={marriageP2}
                    onChange={(e) => setMarriageP2(e.target.value)}
                    required
                    className="admin-role-select"
                    style={{ width: '100%', marginTop: '4px', height: '38px' }}
                  >
                    <option value="">-- Сонгох --</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.last_name} {p.first_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ fontSize: '12px', fontWeight: 600, minWidth: '140px' }}>
                  Гэрлэсэн он:
                  <input
                    value={marriageStartDate}
                    onChange={(e) => setMarriageStartDate(e.target.value)}
                    placeholder="1985"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                  />
                </label>

                <button
                  type="submit"
                  className="homev2-button homev2-button--primary"
                  disabled={actionBusy}
                  style={{ fontSize: '12px', padding: '8px 18px', height: '38px' }}
                >
                  Гэрлэлт бүртгэх
                </button>
              </form>

              {/* Marriages List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {marriages.map((m) => {
                  const p1 = people.find((p) => p.id === m.person_1_id);
                  const p2 = people.find((p) => p.id === m.person_2_id);
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 16px',
                        borderRadius: '10px',
                        background: 'var(--parchment-canvas, #f6f2e8)',
                        border: '1px solid var(--parchment-border, #e2d9c8)',
                        flexWrap: 'wrap',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Heart size={16} style={{ color: '#e11d48' }} />
                        <strong style={{ fontSize: '13.5px', color: 'var(--ink-primary, #17372b)' }}>
                          {p1 ? `${p1.last_name} ${p1.first_name}` : 'Хүн 1'} &{' '}
                          {p2 ? `${p2.last_name} ${p2.first_name}` : 'Хүн 2'}
                        </strong>
                        {m.start_date && (
                          <span style={{ fontSize: '11px', color: 'var(--ink-muted, #74857b)' }}>
                            ({m.start_date.slice(0, 4)} онд)
                          </span>
                        )}
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteMarriage(m.id)}
                          className="admin-remove-btn"
                          style={{ fontSize: '11px', padding: '4px 10px' }}
                        >
                          Холбоос цуцлах
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: MEMBERS & ROLES */}
        {activeTab === 'members' && (
          <div className="families-main-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ font: '600 18px Georgia, serif', margin: 0, color: 'var(--ink-primary, #17372b)' }}>
                Гишүүд ({members.length})
              </h3>
            </div>

            <div className="admin-members-list">
              {members.map((member) => (
                <div key={member.user_id} className="admin-member-card">
                  <div className="admin-member-left">
                    <div className="admin-member-avatar">
                      {member.display_name?.slice(0, 1).toUpperCase() || '?'}
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '14.5px', color: 'var(--ink-primary, #17372b)' }}>
                        {member.display_name}
                      </strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <RoleBadge role={member.role} />
                        <span style={{ fontSize: '11px', color: 'var(--ink-muted, #74857b)' }}>
                          User ID: {member.user_id.slice(0, 8)}…
                        </span>
                        {/* Linked Person Badge */}
                        {member.person_id ? (() => {
                          const linkedP = people.find((p) => p.id === member.person_id);
                          return (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                background: 'rgba(16, 185, 129, 0.12)',
                                color: '#047857',
                                border: '1px solid rgba(16, 185, 129, 0.28)',
                                fontWeight: 600,
                              }}
                            >
                              🌿 Модон дахь хүн: {linkedP ? `${linkedP.last_name} ${linkedP.first_name}` : 'Холбогдсон'}
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => void handleUnlinkMember(member.user_id, member.display_name)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#b91c1c',
                                    cursor: 'pointer',
                                    padding: '0 2px',
                                    fontSize: '11px',
                                    marginLeft: '4px',
                                    textDecoration: 'underline',
                                  }}
                                  title="Энэ холбоосыг салгах"
                                >
                                  Салгах
                                </button>
                              )}
                            </span>
                          );
                        })() : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              background: 'rgba(234, 88, 12, 0.1)',
                              color: '#c2410c',
                              border: '1px solid rgba(234, 88, 12, 0.25)',
                              fontWeight: 600,
                            }}
                          >
                            ⚠️ Модонд холбогдоогүй
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => {
                                  setLinkingMember(member);
                                  setSelectedPersonForLink('');
                                  setLinkSearchQuery('');
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#0284c7',
                                  cursor: 'pointer',
                                  padding: '0 2px',
                                  fontSize: '11px',
                                  marginLeft: '4px',
                                  fontWeight: 700,
                                  textDecoration: 'underline',
                                }}
                              >
                                + Хүнтэй холбох
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="admin-member-right">
                    {isOwner ? (
                      <>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--ink-secondary, #485c53)' }}>
                          <span>Эрх солих:</span>
                          <select
                            value={member.role}
                            onChange={(e) => void handleUpdateRole(member.user_id, e.target.value)}
                            disabled={actionBusy}
                            className="admin-role-select"
                          >
                            <option value="owner">👑 Эзэмшигч (Ерөнхий Админ)</option>
                            <option value="editor">✏️ Засварлагч (Editor)</option>
                            <option value="member">👤 Гишүүн (Member)</option>
                          </select>
                        </label>
                        {member.role !== 'owner' && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveMember(member.user_id, member.display_name)}
                            disabled={actionBusy}
                            className="admin-remove-btn"
                          >
                            <Trash2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                            Хасах
                          </button>
                        )}
                      </>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: INVITATIONS */}
        {activeTab === 'invitations' && (
          <div className="families-main-card">
            <h3 style={{ font: '600 18px Georgia, serif', margin: '0 0 16px', color: 'var(--ink-primary, #17372b)' }}>
              Урилга илгээх
            </h3>

            {/* Created Invite Success Card with 1-Click Copy */}
            {createdInviteUrl && (
              <div
                style={{
                  padding: '18px 20px',
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(5, 150, 105, 0.06))',
                  border: '1.5px solid rgba(16, 185, 129, 0.4)',
                  marginBottom: '24px',
                  boxShadow: '0 4px 16px rgba(5, 150, 105, 0.1)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={18} style={{ color: '#059669' }} />
                    <strong style={{ fontSize: '15px', color: '#065f46' }}>
                      Шинэ урилгын нууц холбоос амжилттай үүсгэгдлээ!
                    </strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreatedInviteUrl(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#74857b' }}
                  >
                    <X size={16} />
                  </button>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--ink-secondary, #485c53)', margin: '0 0 12px' }}>
                  Уригдсан хүн рүүгээ доорх холбоосыг Telegram, Messenger, SMS эсвэл WhatsApp-аар шууд илгээнэ үү. Тэд холбоос дээр дарахад л шууд энэ гэр бүлийн гишүүн болж баталгаажна:
                </p>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
                  <input
                    type="text"
                    readOnly
                    value={createdInviteUrl}
                    onFocus={(e) => e.target.select()}
                    style={{
                      flex: '1',
                      minWidth: '260px',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      background: '#fff',
                      fontSize: '12.5px',
                      fontFamily: 'monospace',
                      color: '#065f46',
                      fontWeight: 600,
                    }}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(createdInviteUrl);
                      setCopiedInvite(true);
                      setTimeout(() => setCopiedInvite(false), 2400);
                    }}
                    className="homev2-button homev2-button--primary"
                    style={{
                      fontSize: '12.5px',
                      padding: '10px 18px',
                      background: copiedInvite ? '#10b981' : 'linear-gradient(135deg, #059669, #047857)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {copiedInvite ? <Check size={14} /> : <Copy size={14} />}
                    {copiedInvite ? 'Хуулагдлаа!' : '1-Click Холбоос хуулах'}
                  </button>
                </div>

                {/* Quick Share Buttons */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '11.5px', color: 'var(--ink-muted, #74857b)' }}>Шууд хуваалцах:</span>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(createdInviteUrl)}&text=${encodeURIComponent(`Сайн байна уу? Гуулингийнхан систем дэх “${selectedFamily?.name}” ургийн бичигт нэгдэх урилга:`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: '11px', padding: '4px 12px' }}
                  >
                    ✈️ Telegram
                  </a>
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Сайн байна уу? Гуулингийнхан систем дэх “${selectedFamily?.name}” ургийн бичигт нэгдэх урилга: ${createdInviteUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: '11px', padding: '4px 12px' }}
                  >
                    💬 WhatsApp
                  </a>
                </div>
              </div>
            )}

            {isOwner && (
              <form
                onSubmit={handleSendInvite}
                style={{
                  padding: '20px',
                  borderRadius: '12px',
                  background: 'rgba(217, 184, 93, 0.1)',
                  border: '1px solid rgba(217, 184, 93, 0.3)',
                  marginBottom: '28px',
                }}
              >
                <h4 style={{ font: '600 16px Georgia, serif', margin: '0 0 4px', color: 'var(--ink-primary, #17372b)' }}>
                  + Шинэ гишүүн урих & Холбоос үүсгэх
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Имэйл хаяг:
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="gerbul@example.mn"
                      required
                      disabled={actionBusy}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    Олгох эрхийн үүрэг:
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as 'member' | 'editor')}
                      disabled={actionBusy}
                      className="admin-role-select"
                      style={{ width: '100%', marginTop: '4px', height: '38px' }}
                    >
                      <option value="member">Гишүүн (Өөрийнхийгөө засах, мод ба түүх үзэх)</option>
                      <option value="editor">Засварлагч (Мод ба хүмүүс засах админ эрхтэй)</option>
                    </select>
                  </label>
                </div>
                <button
                  type="submit"
                  className="homev2-button homev2-button--primary"
                  disabled={actionBusy}
                  style={{ fontSize: '12px', padding: '8px 20px' }}
                >
                  {actionBusy ? 'Илгээж байна…' : 'Урилга үүсгэх & Холбоос авах'}
                </button>
              </form>
            )}

            {/* Pending Invites */}
            <h4 style={{ font: '600 16px Georgia, serif', margin: '0 0 10px', color: 'var(--ink-primary, #17372b)' }}>
              Хүлээгдэж буй идэвхтэй урилгууд ({invitations.length})
            </h4>
            {invitations.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {invitations.map((inv) => (
                  <div
                    key={inv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: '10px',
                      background: 'var(--parchment-canvas, #f6f2e8)',
                      border: '1px solid var(--parchment-border, #e2d9c8)',
                      flexWrap: 'wrap',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Mail size={18} style={{ color: 'var(--gold, #d9b85d)' }} />
                      <div>
                        <strong style={{ fontSize: '14px', color: 'var(--ink-primary, #17372b)' }}>
                          {inv.email}
                        </strong>
                        <div style={{ fontSize: '11px', color: 'var(--ink-muted, #74857b)' }}>
                          Хүчинтэй хугацаа: {new Date(inv.expires_at).toLocaleDateString('mn-MN')} ({Math.max(0, Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))} хоног үлдсэн)
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <RoleBadge role={inv.role} />
                      {isOwner && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void handleRevokeInvite(inv.id, inv.email)}
                          className="admin-remove-btn"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                        >
                          Цуцлах
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '13px', color: '#74857b', padding: '12px 0' }}>Идэвхтэй хүлээгдэж буй урилга алга байна.</p>
            )}
          </div>
        )}

        {/* TAB 5: HERITAGE & CONTENT MODERATION */}
        {activeTab === 'heritage' && (
          <div style={{ display: 'grid', gap: '20px' }}>
            {/* PEDIGREE CERTIFICATE */}
            <div
              className="families-main-card"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                background: 'linear-gradient(135deg, rgba(23, 55, 43, 0.04), rgba(180, 83, 9, 0.06))',
                border: '1px solid rgba(180, 83, 9, 0.25)',
              }}
            >
              <div>
                <h3 style={{ font: '600 17px Georgia, serif', margin: '0 0 4px', color: 'var(--ink-primary, #17372b)' }}>
                  Ургийн Батламж үүсгэх
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--ink-secondary, #485c53)', margin: 0 }}>
                  Уламжлалт хэв маяг, тамга бүхий дурсгалын батламж үүсгэж хэвлэх эсвэл PDF татаж авна.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCertificateOpen(true)}
                className="homev2-button homev2-button--primary"
                style={{ fontSize: '12.5px', padding: '8px 18px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Award size={15} /> Батламж үүсгэх
              </button>
            </div>

            {/* STORIES */}
            <div className="families-main-card">
              <h3 style={{ font: '600 17px Georgia, serif', margin: '0 0 10px', color: 'var(--ink-primary, #17372b)' }}>
                Манай түүхүүд ({stories?.items?.length ?? 0})
              </h3>
              {stories?.items?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {stories.items.map((st) => (
                    <div
                      key={st.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: '10px',
                        background: 'var(--parchment-canvas, #f6f2e8)',
                        border: '1px solid var(--parchment-border, #e2d9c8)',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '13.5px', color: 'var(--ink-primary, #17372b)' }}>{st.title}</strong>
                        <span style={{ display: 'block', fontSize: '11px', color: 'var(--ink-muted, #74857b)' }}>
                          Огноо: {st.event_date || 'Тодорхойгүй'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <Link href={`/stories/${st.id}?family=${encodeURIComponent(selectedFamilyId)}`} className="homev2-button homev2-button--light" style={{ fontSize: '11px', padding: '4px 8px' }}>
                          Үзэх
                        </Link>
                        {isAdmin && (
                          <button type="button" onClick={() => void handleDeleteStory(st.id)} className="admin-remove-btn" style={{ fontSize: '11px', padding: '4px 8px' }}>
                            Устгах
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '12px', color: '#74857b' }}>Одоогоор нийтлэгдсэн түүх алга.</p>
              )}
            </div>

            {/* MEMORIES */}
            <div className="families-main-card">
              <h3 style={{ font: '600 18px Georgia, serif', margin: '0 0 10px', color: 'var(--ink-primary, #17372b)' }}>
                📷 Дурсамж & Гэрэл зургууд ({memories.length})
              </h3>
              {memories.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                  {memories.map((mem) => (
                    <div
                      key={mem.id}
                      style={{
                        padding: '10px',
                        borderRadius: '10px',
                        background: 'var(--parchment-canvas, #f6f2e8)',
                        border: '1px solid var(--parchment-border, #e2d9c8)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>{mem.title}</strong>
                        <small style={{ color: 'var(--ink-muted, #74857b)', fontSize: '11px' }}>{mem.memory_date || 'Огноогүй'}</small>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '10px', justifyContent: 'flex-end' }}>
                        <Link href={`/memories?family=${encodeURIComponent(selectedFamilyId)}`} className="homev2-button homev2-button--light" style={{ fontSize: '10px', padding: '3px 8px' }}>
                          Нээх
                        </Link>
                        {isAdmin && (
                          <button type="button" onClick={() => void handleDeleteMemory(mem.id)} className="admin-remove-btn" style={{ fontSize: '10px', padding: '3px 8px' }}>
                            Устгах
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '12px', color: '#74857b' }}>Одоогоор хадгалсан дурсамж алга.</p>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="families-main-card">
            <h3 style={{ font: '600 20px Georgia, serif', margin: '0 0 16px', color: 'var(--ink-primary, #17372b)' }}>
              ⚙️ Гэр бүлийн ерөнхий тохиргоо
            </h3>

            <form onSubmit={handleSaveFamily} style={{ display: 'grid', gap: '14px', maxWidth: '600px', marginBottom: '32px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600 }}>
                Гэр бүлийн нэр:
                <input
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  maxLength={180}
                  required
                  disabled={actionBusy}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '6px' }}
                />
              </label>
              <label style={{ fontSize: '13px', fontWeight: 600 }}>
                Тайлбар:
                <textarea
                  value={familyDescription}
                  onChange={(e) => setFamilyDescription(e.target.value)}
                  maxLength={10000}
                  rows={4}
                  disabled={actionBusy}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '6px' }}
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

            {/* DANGER ZONE */}
            {isOwner && (
              <div style={{ padding: '20px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', maxWidth: '600px', marginBottom: '24px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#dc2626', margin: '0 0 6px' }}>
                  Аюултай бүс: Гэр бүлийг архивлах
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--ink-secondary, #485c53)', margin: '0 0 14px' }}>
                  Гэр бүлийг архивласнаар идэвхтэй жагсаалтаас гарах бөгөөд зөвхөн сэргээх замаар ашиглана.
                </p>
                <button
                  type="button"
                  className="admin-remove-btn"
                  onClick={() => {
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
                  }}
                  disabled={actionBusy}
                >
                  Гэр бүлийг архивлах
                </button>
              </div>
            )}

            {/* DISCREET SYSTEM DATA BACKUP */}
            <div style={{ marginTop: '36px', paddingTop: '20px', borderTop: '1px solid var(--parchment-border, #e2d9c8)' }}>
              <details style={{ cursor: 'pointer' }}>
                <summary style={{ fontSize: '12px', color: 'var(--ink-muted, #74857b)', userSelect: 'none' }}>
                  Нөөц өгөгдөл татах, сэргээх (JSON / GEDCOM)
                </summary>
                <div style={{ marginTop: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: '11.5px', padding: '6px 14px' }}
                  >
                    <Download size={13} style={{ display: 'inline', marginRight: '4px' }} /> JSON нөөц татах
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportBackup}
                    style={{ display: 'none' }}
                    id="admin-backup-file-input"
                    disabled={importingBackup}
                  />
                  <label
                    htmlFor="admin-backup-file-input"
                    className="homev2-button homev2-button--light"
                    style={{
                      fontSize: '11.5px',
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
                    style={{ fontSize: '11.5px', padding: '6px 14px' }}
                  >
                    <Download size={13} style={{ display: 'inline', marginRight: '4px' }} /> GEDCOM (.ged) татах
                  </button>

                  <input
                    ref={gedcomFileInputRef}
                    type="file"
                    accept=".ged"
                    onChange={handleImportGedcom}
                    style={{ display: 'none' }}
                    id="admin-gedcom-file-input"
                    disabled={importingBackup}
                  />
                  <label
                    htmlFor="admin-gedcom-file-input"
                    className="homev2-button homev2-button--light"
                    style={{
                      fontSize: '11.5px',
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
        )}

        {/* TAB 7: AUDIT TRAIL & LOGS */}
        {activeTab === 'audit' && (
          <div className="families-main-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
              <div>
                <h3 style={{ font: '600 18px Georgia, serif', margin: 0, color: 'var(--ink-primary, #17372b)' }}>
                  Үйлдлийн бүртгэл ({auditLogs.length})
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ position: 'relative', minWidth: '220px' }}>
                  <input
                    type="text"
                    placeholder="Үйлдэл, ID-аар хайх…"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px 8px 32px',
                      borderRadius: '10px',
                      border: '1px solid var(--parchment-border, #e2d9c8)',
                      fontSize: '12px',
                    }}
                  />
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                </div>
                <button
                  type="button"
                  onClick={() => selectedFamilyId && void loadDetails(selectedFamilyId)}
                  className="homev2-button homev2-button--light"
                  style={{ fontSize: '12px', padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <RefreshCw size={13} className={detailLoading ? 'animate-spin' : ''} /> Шинэчлэх
                </button>
              </div>
            </div>

            {filteredAuditLogs.length > 0 ? (
              <div style={{ display: 'grid', gap: '8px' }}>
                {filteredAuditLogs.map((log) => {
                  const meta = formatAuditAction(log.action);
                  return (
                    <div
                      key={log.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.65)',
                        border: '1px solid var(--parchment-border, #e2d9c8)',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            background: meta.bg,
                            fontSize: '16px',
                            flexShrink: 0,
                          }}
                        >
                          {meta.icon}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink-primary, #17372b)' }}>
                              {meta.label}
                            </span>
                            <span
                              style={{
                                fontSize: '10.5px',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                background: meta.bg,
                                color: meta.color,
                                fontWeight: 600,
                              }}
                            >
                              {log.action}
                            </span>
                            <span
                              style={{
                                fontSize: '10.5px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: '#f1f5f9',
                                color: '#475569',
                              }}
                            >
                              Төрөл: {log.target_type}
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--ink-muted, #74857b)', marginTop: '2px', display: 'flex', gap: '12px' }}>
                            <span>Ажилтан: {log.actor_id.slice(0, 8)}…</span>
                            <span>Бай: {log.target_id.slice(0, 8)}…</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ fontSize: '11.5px', color: 'var(--ink-muted, #74857b)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div>{new Date(log.created_at).toLocaleDateString('mn-MN')}</div>
                        <div style={{ fontSize: '10.5px' }}>{new Date(log.created_at).toLocaleTimeString('mn-MN', { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ fontSize: '13px', color: '#74857b', padding: '16px 0' }}>
                {auditSearch ? 'Хайлтад тохирох үйлдэл олдсонгүй.' : 'Одоогоор бүртгэгдсэн үйлдлийн түүх байхгүй байна.'}
              </p>
            )}
          </div>
        )}

        {/* TAB 8: TRASH BIN & RESTORE */}
        {activeTab === 'trash' && (
          <div className="families-main-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
              <div>
                <h3 style={{ font: '600 18px Georgia, serif', margin: 0, color: 'var(--ink-primary, #17372b)' }}>
                  Хогийн сав ({trashItems.length})
                </h3>
              </div>

              {trashItems.length > 0 && isAdmin && (
                <button
                  type="button"
                  onClick={handleEmptyTrash}
                  className="admin-remove-btn"
                  disabled={actionBusy}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  <Trash2 size={13} style={{ display: 'inline', marginRight: '6px' }} />
                  Хогийн савыг бүрэн цэвэрлэх
                </button>
              )}
            </div>

            {trashItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink-muted, #74857b)' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>🌱</div>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Хогийн сав хоосон байна</p>
                <p style={{ margin: '4px 0 0', fontSize: '12px' }}>Модноос хасагдсан гишүүн одоогоор байхгүй байна.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {trashItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                      padding: '14px 18px',
                      borderRadius: '10px',
                      background: '#ffffff',
                      border: '1px solid var(--parchment-border, #e2d9c8)',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '15px', color: 'var(--ink-primary, #17372b)' }}>
                        {item.person_name}
                      </strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', fontSize: '11.5px', color: 'var(--ink-muted, #74857b)' }}>
                        <span>Устгасан: {new Date(item.deleted_at).toLocaleString('mn-MN')}</span>
                        <span>·</span>
                        <span>Хассан гишүүн: {item.deleted_by_name}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => void handleRestoreTrash(item)}
                        className="homev2-button homev2-button--primary"
                        disabled={actionBusy}
                        style={{
                          fontSize: '11.5px',
                          padding: '6px 14px',
                          background: 'linear-gradient(135deg, #10b981, #059669)',
                          border: 'none',
                          color: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <RefreshCw size={13} />
                        Буцаан сэргээх
                      </button>

                      <button
                        type="button"
                        onClick={() => void handlePurgeTrash(item)}
                        className="admin-remove-btn"
                        disabled={actionBusy}
                        style={{ fontSize: '11.5px', padding: '6px 12px' }}
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
        )}

        {/* PEDIGREE CONTEXT RELATIVE WIZARD MODAL */}
        <PedigreeWizardModal
          familyId={selectedFamilyId}
          people={people}
          marriages={marriages}
          parentChildEdges={treeData?.parent_child_relationships || []}
          initialAnchorPersonId={wizardAnchorId}
          initialRole={wizardRole}
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onSuccess={async (newPerson, msg) => {
            setWizardOpen(false);
            setNotice(msg);
            await loadDetails(selectedFamilyId);
          }}
        />

        {/* OFFICIAL PEDIGREE CERTIFICATE MODAL */}
        <PedigreeCertificateModal
          isOpen={certificateOpen}
          onClose={() => setCertificateOpen(false)}
          family={selectedFamily}
          stats={stats}
          people={people}
          relationships={treeData?.parent_child_relationships || []}
        />

        {/* ACCESSIBLE CONFIRMATION DIALOG */}
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

        {/* MEMBER TO PERSON LINKING MODAL */}
        {linkingMember && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '16px',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setLinkingMember(null);
            }}
          >
            <div
              style={{
                background: '#ffffff',
                borderRadius: '16px',
                maxWidth: '540px',
                width: '100%',
                maxHeight: '90vh',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                border: '1px solid #e2e8f0',
              }}
            >
              {/* Header */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                      👤 Гишүүнийг модон дахь хүнтэй холбох
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                      Хэрэглэгч: <strong>{linkingMember.display_name || linkingMember.email}</strong> ({roleLabel(linkingMember.role)})
                    </p>
                  </div>
                  <button
                    onClick={() => setLinkingMember(null)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      padding: '4px',
                      borderRadius: '6px',
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
                <p style={{ fontSize: '13px', color: '#475569', margin: '0 0 14px', lineHeight: 1.5 }}>
                  Энэ хэрэглэгчийг ургийн модон дахь өөрийнх нь бие хүнтэй холбосноор тухайн хэрэглэгч өөрийн нэр дээрх мэдээлэл, дурсамж, эрх зүйн статусыг автоматаар уялдуулан харах боломжтой болно.
                </p>

                {/* Search */}
                <div style={{ marginBottom: '14px', position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: '#94a3b8' }} />
                  <input
                    type="text"
                    value={linkSearchQuery}
                    onChange={(e) => setLinkSearchQuery(e.target.value)}
                    placeholder="Хүний нэр, овгоор хайх..."
                    style={{
                      width: '100%',
                      padding: '8px 12px 8px 36px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* People List */}
                <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '6px' }}>
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
                        <div
                          key={p.id}
                          onClick={() => setSelectedPersonForLink(p.id)}
                          style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: isSelected ? 'rgba(34, 197, 94, 0.08)' : isCurrent ? '#f0fdf4' : '#ffffff',
                            border: isSelected ? '1.5px solid #16a34a' : isCurrent ? '1px solid #86efac' : '1px solid #e2e8f0',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: p.gender === 'female' ? '#fdf2f8' : '#eff6ff',
                                color: p.gender === 'female' ? '#db2777' : '#2563eb',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '13px',
                              }}
                            >
                              {(p.first_name || '?')[0]}
                            </div>
                            <div>
                              <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#0f172a' }}>
                                {p.last_name ? `${p.last_name} ` : ''}{p.first_name}
                                {p.gender === 'female' ? ' ♀' : ' ♂'}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>
                                {p.birth_date ? p.birth_date.slice(0, 4) : 'Төрсөн он тодорхойгүй'}
                                {p.is_alive ? ' (Энх тунх)' : p.death_date ? ` - ${p.death_date.slice(0, 4)}` : ''}
                              </div>
                            </div>
                          </div>
                          {isCurrent && (
                            <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600, background: '#dcfce7', padding: '2px 8px', borderRadius: '4px' }}>
                              Одоогийн холбоос
                            </span>
                          )}
                          {isSelected && !isCurrent && (
                            <CheckCircle2 size={18} color="#16a34a" />
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Footer */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setLinkingMember(null)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    color: '#475569',
                  }}
                >
                  Болих
                </button>
                <button
                  type="button"
                  disabled={!selectedPersonForLink || actionBusy}
                  onClick={() => handleLinkMember(linkingMember.user_id, selectedPersonForLink)}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background: !selectedPersonForLink || actionBusy ? '#94a3b8' : '#16a34a',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: !selectedPersonForLink || actionBusy ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {actionBusy ? 'Холбож байна…' : 'Холбоосыг батлах'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: '64px', textAlign: 'center', color: '#74857b' }}>
          Бүрэн админ удирдлагын төвийг ачаалж байна…
        </div>
      }
    >
      <AdminContent />
    </Suspense>
  );
}
