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
  ArrowLeft,
  CheckCircle2,
  Lock,
  LogOut,
  Menu,
  TreeDeciduous,
  X,
} from 'lucide-react';
import { ApiError, api, Family, FamilyAdminOverview, User } from '../../lib/api';
import { ThemePicker } from '../theme-picker';
import { AdminPermissionKey, friendlyError, RoleBadge, roleLabel } from './admin-types';

type AdminNavItem = {
  key: 'overview' | 'admins' | 'people' | 'members' | 'content' | 'data';
  group: 'УДИРДЛАГА' | 'УРГИЙН САН' | 'СИСТЕМ';
  href: string;
  emoji: string;
  label: string;
  subtitle: string;
  badgeCount?: (overview: FamilyAdminOverview | null) => number | null;
};

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    key: 'overview',
    group: 'УДИРДЛАГА',
    href: '/admin',
    emoji: '🏛️',
    label: 'Ерөнхий төв',
    subtitle: 'Нэгдсэн хяналт & Эрүүл мэнд',
  },
  {
    key: 'admins',
    group: 'УДИРДЛАГА',
    href: '/admin/admins',
    emoji: '👑',
    label: 'Админ ба Эрх',
    subtitle: 'Туслах админ томилох & үүрэг',
    badgeCount: (ov) => (ov ? ov.owner_count + ov.admin_count : null),
  },
  {
    key: 'people',
    group: 'УРГИЙН САН',
    href: '/admin/people',
    emoji: '🌳',
    label: 'Хүмүүс ба Ураг',
    subtitle: 'Хүмүүс, ураг ба удам салаа',
    badgeCount: (ov) => (ov ? ov.total_persons : null),
  },
  {
    key: 'members',
    group: 'УРГИЙН САН',
    href: '/admin/members',
    emoji: '👥',
    label: 'Гишүүд ба Урилга',
    subtitle: 'Account холбох & урилгууд',
    badgeCount: (ov) => (ov ? ov.member_count : null),
  },
  {
    key: 'content',
    group: 'УРГИЙН САН',
    href: '/admin/content',
    emoji: '📜',
    label: 'Өв сан ба Санхүү',
    subtitle: 'Түүх, дурсамж, архив, сан',
    badgeCount: (ov) => (ov ? ov.total_stories + ov.total_memories + ov.total_archives : null),
  },
  {
    key: 'data',
    group: 'СИСТЕМ',
    href: '/admin/data',
    emoji: '💾',
    label: 'Өгөгдөл ба Аудит',
    subtitle: 'Дата шинэчлэл, хогийн сав, түүх',
    badgeCount: (ov) => (ov && ov.trash_count > 0 ? ov.trash_count : null),
  },
];

const NAV_GROUPS: AdminNavItem['group'][] = ['УДИРДЛАГА', 'УРГИЙН САН', 'СИСТЕМ'];

