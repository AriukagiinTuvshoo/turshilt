'use client';

import Link from 'next/link';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  Sparkles,
  TreeDeciduous,
  X,
} from 'lucide-react';
import { ApiError, api, Family, FamilyAdminOverview } from '../../lib/api';
import { AdminPermissionKey, friendlyError, RoleBadge, roleLabel } from './admin-types';

type AdminNavItem = {
  key: 'overview' | 'admins' | 'people' | 'members' | 'content' | 'data';
  href: string;
  emoji: string;
  label: string;
  badgeCount?: (overview: FamilyAdminOverview | null) => number | null;
};

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { key: 'overview', href: '/admin', emoji: '🏛️', label: 'Ерөнхий төв' },
  {
    key: 'admins',
    href: '/admin/admins',
    emoji: '👑',
    label: 'Админ ба Эрх',
    badgeCount: (ov) => (ov ? ov.owner_count + ov.admin_count : null),
  },
  {
    key: 'people',
    href: '/admin/people',
    emoji: '🌳',
    label: 'Хүмүүс ба Ураг',
    badgeCount: (ov) => (ov ? ov.total_persons : null),
  },
  {
    key: 'members',
    href: '/admin/members',
    emoji: '👥',
    label: 'Гишүүд ба Урилга',
    badgeCount: (ov) => (ov ? ov.member_count : null),
  },
  {
    key: 'content',
    href: '/admin/content',
    emoji: '📜',
    label: 'Өв сан ба Санхүү',
    badgeCount: (ov) => (ov ? ov.total_stories + ov.total_memories + ov.total_archives : null),
  },
  {
    key: 'data',
    href: '/admin/data',
    emoji: '💾',
    label: 'Өгөгдөл ба Аудит',
    badgeCount: (ov) => (ov && ov.trash_count > 0 ? ov.trash_count : null),
  },
];

export type AdminContextValue = {
  families: Family[];
  selectedFamilyId: string;
  selectedFamily: Family | null;
  overview: FamilyAdminOverview | null;
  loading: boolean;
  overviewLoading: boolean;
  notice: string;
  error: string;
  setNotice: (msg: string) => void;
  setError: (msg: string) => void;
  switchFamily: (nextId: string) => void;
  refreshOverview: () => Promise<void>;
  reloadFamilies: () => Promise<void>;
  isOwner: boolean;
  isAdminRole: boolean;
  can: (perm: AdminPermissionKey) => boolean;
  withFamilyHref: (path: string) => string;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdminContext() {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    throw new Error('useAdminContext must be used inside AdminProvider');
  }
  return ctx;
}

