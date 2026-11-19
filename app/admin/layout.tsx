import { ReactNode, Suspense } from 'react';
import { AdminProvider, AdminShell } from '../../components/admin/admin-shell';
import './admin.css';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="admin-console-loading">
          <div className="admin-trash-empty">🏛️ Админы удирдлагын төвийг ачаалж байна…</div>
        </div>
      }
    >
      <AdminProvider>
        <AdminShell>{children}</AdminShell>
      </AdminProvider>
    </Suspense>
  );
}