export type AdminContextValue = {
  user: User | null;
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
  logout: () => Promise<void>;
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
  message = 'Энэ хэсэгт хандахын тулд танд Ерөнхий админ, Туслах админ эсвэл Засварлагчийн эрх шаардлагатай.',
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
          🏠 Үндсэн сайт руу буцах
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

  const [user, setUser] = useState<User | null>(null);
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
      const [me, data] = await Promise.all([api<User>('/auth/me'), api<Family[]>('/families')]);
      if (seq !== familySeq.current) return;
      setUser(me);
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
      setError(friendlyError(cause, 'Админы орчныг ачаалж чадсангүй.'));
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

  const logout = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
    }
  }, [router]);

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
      user,
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
      logout,
      isOwner,
      isAdminRole,
      can,
      withFamilyHref,
    }),
    [
      user,
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
      logout,
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
    user,
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
    logout,
    isAdminRole,
    withFamilyHref,
  } = useAdminContext();

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileDrawerOpen(false);
        window.setTimeout(() => menuBtnRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [mobileDrawerOpen]);

  const currentNav =
    ADMIN_NAV_ITEMS.find((item) =>
      item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href),
    ) ?? ADMIN_NAV_ITEMS[0];

  const handleLogout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logout();
    } catch {
      setLogoutBusy(false);
    }
  };

  return (
    <div className="admin-console" aria-busy={loading}>
      <button
        type="button"
        aria-label="Админ цэс хаах"
        tabIndex={mobileDrawerOpen ? 0 : -1}
        className={`admin-sidebar-overlay ${mobileDrawerOpen ? 'is-open' : ''}`}
        onClick={() => setMobileDrawerOpen(false)}
      />

      <aside
        id="admin-console-sidebar"
        className={`admin-sidebar ${mobileDrawerOpen ? 'is-open' : ''}`}
        aria-label="Админы удирдлагын навигаци"
      >
        <div className="admin-sidebar-brand">
          <div className="admin-sidebar-brand-row">
            <div className="admin-sidebar-emblem" aria-hidden="true">
              🏛️
            </div>
            <div className="admin-sidebar-brand-copy">
              <strong>ГУУЛИНГИЙНХАН</strong>
              <small>АДМИНЫ УДИРДЛАГЫН ТӨВ</small>
            </div>
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(false)}
              className="admin-sidebar-close-btn"
              aria-label="Цэс хаах"
            >
              <X size={18} />
            </button>
          </div>
          {selectedFamily && (
            <div className="admin-sidebar-role-wrap">
              <RoleBadge
                role={selectedFamily.role}
                adminTitle={overview?.my_admin_title ?? selectedFamily.admin_title}
              />
            </div>
          )}
        </div>

        <div className="admin-sidebar-workspace">
          <label htmlFor="admin-active-family" className="admin-sidebar-ws-label">
            🏡 Идэвхтэй орон зай
          </label>
          <select
            id="admin-active-family"
            value={selectedFamilyId}
            onChange={(e) => switchFamily(e.target.value)}
            className="admin-role-select admin-sidebar-select"
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

        <nav className="admin-sidebar-nav" aria-label="Админы хэсгүүд">
          {NAV_GROUPS.map((group) => (
            <div key={group} className="admin-sidebar-group">
              <div className="admin-sidebar-group-title">{group}</div>
              {ADMIN_NAV_ITEMS.filter((item) => item.group === group).map((item) => {
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
                    className={`admin-sidebar-link ${isActive ? 'is-active' : ''}`}
                    onClick={() => setMobileDrawerOpen(false)}
                  >
                    <span className="admin-sidebar-link-emoji" aria-hidden="true">
                      {item.emoji}
                    </span>
                    <span className="admin-sidebar-link-text">
                      <strong>{item.label}</strong>
                      <small>{item.subtitle}</small>
                    </span>
                    {typeof count === 'number' && (
                      <span className="admin-sidebar-link-badge">{count}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          {overview && (
            <div className="admin-sidebar-ministats" aria-label="Хураангуй тоо">
              <span>🌳 {overview.total_persons} хүн</span>
              <span>🌿 {overview.generation_depth} үе</span>
              <span>👥 {overview.member_count} гишүүн</span>
            </div>
          )}
          <Link href={withFamilyHref('/dashboard')} className="admin-sidebar-back-btn">
            <ArrowLeft size={15} />
            <span>Үндсэн сайт руу буцах</span>
          </Link>
        </div>
      </aside>

      <div className="admin-main-wrap">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button
              ref={menuBtnRef}
              type="button"
              className="admin-topbar-menu-btn"
              aria-label={mobileDrawerOpen ? 'Админ цэс хаах' : 'Админ цэс нээх'}
              aria-expanded={mobileDrawerOpen}
              aria-controls="admin-console-sidebar"
              onClick={() => setMobileDrawerOpen((v) => !v)}
            >
              <Menu size={20} />
            </button>
            <div className="admin-topbar-crumb">
              <strong>
                {currentNav.emoji} {currentNav.label}
              </strong>
              {selectedFamily && (
                <span className="admin-topbar-family-pill">🏡 {selectedFamily.name}</span>
              )}
            </div>
          </div>

          <div className="admin-topbar-actions">
            {selectedFamily && (
              <Link
                href={withFamilyHref('/tree')}
                className="homev2-button homev2-button--primary admin-btn-tree-link"
              >
                <TreeDeciduous size={15} />
                <span className="admin-hide-xs">Ургийн мод</span>
                <span className="admin-show-xs">Мод</span>
              </Link>
            )}
            <Link
              href={withFamilyHref('/dashboard')}
              className="homev2-button homev2-button--light admin-btn-site-link"
            >
              ← Сайт руу
            </Link>
            <ThemePicker />
            {user && (
              <div className="admin-user-pill" title={user.email ?? user.display_name}>
                <span className="admin-user-avatar" aria-hidden="true">
                  {(user.display_name?.trim().slice(0, 1) || '?').toUpperCase()}
                </span>
                <span className="admin-user-name">{user.display_name}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={logoutBusy}
              className="admin-logout-btn"
              aria-label="Системээс гарах"
              title="Гарах"
            >
              <LogOut size={15} />
              <span className="admin-hide-sm">{logoutBusy ? 'Гарч байна…' : 'Гарах'}</span>
            </button>
          </div>
        </header>

        <main className="admin-canvas">
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

          {!loading && families.length === 0 ? (
            <div className="families-main-card admin-access-notice">
              <h2>🌱 Танд удирдах гэр бүл / өрх хараахан алга</h2>
              <p>Эхлээд өөрийн өрх эсвэл ургийн модоо үүсгээд бүртгэлээ эхлүүлээрэй.</p>
              <div className="admin-access-actions">
                <Link href="/families" className="homev2-button homev2-button--primary">
                  🏡 Ураг ба Миний өрх үүсгэх
                </Link>
              </div>
            </div>
          ) : !loading && selectedFamily && !isAdminRole ? (
            <AdminAccessNotice />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