export function AdminAccessNotice({
  title = 'Админ удирдлагын хэсэг',
  message = 'Энэ хэсэгт хандахын тулд танд гэр бүлийн Ерөнхий админ, Туслах админ эсвэл Засварлагчийн эрх шаардлагатай.',
}: {
  title?: string;
  message?: string;
}) {
  const { withFamilyHref } = useAdminContext();
  return (
    <div className="families-main-card admin-access-notice">
      <div className="admin-access-icon" aria-hidden="true">
        <Lock size={24} />
      </div>
      <h2>🔐 {title}</h2>
      <p>{message}</p>
      <div className="admin-access-actions">
        <Link href={withFamilyHref('/tree')} className="homev2-button homev2-button--primary">
          🌳 Ургийн мод руу буцах
        </Link>
        <Link href={withFamilyHref('/dashboard')} className="homev2-button homev2-button--light">
          🏠 Нүүр хуудас
        </Link>
      </div>
    </div>
  );
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedFamilyId = searchParams.get('family')?.trim() ?? '';

  const [families, setFamilies] = useState<Family[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [overview, setOverview] = useState<FamilyAdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const familySeq = useRef(0);
  const overviewSeq = useRef(0);
  const selectedFamilyRef = useRef('');

  useEffect(() => {
    selectedFamilyRef.current = selectedFamilyId;
  }, [selectedFamilyId]);

  const reloadFamilies = useCallback(async () => {
    const seq = ++familySeq.current;
    setLoading(true);
    setError('');
    try {
      const data = await api<Family[]>('/families');
      if (seq !== familySeq.current) return;
      setFamilies(data);
      const validExplicit = requestedFamilyId && data.some((f) => f.id === requestedFamilyId);
      if (validExplicit) {
        setSelectedFamilyId(requestedFamilyId);
      } else if (data[0]) {
        setSelectedFamilyId(data[0].id);
        router.replace(`${pathname}?family=${encodeURIComponent(data[0].id)}`);
      } else {
        setSelectedFamilyId('');
      }
    } catch (cause) {
      if (seq !== familySeq.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(friendlyError(cause, 'Гэр бүлийн орчныг ачаалж чадсангүй.'));
    } finally {
      if (seq === familySeq.current) setLoading(false);
    }
  }, [pathname, requestedFamilyId, router]);

  useEffect(() => {
    void reloadFamilies();
    return () => {
      familySeq.current += 1;
    };
  }, [reloadFamilies]);

  const selectedFamily = useMemo(
    () => families.find((f) => f.id === selectedFamilyId) ?? null,
    [families, selectedFamilyId],
  );

  const fetchOverview = useCallback(async (familyId: string, role?: string) => {
    const seq = ++overviewSeq.current;
    if (!familyId || role === 'member') {
      setOverview(null);
      setOverviewLoading(false);
      return;
    }
    setOverviewLoading(true);
    try {
      const data = await api<FamilyAdminOverview>(`/families/${familyId}/admin/overview`);
      if (seq !== overviewSeq.current || selectedFamilyRef.current !== familyId) return;
      setOverview(data);
    } catch (cause) {
      if (seq !== overviewSeq.current || selectedFamilyRef.current !== familyId) return;
      if (cause instanceof ApiError && cause.status === 403) {
        setOverview(null);
      } else {
        setError(friendlyError(cause, 'Админы ерөнхий мэдээллийг ачаалж чадсангүй.'));
      }
    } finally {
      if (seq === overviewSeq.current && selectedFamilyRef.current === familyId) {
        setOverviewLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedFamily) {
      setOverview(null);
      return;
    }
    void fetchOverview(selectedFamily.id, selectedFamily.role);
  }, [fetchOverview, selectedFamily]);

  const refreshOverview = useCallback(async () => {
    if (!selectedFamilyId) return;
    await fetchOverview(selectedFamilyId, selectedFamily?.role);
  }, [fetchOverview, selectedFamily?.role, selectedFamilyId]);

  const switchFamily = useCallback(
    (nextId: string) => {
      setSelectedFamilyId(nextId);
      setNotice('');
      setError('');
      const params = new URLSearchParams(searchParams.toString());
      params.set('family', nextId);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const isOwner = selectedFamily?.role === 'owner';
  const isAdminRole =
    selectedFamily?.role === 'owner' ||
    selectedFamily?.role === 'admin' ||
    selectedFamily?.role === 'editor';

  const can = useCallback(
    (perm: AdminPermissionKey) => {
      if (!selectedFamily) return false;
      if (selectedFamily.role === 'owner') return true;
      const perms = overview?.my_permissions ?? selectedFamily.permissions ?? [];
      return perms.includes(perm);
    },
    [overview?.my_permissions, selectedFamily],
  );

  const withFamilyHref = useCallback(
    (path: string) => {
      if (!selectedFamilyId) return path;
      return `${path}?family=${encodeURIComponent(selectedFamilyId)}`;
    },
    [selectedFamilyId],
  );

  const value: AdminContextValue = useMemo(
    () => ({
      families,
      selectedFamilyId,
      selectedFamily,
      overview,
      loading,
      overviewLoading,
      notice,
      error,
      setNotice,
      setError,
      switchFamily,
      refreshOverview,
      reloadFamilies,
      isOwner,
      isAdminRole,
      can,
      withFamilyHref,
    }),
    [
      families,
      selectedFamilyId,
      selectedFamily,
      overview,
      loading,
      overviewLoading,
      notice,
      error,
      switchFamily,
      refreshOverview,
      reloadFamilies,
      isOwner,
      isAdminRole,
      can,
      withFamilyHref,
    ],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    families,
    selectedFamilyId,
    selectedFamily,
    overview,
    loading,
    notice,
    error,
    setNotice,
    setError,
    switchFamily,
    isAdminRole,
    withFamilyHref,
  } = useAdminContext();

  return (
    <div className="families-page" aria-busy={loading}>
      <div className="families-shell admin-portal-shell">
        <header className="families-header admin-portal-header">
          <div className="admin-portal-heading">
            <div className="admin-header-badge-row">
              <span className="admin-header-kicker">
                <Sparkles size={13} />
                ГЭР БҮЛИЙН АДМИН ТӨВ
              </span>
              {selectedFamily && (
                <RoleBadge
                  role={selectedFamily.role}
                  adminTitle={overview?.my_admin_title ?? selectedFamily.admin_title}
                />
              )}
            </div>
            <h1>🏛️ Ургийн бичгийн удирдлага</h1>
            <p>
              Админ баг, хүмүүс, ургийн холбоо, өв сан, санхүү болон өгөгдөл шинэчлэлтийг тус тусад нь эмх цэгцтэй удирдах орчин.
            </p>
          </div>

          <div className="admin-header-actions">
            {selectedFamily && (
              <Link
                href={withFamilyHref('/tree')}
                className="homev2-button homev2-button--primary admin-btn-tree-link"
              >
                <TreeDeciduous size={15} /> 🌳 Ургийн мод руу очих →
              </Link>
            )}
          </div>
        </header>

        {notice && (
          <div className="admin-alert-notice" role="status">
            <div className="admin-alert-inner">
              <CheckCircle2 size={18} />
              <span>{notice}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice('')}
              className="admin-icon-close"
              aria-label="Мэдэгдэл хаах"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {error && (
          <div className="admin-alert-error" role="alert">
            <div className="admin-alert-inner">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError('')}
              className="admin-icon-close"
              aria-label="Алдаа хаах"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <section className="admin-master-bar" aria-label="Админ хуудсуудын чиглүүлэгч">
          <div className="admin-family-selector-wrap">
            <label htmlFor="admin-active-family" className="admin-family-selector-label">
              🏡 Идэвхтэй гэр бүл:
            </label>
            <select
              id="admin-active-family"
              value={selectedFamilyId}
              onChange={(e) => switchFamily(e.target.value)}
              className="admin-role-select admin-family-select"
              disabled={!families.length}
            >
              {!families.length && <option value="">Гэр бүл олдсонгүй</option>}
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({roleLabel(f.role, f.admin_title)})
                </option>
              ))}
            </select>
          </div>

          <nav className="admin-nav-grid" aria-label="Админы тусдаа хуудсууд">
            {ADMIN_NAV_ITEMS.map((item) => {
              const isActive =
                item.href === '/admin'
                  ? pathname === '/admin'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const count = item.badgeCount ? item.badgeCount(overview) : null;
              return (
                <Link
                  key={item.key}
                  href={withFamilyHref(item.href)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`admin-nav-pill ${isActive ? 'is-active' : ''}`}
                >
                  <span aria-hidden="true">{item.emoji}</span>
                  <span>{item.label}</span>
                  {typeof count === 'number' && (
                    <span className="admin-nav-pill-count">{count}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </section>

        {!loading && families.length === 0 ? (
          <div className="families-main-card admin-access-notice">
            <h2>🌱 Танд удирдах гэр бүл хараахан алга</h2>
            <p>Эхлээд гэр бүлийн орчноо үүсгээд ургийн бичгээ эхлүүлээрэй.</p>
            <div className="admin-access-actions">
              <Link href="/families" className="homev2-button homev2-button--primary">
                🏡 Гэр бүл үүсгэх
              </Link>
            </div>
          </div>
        ) : !loading && selectedFamily && !isAdminRole ? (
          <AdminAccessNotice />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
