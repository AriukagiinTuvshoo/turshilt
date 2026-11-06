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
} from 'lucide-react';
import { ApiError, api, Family, FamilyStats } from '../../lib/api';

type Member = { user_id: string; display_name: string; role: string };
type Invitation = { id: string; email: string; role: 'member' | 'editor'; expires_at: string; created_at: string; status: 'pending' };

function roleLabel(role: string) {
  if (role === 'owner') return 'Эзэмшигч';
  if (role === 'editor') return 'Засварлагч';
  return 'Гишүүн';
}

function RoleBadge({ role }: { role: string }) {
  if (role === 'owner') {
    return (
      <span className="admin-badge-owner">
        <Sparkles size={12} />
        <span>Эзэмшигч (Админ)</span>
      </span>
    );
  }
  if (role === 'editor') {
    return (
      <span className="admin-badge-editor">
        <ShieldCheck size={12} />
        <span>Засварлагч</span>
      </span>
    );
  }
  return (
    <span className="admin-badge-member">
      <UserRound size={12} />
      <span>Гишүүн</span>
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
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй байна.';
    if (cause.status === 404) return 'Гэр бүл олдсонгүй эсвэл танд хандах эрхгүй байна.';
    if (cause.status === 409) return conflictMessage;
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
  }
  return fallback;
}

function FamiliesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitFamilyId = searchParams.get('family')?.trim() ?? '';
  const [families, setFamilies] = useState<Family[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [stats, setStats] = useState<FamilyStats | null>(null);
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'editor'>('member');
  const [mutation, setMutation] = useState<'edit' | 'archive' | 'invite' | 'revoke' | ''>('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const selectedFamilyRef = useRef('');

  const selectedFamily = useMemo(
    () => families.find((family) => family.id === selectedFamilyId) ?? null,
    [families, selectedFamilyId],
  );

  const loadFamilies = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await api<Family[]>('/families');
      if (current !== sequence.current) return;
      setFamilies(data);
      const validExplicit = explicitFamilyId && data.some((family) => family.id === explicitFamilyId);
      if (validExplicit) {
        setSelectedFamilyId(explicitFamilyId);
      } else if (!explicitFamilyId && data[0]) {
        setSelectedFamilyId(data[0].id);
        router.replace('/families?family=' + encodeURIComponent(data[0].id));
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
  }, [explicitFamilyId, router]);

  const loadDetails = useCallback(async (familyId: string) => {
    const current = ++detailSequence.current;
    setDetailLoading(true);
    setDetailError('');
    setMembers([]);
    setInvitations([]);
    setStats(null);
    try {
      const [memberData, invitationData, statsData] = await Promise.all([
        api<Member[]>(`/families/${familyId}/members`),
        api<Invitation[]>(`/families/${familyId}/invitations`),
        api<FamilyStats>(`/families/${familyId}/stats`).catch(() => null),
      ]);
      if (current !== detailSequence.current || selectedFamilyRef.current !== familyId) return;
      setMembers(memberData);
      setInvitations(invitationData);
      setStats(statsData);
    } catch (cause) {
      if (current === detailSequence.current && selectedFamilyRef.current === familyId) {
        setDetailError(friendlyError(cause, 'Гишүүд болон урилгуудыг ачаалж чадсангүй.'));
      }
    } finally {
      if (current === detailSequence.current && selectedFamilyRef.current === familyId) setDetailLoading(false);
    }
  }, []);

  const updateMemberRole = async (targetUserId: string, nextRole: string) => {
    if (!selectedFamilyId) return;
    setMutation('edit');
    setError('');
    setNotice('');
    try {
      const updated = await api<Member>(`/families/${selectedFamilyId}/members/${targetUserId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      setMembers((prev) => prev.map((m) => (m.user_id === targetUserId ? { ...m, role: updated.role } : m)));
      setNotice('Гишүүний үүрэг, эрх амжилттай шинэчлэгдлээ.');
    } catch (cause) {
      setDetailError(friendlyError(cause, 'Гишүүний үүргийг өөрчилж чадсангүй.'));
    } finally {
      setMutation('');
    }
  };

  const removeMember = async (targetUserId: string, memberName: string) => {
    if (!selectedFamilyId || !confirm(`Та "${memberName}" хэрэглэгчийг энэ гэр бүлээс хасахдаа итгэлтэй байна уу?`)) return;
    setMutation('edit');
    setError('');
    setNotice('');
    try {
      await api<void>(`/families/${selectedFamilyId}/members/${targetUserId}`, {
        method: 'DELETE',
      });
      setMembers((prev) => prev.filter((m) => m.user_id !== targetUserId));
      setNotice(`"${memberName}" хэрэглэгчийг гэр бүлээс хаслаа.`);
    } catch (cause) {
      setDetailError(friendlyError(cause, 'Гишүүнийг хасаж чадсангүй.'));
    } finally {
      setMutation('');
    }
  };

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
      setMembers([]);
      setInvitations([]);
      setEditing(false);
      return;
    }
    setName(selectedFamily.name);
    setDescription(selectedFamily.description ?? '');
    setEditing(false);
    setInviteOpen(false);
    void loadDetails(selectedFamily.id);
  }, [selectedFamily, loadDetails]);

  function selectFamily(id: string) {
    if (!families.some((f) => f.id === id) || mutation) return;
    setSelectedFamilyId(id);
    router.replace('/families?family=' + encodeURIComponent(id));
    setNotice('');
  }

  async function saveFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFamily || mutation) return;
    const nextName = name.trim();
    if (!nextName) {
      setDetailError('Гэр бүлийн нэр хоосон байж болохгүй.');
      return;
    }
    setMutation('edit');
    setDetailError('');
    setNotice('');
    try {
      const updated = await api<Family>(`/families/${selectedFamily.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nextName, description: description.trim() || null }),
      });
      if (selectedFamilyRef.current !== selectedFamily.id) return;
      setFamilies((current) => current.map((f) => (f.id === updated.id ? updated : f)));
      setEditing(false);
      setNotice('Гэр бүлийн мэдээлэл хадгалагдлаа.');
    } catch (cause) {
      setDetailError(friendlyError(cause, 'Гэр бүлийн мэдээллийг хадгалж чадсангүй.'));
    } finally {
      setMutation('');
    }
  }

  async function archiveFamily() {
    if (!selectedFamily || selectedFamily.role !== 'owner' || mutation) return;
    if (
      !window.confirm(
        `“${selectedFamily.name}” гэр бүлийг архивлах уу? Энэ үйлдэл тухайн гэр бүлийг идэвхтэй жагсаалтаас гаргана.`,
      )
    )
      return;
    const archivedId = selectedFamily.id;
    setMutation('archive');
    setDetailError('');
    setNotice('');
    try {
      await api<void>(`/families/${archivedId}`, { method: 'DELETE' });
      if (selectedFamilyRef.current !== archivedId) return;
      const remaining = families.filter((f) => f.id !== archivedId);
      setFamilies(remaining);
      if (remaining.length) {
        const next = remaining[0].id;
        setSelectedFamilyId(next);
        router.replace('/families?family=' + encodeURIComponent(next));
        setNotice('Гэр бүл архивлагдлаа.');
      } else {
        setSelectedFamilyId('');
        router.replace('/families');
        setNotice('Гэр бүл архивлагдлаа. Танд одоогоор идэвхтэй гэр бүл алга.');
      }
    } catch (cause) {
      setDetailError(friendlyError(cause, 'Гэр бүлийг архивлаж чадсангүй.'));
    } finally {
      setMutation('');
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFamily || selectedFamily.role !== 'owner' || mutation) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setMutation('invite');
    setDetailError('');
    setNotice('');
    const familyId = selectedFamily.id;
    try {
      await api(`/families/${familyId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (selectedFamilyRef.current !== familyId) return;
      setInviteEmail('');
      setInviteOpen(false);
      setNotice(`${email} хаяг руу урилга амжилттай илгээгдлээ.`);
      await loadDetails(familyId);
    } catch (cause) {
      if (selectedFamilyRef.current === familyId) {
        setDetailError(
          friendlyError(
            cause,
            'Урилга илгээж чадсангүй.',
            'Энэ имэйл хаягт идэвхтэй урилга байгаа эсвэл аль хэдийн гишүүн байна.',
          ),
        );
      }
    } finally {
      setMutation('');
    }
  }

  async function revokeInvitation(invitationId: string, email: string) {
    if (!selectedFamily || selectedFamily.role !== 'owner' || mutation) return;
    if (!window.confirm(`“${email}” хаягийн урилгыг цуцлах уу?`)) return;
    setMutation('revoke');
    setDetailError('');
    setNotice('');
    const familyId = selectedFamily.id;
    try {
      await api<void>(`/families/${familyId}/invitations/${invitationId}`, { method: 'DELETE' });
      if (selectedFamilyRef.current !== familyId) return;
      setNotice('Урилгыг цуцаллаа.');
      await loadDetails(familyId);
    } catch (cause) {
      if (selectedFamilyRef.current === familyId) {
        setDetailError(friendlyError(cause, 'Урилгыг цуцалж чадсангүй.'));
      }
    } finally {
      setMutation('');
    }
  }

  const isOwner = selectedFamily?.role === 'owner';
  const isEditor = selectedFamily?.role === 'editor';
  const isAdmin = isOwner || isEditor;

  return (
    <div className="families-page" aria-busy={loading}>
      <div className="families-shell">
        {/* Page Header */}
        <div className="families-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <ShieldCheck size={20} style={{ color: 'var(--gold, #d9b85d)' }} />
              <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--gold, #d9b85d)' }}>
                ГЭР БҮЛИЙН УДИРДЛАГЫН ТАНХИМ & АДМИН ПОРТАЛ
              </span>
            </div>
            <h1>Гэр бүлийн тохиргоо ба эрхийн удирдлага</h1>
            <p>
              Гэр бүлийн гишүүдийн үүрэг, эрх (Админ, Засварлагч, Гишүүн), шинэ урилга, мэдээллийн аюулгүй байдлыг
              нэгдсэн эх сурвалжаас удирдана.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {selectedFamily && (
              <Link
                href={`/dashboard?family=${encodeURIComponent(selectedFamily.id)}`}
                className="homev2-button homev2-button--light"
                style={{ fontSize: '13px', padding: '8px 16px' }}
              >
                ← Аппын нүүр
              </Link>
            )}
            <Link
              href="/onboarding"
              className="homev2-button homev2-button--primary"
              style={{ fontSize: '13px', padding: '8px 18px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              + Шинэ гэр бүл үүсгэх
            </Link>
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
              gap: '8px',
              marginBottom: '20px',
            }}
          >
            <CheckCircle2 size={18} />
            <span>{notice}</span>
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
            <button
              type="button"
              onClick={() => void loadFamilies()}
              className="homev2-button homev2-button--light"
              style={{ fontSize: '11px', padding: '4px 10px' }}
            >
              Дахин оролдох
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '64px', textAlign: 'center', color: 'var(--ink-secondary, #485c53)' }}>
            Гэр бүлийн өгөгдлийг ачаалж байна…
          </div>
        ) : families.length === 0 ? (
          <div className="families-main-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <TreeDeciduous size={48} style={{ color: 'var(--gold, #d9b85d)', margin: '0 auto 16px' }} />
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>Ургийн модоо эхлүүлээрэй</h2>
            <p style={{ color: 'var(--ink-secondary, #485c53)', fontSize: '14px', marginBottom: '24px' }}>
              Танд одоогоор идэвхтэй гэр бүлийн бүртгэл алга байна.
            </p>
            <Link href="/onboarding" className="homev2-button homev2-button--primary">
              Шинэ гэр бүл үүсгэх
            </Link>
          </div>
        ) : (
          <div className="families-grid">
            {/* Sidebar: Family Selector */}
            <aside className="families-sidebar-card" aria-label="Гэр бүл сонгох">
              <div className="families-sidebar-title">Таны харьяалагдах гэр бүлүүд</div>
              <div className="families-list">
                {families.map((f) => {
                  const isActive = selectedFamilyId === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={isActive}
                      disabled={Boolean(mutation)}
                      onClick={() => selectFamily(f.id)}
                      className={`family-nav-item ${isActive ? 'is-active' : ''}`}
                    >
                      <div>
                        <strong>{f.name}</strong>
                        <small style={{ fontSize: '11px', opacity: 0.8 }}>
                          {roleLabel(f.role)}
                        </small>
                      </div>
                      <ArrowRight size={14} style={{ opacity: isActive ? 1 : 0.4 }} />
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Main Admin Section */}
            {selectedFamily && (
              <div className="families-main-card">
                {/* Admin Role Status Notice */}
                <div className="admin-info-banner">
                  <Shield size={20} style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong>Админ ба Эрхийн хамгаалалт:</strong>{' '}
                    {isOwner ? (
                      <span>
                        Та энэ гэр бүлийн <strong>Эзэмшигч (Админ)</strong> тул гишүүдийн эрхийг өөрчлөх, шинэ урилга
                        илгээх, мэдээллийн аюулгүй байдлыг хангах бүрэн эрхтэй. Дурын гишүүн бусдын мэдээллийг дур
                        мэдэн устгах, өөрчлөхөөс 100% сэргийлэгдсэн.
                      </span>
                    ) : isEditor ? (
                      <span>
                        Та энэ гэр бүлийн <strong>Засварлагч (Editor)</strong> тул ургийн мод болон хүмүүсийн
                        мэдээллийг баяжуулах эрхтэй.
                      </span>
                    ) : (
                      <span>
                        Та энэ гэр бүлийн <strong>Гишүүн (Member)</strong> тул өөрийн бүртгэлийг удирдах, өөрийн оруулсан
                        хүмүүсийг засах болон гэр бүлийн түүхтэй танилцах эрхтэй.
                      </span>
                    )}
                  </div>
                </div>

                {/* Family Identity Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <RoleBadge role={selectedFamily.role} />
                      <span style={{ fontSize: '12px', color: 'var(--ink-muted, #74857b)' }}>
                        ID: {selectedFamily.id.slice(0, 8)}…
                      </span>
                    </div>
                    <h2 style={{ font: '700 24px Georgia, serif', margin: '0 0 6px', color: 'var(--ink-primary, #17372b)' }}>
                      {selectedFamily.name}
                    </h2>
                    <p style={{ color: 'var(--ink-secondary, #485c53)', fontSize: '14px', margin: 0 }}>
                      {selectedFamily.description || 'Энэ гэр бүлийн удмын бичиг, дурсамж, түүхийн хувийн орон зай.'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Link
                      href={`/tree?family=${encodeURIComponent(selectedFamily.id)}`}
                      className="homev2-button homev2-button--light"
                      style={{ fontSize: '12px', padding: '6px 14px' }}
                    >
                      Ургийн мод →
                    </Link>
                    <Link
                      href={`/people?family=${encodeURIComponent(selectedFamily.id)}`}
                      className="homev2-button homev2-button--light"
                      style={{ fontSize: '12px', padding: '6px 14px' }}
                    >
                      Хүмүүс ({stats?.total_persons ?? 0}) →
                    </Link>
                  </div>
                </div>

                {/* Family Live Stats Strip */}
                {stats && (
                  <div className="admin-stats-strip">
                    <div className="admin-stat-item">
                      <small>Нийт хүмүүс</small>
                      <strong>{stats.total_persons}</strong>
                    </div>
                    <div className="admin-stat-item">
                      <small>Үеийн гүн</small>
                      <strong>{stats.generation_depth} үе</strong>
                    </div>
                    <div className="admin-stat-item">
                      <small>Гэрлэлт</small>
                      <strong>{stats.marriage_count}</strong>
                    </div>
                    <div className="admin-stat-item">
                      <small>Амьд сэрүүн</small>
                      <strong style={{ color: '#059669' }}>{stats.living_count}</strong>
                    </div>
                    <div className="admin-stat-item">
                      <small>Түүх ба Дурсамж</small>
                      <strong style={{ color: '#d97706' }}>{stats.total_stories + stats.total_memories}</strong>
                    </div>
                  </div>
                )}

                {/* Edit Family Info Form */}
                {editing ? (
                  <form onSubmit={saveFamily} style={{ marginTop: '20px', padding: '16px', background: 'var(--parchment-canvas, #f6f2e8)', borderRadius: '12px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Гэр бүлийн нэр, танилцуулга засах</h3>
                    <div style={{ display: 'grid', gap: '10px', marginBottom: '14px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>
                        Гэр бүлийн нэр:
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          maxLength={180}
                          required
                          disabled={mutation === 'edit'}
                          style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                        />
                      </label>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>
                        Тайлбар:
                        <textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          maxLength={10000}
                          rows={3}
                          disabled={mutation === 'edit'}
                          style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                        />
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" className="homev2-button homev2-button--primary" disabled={Boolean(mutation)}>
                        {mutation === 'edit' ? 'Хадгалж байна…' : 'Хадгалах'}
                      </button>
                      <button
                        type="button"
                        className="homev2-button homev2-button--light"
                        disabled={Boolean(mutation)}
                        onClick={() => {
                          setName(selectedFamily.name);
                          setDescription(selectedFamily.description ?? '');
                          setEditing(false);
                        }}
                      >
                        Болих
                      </button>
                    </div>
                  </form>
                ) : (
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    {isAdmin && (
                      <button
                        type="button"
                        className="homev2-button homev2-button--light"
                        style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => setEditing(true)}
                      >
                        <Edit3 size={14} /> Гэр бүлийн мэдээлэл засах
                      </button>
                    )}
                    {isOwner && (
                      <button
                        type="button"
                        className="admin-remove-btn"
                        style={{ fontSize: '12px', padding: '6px 14px' }}
                        onClick={() => void archiveFamily()}
                        disabled={Boolean(mutation)}
                      >
                        Гэр бүлийг архивлах
                      </button>
                    )}
                  </div>
                )}

                <hr style={{ margin: '28px 0', border: 'none', borderTop: '1px solid var(--parchment-border, #e2d9c8)' }} />

                {/* Section: Members & Role Management */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h3 style={{ font: '600 18px Georgia, serif', margin: '0 0 4px', color: 'var(--ink-primary, #17372b)' }}>
                      Гэр бүлийн гишүүд & Үүрэг хариуцлага ({members.length})
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--ink-secondary, #485c53)', margin: 0 }}>
                      Эзэмшигч нь гишүүдийн эрхийг дээшлүүлж/бууруулж өөрчлөх болон шаардлагатай бол хасах эрхтэй.
                    </p>
                  </div>
                  {isOwner && !inviteOpen && (
                    <button
                      type="button"
                      className="homev2-button homev2-button--primary"
                      style={{ fontSize: '12px', padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      onClick={() => setInviteOpen(true)}
                    >
                      <UserPlus size={14} /> + Гишүүн урих
                    </button>
                  )}
                </div>

                {detailError && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#b91c1c',
                      fontSize: '12px',
                      margin: '14px 0',
                    }}
                  >
                    {detailError}
                  </div>
                )}

                {detailLoading ? (
                  <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-muted, #74857b)', fontSize: '13px' }}>
                    Гишүүд болон урилгуудыг ачаалж байна…
                  </div>
                ) : members.length ? (
                  <div className="admin-members-list">
                    {members.map((member) => (
                      <div key={member.user_id} className="admin-member-card">
                        <div className="admin-member-left">
                          <div className="admin-member-avatar">
                            {member.display_name?.slice(0, 1).toUpperCase() || '?'}
                          </div>
                          <div>
                            <strong style={{ display: 'block', fontSize: '14px', color: 'var(--ink-primary, #17372b)' }}>
                              {member.display_name}
                            </strong>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                              <RoleBadge role={member.role} />
                              <span style={{ fontSize: '11px', color: 'var(--ink-muted, #74857b)' }}>
                                ID: {member.user_id.slice(0, 8)}…
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="admin-member-right">
                          {isOwner ? (
                            <>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--ink-secondary, #485c53)' }}>
                                Эрх солих:
                                <select
                                  value={member.role}
                                  onChange={(e) => void updateMemberRole(member.user_id, e.target.value)}
                                  disabled={Boolean(mutation)}
                                  className="admin-role-select"
                                  aria-label={`${member.display_name} үүрэг солих`}
                                >
                                  <option value="owner">Эзэмшигч (Админ)</option>
                                  <option value="editor">Засварлагч</option>
                                  <option value="member">Гишүүн</option>
                                </select>
                              </label>
                              {member.role !== 'owner' && (
                                <button
                                  type="button"
                                  onClick={() => void removeMember(member.user_id, member.display_name)}
                                  disabled={Boolean(mutation)}
                                  className="admin-remove-btn"
                                  title="Энэ гэр бүлээс хасах"
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
                ) : (
                  <p style={{ fontSize: '13px', color: 'var(--ink-muted, #74857b)' }}>Гишүүний мэдээлэл одоогоор алга.</p>
                )}

                {/* Section: Invite Form */}
                {isOwner && inviteOpen && (
                  <form
                    onSubmit={invite}
                    style={{
                      marginTop: '20px',
                      padding: '20px',
                      borderRadius: '12px',
                      background: 'rgba(217, 184, 93, 0.1)',
                      border: '1px solid rgba(217, 184, 93, 0.3)',
                    }}
                  >
                    <h4 style={{ font: '600 16px Georgia, serif', margin: '0 0 4px', color: 'var(--ink-primary, #17372b)' }}>
                      Шинэ гэр бүлийн гишүүн урих
                    </h4>
                    <p style={{ fontSize: '12px', color: 'var(--ink-secondary, #485c53)', margin: '0 0 14px' }}>
                      Уригдсан хүнд баталгаажуулах холбоос илгээгдэх бөгөөд зөвшөөрснөөр тухайн эрхээр системд орно.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>
                        Имэйл хаяг:
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="tany-gerbul@example.mn"
                          required
                          disabled={Boolean(mutation)}
                          style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px' }}
                        />
                      </label>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>
                        Олгох эрхийн үүрэг:
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as 'member' | 'editor')}
                          disabled={Boolean(mutation)}
                          className="admin-role-select"
                          style={{ width: '100%', marginTop: '4px', height: '38px' }}
                        >
                          <option value="member">Гишүүн (Өөрийн мэдээллээ удирдах)</option>
                          <option value="editor">Засварлагч (Мод ба хүмүүс засах)</option>
                        </select>
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="submit"
                        className="homev2-button homev2-button--primary"
                        disabled={Boolean(mutation)}
                        style={{ fontSize: '12px', padding: '8px 16px' }}
                      >
                        {mutation === 'invite' ? 'Илгээж байна…' : 'Урилга илгээх'}
                      </button>
                      <button
                        type="button"
                        className="homev2-button homev2-button--light"
                        disabled={Boolean(mutation)}
                        onClick={() => {
                          setInviteOpen(false);
                          setInviteEmail('');
                        }}
                        style={{ fontSize: '12px' }}
                      >
                        Болих
                      </button>
                    </div>
                  </form>
                )}

                {/* Section: Pending Invitations */}
                <div style={{ marginTop: '28px' }}>
                  <h4 style={{ font: '600 16px Georgia, serif', margin: '0 0 6px', color: 'var(--ink-primary, #17372b)' }}>
                    Хүлээгдэж буй урилгууд ({invitations.length})
                  </h4>
                  {invitations.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      {invitations.map((inv) => (
                        <div
                          key={inv.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderRadius: '10px',
                            background: 'var(--parchment-canvas, #f6f2e8)',
                            border: '1px solid var(--parchment-border, #e2d9c8)',
                            flexWrap: 'wrap',
                            gap: '10px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Mail size={16} style={{ color: 'var(--gold, #d9b85d)' }} />
                            <div>
                              <strong style={{ fontSize: '13px', color: 'var(--ink-primary, #17372b)' }}>
                                {inv.email}
                              </strong>
                              <div style={{ fontSize: '11px', color: 'var(--ink-muted, #74857b)' }}>
                                Дуусах хугацаа: {new Date(inv.expires_at).toLocaleDateString('mn-MN')}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <RoleBadge role={inv.role} />
                            {isOwner && (
                              <button
                                type="button"
                                disabled={Boolean(mutation)}
                                onClick={() => void revokeInvitation(inv.id, inv.email)}
                                className="admin-remove-btn"
                                style={{ padding: '4px 10px', fontSize: '11px' }}
                              >
                                {mutation === 'revoke' ? 'Цуцалж байна…' : 'Цуцлах'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '12px', color: 'var(--ink-muted, #74857b)', margin: '6px 0 0' }}>
                      Одоогоор хүлээгдэж буй идэвхтэй урилга алга байна.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FamiliesPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: '64px', textAlign: 'center', color: '#74857b' }}>
          Гэр бүлүүдийг ачаалж байна…
        </div>
      }
    >
      <FamiliesContent />
    </Suspense>
  );
}
