import { ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { ApiError } from '../../lib/api';

export type Member = {
  user_id: string;
  display_name: string;
  role: string;
  person_id?: string | null;
  email?: string | null;
};

export type Invitation = {
  id: string;
  email: string;
  role: 'member' | 'editor';
  expires_at: string;
  created_at: string;
  status: 'pending';
};

export interface AuditLogItem {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
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

export function roleLabel(role: string) {
  if (role === 'owner') return 'Эзэмшигч (Ерөнхий Админ)';
  if (role === 'editor') return 'Засварлагч (Editor)';
  return 'Гишүүн (Member)';
}

export function RoleBadge({ role }: { role: string }) {
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
