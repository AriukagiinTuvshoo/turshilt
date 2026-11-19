import { ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { ApiError } from '../../lib/api';

export type AdminPermissionKey =
  | 'manage_people'
  | 'manage_content'
  | 'manage_members'
  | 'manage_finance'
  | 'manage_data'
  | 'view_audit'
  | 'manage_settings';

export type PermissionMeta = {
  key: AdminPermissionKey;
  emoji: string;
  label: string;
  description: string;
};

export const PERMISSION_CATALOG: PermissionMeta[] = [
  {
    key: 'manage_people',
    emoji: '🌳',
    label: 'Хүмүүс & Ураг төрөл',
    description: 'Шинэ хүн нэмэх, мэдээлэл засах, давхардал нэгтгэх, эцэг-эх/гэрлэлтийн холбоос болон удам салаа засах',
  },
  {
    key: 'manage_content',
    emoji: '🏛️',
    label: 'Өв сан, Түүх, Дурсамж & Архив',
    description: 'Түүх нийтлэх/устгах, гэрэл зургийн дурсамж, архив баримт, сэтгэгдэл ба чатын зохицуулалт',
  },
  {
    key: 'manage_members',
    emoji: '👥',
    label: 'Гишүүд, Урилга & Мод холболт',
    description: 'Шинэ гишүүн урих, урилга цуцлах, account-ыг ургийн модны хүнтэй холбох/салгах, энгийн гишүүн хасах',
  },
  {
    key: 'manage_finance',
    emoji: '💰',
    label: 'Гэр бүлийн сан & Уулзалт',
    description: 'Сан үүсгэх/засах, хандив баталгаажуулах, зарцуулалт бүртгэх, арга хэмжээ/оролцоо удирдах',
  },
  {
    key: 'manage_data',
    emoji: '💾',
    label: 'Өгөгдөл шинэчлэл & Хогийн сав',
    description: 'Хүний нэр, хайлтын индексийг цэгцлэн шинэчлэх, хогийн савнаас сэргээх болон цэвэрлэх',
  },
  {
    key: 'view_audit',
    emoji: '📋',
    label: 'Үйлдлийн түүх (Аудит)',
    description: 'Хэн хэзээ ямар өөрчлөлт хийснийг бүрэн хянах бүртгэлийг үзэх',
  },
  {
    key: 'manage_settings',
    emoji: '⚙️',
    label: 'Ерөнхий тохиргоо',
    description: 'Гэр бүлийн нэр, тайлбар болон суурь мэдээллийг шинэчлэх',
  },
];

export type AdminPreset = {
  id: string;
  emoji: string;
  title: string;
  description: string;
  permissions: AdminPermissionKey[];
};

export const ADMIN_ROLE_PRESETS: AdminPreset[] = [
  {
    id: 'full-helper',
    emoji: '🛡️',
    title: 'Бүрэн туслах админ',
    description: 'Өмчлөл шилжүүлэхээс бусад бүх удирдлагын эрхтэй ерөнхий туслах',
    permissions: [
      'manage_people',
      'manage_content',
      'manage_members',
      'manage_finance',
      'manage_data',
      'view_audit',
      'manage_settings',
    ],
  },
  {
    id: 'data-curator',
    emoji: '🌳',
    title: 'Өгөгдөл ба Мод шинэчлэгч',
    description: 'Хүмүүсийн бүртгэл, ургийн холбоо, давхардал, дата шинэчлэл хариуцна',
    permissions: ['manage_people', 'manage_data', 'view_audit'],
  },
  {
    id: 'heritage-keeper',
    emoji: '🏛️',
    title: 'Өв сан ба Архив хариуцагч',
    description: 'Түүх, дурсамж, гэрэл зураг, хуучин бичиг баримт ба батламж хариуцна',
    permissions: ['manage_content', 'manage_people'],
  },
  {
    id: 'finance-organizer',
    emoji: '💰',
    title: 'Санхүү ба Уулзалт хариуцагч',
    description: 'Ургийн сан, хандив, зарлага болон уулзалт цугларалт зохион байгуулна',
    permissions: ['manage_finance', 'view_audit'],
  },
  {
    id: 'community-host',
    emoji: '👥',
    title: 'Гишүүд ба Урилга хариуцагч',
    description: 'Шинэ хамаатнуудыг урьж модонд холбох, олон нийтийн зохицуулалт хийнэ',
    permissions: ['manage_members', 'manage_people'],
  },
];

export type Member = {
  user_id: string;
  display_name: string;
  role: string;
  person_id?: string | null;
  email?: string | null;
  permissions?: string[];
  admin_title?: string | null;
  joined_at?: string | null;
};

export type Invitation = {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'editor';
  expires_at: string;
  created_at: string;
  status: 'pending';
};

export interface AuditLogItem {
  id: string;
  actor_id: string;
  actor_name?: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  created_at: string;
}

export type AdminTabKey =
  | 'people'
  | 'relationships'
  | 'members'
  | 'invitations'
  | 'heritage'
  | 'audit'
  | 'settings'
  | 'trash';

export function formatAuditAction(action: string) {
  switch (action) {
    case 'person.created':
      return { label: 'Шинэ хүн бүртгэсэн', icon: '👤', color: '#0284c7', bg: 'rgba(2,132,199,0.12)' };
    case 'person.updated':
      return { label: 'Хүний мэдээлэл зассан', icon: '✏️', color: '#0d9488', bg: 'rgba(13,148,136,0.12)' };
    case 'person.detached':
      return { label: 'Ургийн холбоосыг салгасан', icon: '✂️', color: '#ea580c', bg: 'rgba(234,88,12,0.12)' };
    case 'person.restored':
      return { label: 'Хогийн савнаас сэргээсэн', icon: '🌱', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' };
    case 'person.merged':
      return { label: 'Давхардсан хүн нэгтгэсэн', icon: '🔗', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' };
    case 'relationship.parent_child.created':
      return { label: 'Эцэг/эхийн ураг зангидсан', icon: '🌿', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' };
    case 'marriage.created':
      return { label: 'Гэрлэлтийн холбоос үүсгэсэн', icon: '💍', color: '#d97706', bg: 'rgba(217,119,6,0.12)' };
    case 'marriage.updated':
      return { label: 'Гэрлэлтийн мэдээлэл шинэчилсэн', icon: '📝', color: '#b45309', bg: 'rgba(180,83,9,0.12)' };
    case 'marriage.archived':
    case 'marriage.deleted':
      return { label: 'Гэрлэлтийн холбоос хассан', icon: '🗑️', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
    case 'family.created':
      return { label: 'Гэр бүлийн сан үүсгэсэн', icon: '🏛️', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' };
    case 'household.connected_to_clan':
      return { label: 'Өрх гэр бүлийг их ургийн модтой холбосон', icon: '🏡', color: '#059669', bg: 'rgba(16,185,129,0.14)' };
    case 'family.updated':
      return { label: 'Гэр бүлийн тохиргоо зассан', icon: '⚙️', color: '#4b5563', bg: 'rgba(75,85,99,0.12)' };
    case 'family.data_refreshed':
      return { label: 'Өгөгдөл & хайлтын индекс шинэчилсэн', icon: '🔄', color: '#0284c7', bg: 'rgba(2,132,199,0.12)' };
    case 'family.owner_transferred':
      return { label: 'Ерөнхий админ эрх шилжүүлсэн', icon: '👑', color: '#ca8a04', bg: 'rgba(234,179,8,0.14)' };
    case 'family_member.admin_assigned':
      return { label: 'Туслах админ томилсон', icon: '🛡️', color: '#059669', bg: 'rgba(16,185,129,0.14)' };
    case 'family_member.admin_updated':
      return { label: 'Туслах админы эрх шинэчилсэн', icon: '🎛️', color: '#0284c7', bg: 'rgba(2,132,199,0.14)' };
    case 'family_member.role_updated':
      return { label: 'Гишүүний хандах эрх өөрчилсөн', icon: '🛡️', color: '#0284c7', bg: 'rgba(2,132,199,0.12)' };
    case 'family_member.person_linked':
      return { label: 'Хэрэглэгчийг модон дахь хүнтэй холбосон', icon: '🌱', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' };
    case 'family_member.person_unlinked':
      return { label: 'Гишүүний модны холбоосыг салгасан', icon: '🔌', color: '#ea580c', bg: 'rgba(234,88,12,0.12)' };
    case 'family_member.removed':
      return { label: 'Гишүүнийг гэр бүлээс хассан', icon: '🚪', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
    case 'invitation.created':
    case 'invitation.sent':
      return { label: 'Урилга илгээсэн', icon: '✉️', color: '#6366f1', bg: 'rgba(99,102,241,0.12)' };
    case 'invitation.accepted':
      return { label: 'Урилга хүлээн авч гишүүн болсон', icon: '🤝', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' };
    case 'invitation.revoked':
      return { label: 'Урилгыг цуцалсан', icon: '🚫', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' };
    case 'fund.created':
      return { label: 'Гэр бүлийн шинэ сан үүсгэсэн', icon: '💰', color: '#059669', bg: 'rgba(16,185,129,0.12)' };
    case 'fund.expense_recorded':
    case 'fund.expense_created':
      return { label: 'Сангийн зарлага бүртгэсэн', icon: '🧾', color: '#d97706', bg: 'rgba(217,119,6,0.12)' };
    case 'family_event.created':
    case 'event.created':
      return { label: 'Шинэ уулзалт / арга хэмжээ зарласан', icon: '🎉', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' };
    case 'memory.created':
      return { label: 'Дурсамж нийтэлсэн', icon: '❤️', color: '#e11d48', bg: 'rgba(225,29,72,0.12)' };
    case 'memory.deleted':
      return { label: 'Дурсамж устгасан', icon: '🗑️', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
    case 'story.created':
      return { label: 'Түүх бичсэн', icon: '📖', color: '#0284c7', bg: 'rgba(2,132,199,0.12)' };
    case 'story.deleted':
      return { label: 'Түүх устгасан', icon: '🗑️', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
    case 'archive.created':
      return { label: 'Архив баримт оруулсан', icon: '📜', color: '#b45309', bg: 'rgba(180,83,9,0.12)' };
    case 'archive.deleted':
      return { label: 'Архив баримт устгасан', icon: '🗑️', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
    default:
      return { label: action, icon: '⚡', color: '#4b5563', bg: 'rgba(75,85,99,0.12)' };
  }
}

export function roleLabel(role: string, adminTitle?: string | null) {
  if (role === 'owner') return 'Ерөнхий Админ (Owner)';
  if (role === 'admin') return adminTitle ? `Туслах Админ · ${adminTitle}` : 'Туслах Админ (Sub-Admin)';
  if (role === 'editor') return 'Засварлагч (Editor)';
  return 'Гишүүн (Member)';
}

export function RoleBadge({ role, adminTitle }: { role: string; adminTitle?: string | null }) {
  if (role === 'owner') {
    return (
      <span className="admin-badge-owner">
        <Sparkles size={12} />
        <span>👑 Ерөнхий Админ</span>
      </span>
    );
  }
  if (role === 'admin') {
    return (
      <span className="admin-badge-subadmin">
        <ShieldCheck size={12} />
        <span>🛡️ {adminTitle || 'Туслах Админ'}</span>
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

export function permissionEmojiMeta(key: string) {
  return (
    PERMISSION_CATALOG.find((item) => item.key === key) ?? {
      key: key as AdminPermissionKey,
      emoji: '🔑',
      label: key,
      description: '',
    }
  );
}

export function friendlyError(
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
