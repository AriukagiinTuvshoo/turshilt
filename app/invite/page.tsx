'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, Family } from '../../lib/api';
import { Mail, Shield, UserPlus, Check, Copy, ArrowLeft, QrCode } from 'lucide-react';

export default function InvitePage() {
  const router = useRouter();
  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [token, setToken] = useState('');
  const [issued, setIssued] = useState<{ id: string; email: string; role?: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const fid = params.get('family') ?? '';
    const invitationToken = hashParams.get('token') ?? '';
    setFamilyId(fid);
    setToken(invitationToken);
    if (fid) {
      api<Family>(`/families/${fid}`)
        .then(setFamily)
        .catch((cause) => setError(cause instanceof Error ? cause.message : 'Гэр бүлийг ачаалж чадсангүй.'));
    }
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const email = String(form.get('email') ?? '').trim();
    const role = String(form.get('role') ?? 'member');
    try {
      const result = await api<{ id: string; email: string; role: string; expires_at: string }>(
        `/families/${familyId}/invitations`,
        {
          method: 'POST',
          body: JSON.stringify({ email, role }),
        },
      );
      setIssued({ id: result.id, email: result.email, role: result.role });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Урилга үүсгэж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ family_id: string }>('/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setDone(true);
      router.replace(`/tree?family=${result.family_id}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setError('Урилгыг хүлээн авахын тулд бүртгэлдээ нэвтэрнэ үү.');
      } else {
        setError(cause instanceof Error ? cause.message : 'Урилгыг хүлээн авч чадсангүй.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!issued) return;
    setBusy(true);
    setError('');
    try {
      await api<void>(`/families/${familyId}/invitations/${issued.id}`, { method: 'DELETE' });
      setIssued(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Урилгыг цуцалж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  const copyShareLink = async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const shareUrl = `${origin}/invite?family=${encodeURIComponent(familyId)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      // Fallback
    }
  };

  return (
    <main className="invite-page" style={{ minHeight: '85vh', padding: '40px 20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <section className="card" style={{ maxWidth: 640, width: '100%', padding: '32px 28px', borderRadius: 20, boxShadow: '0 12px 36px rgba(0,0,0,0.06)' }}>
        <Link
          href={familyId ? `/dashboard?family=${encodeURIComponent(familyId)}` : '/families'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#d97706', textDecoration: 'none', marginBottom: 20 }}
        >
          <ArrowLeft size={16} /> {family?.name ? `${family.name} тойм руу буцах` : 'Гэр бүлүүд'}
        </Link>

        {token ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d97706', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>
              <Mail size={16} /> УРИЛГА ХҮЛЭЭН АВАХ
            </div>
            <h1 style={{ font: '700 28px Georgia, serif', margin: '8px 0 12px', color: '#1e293b' }}>
              Гэр бүлийн модонд нэгдэх урилга
            </h1>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              Урилгыг зөвхөн уригдсан баталгаажсан и-мэйл хаягаар нэвтрэн хүлээн авна.
            </p>

            {error && (
              <div className="error" role="alert" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: 13 }}>
                {error}
              </div>
            )}

            {done ? (
              <div className="success" style={{ padding: '12px 16px', borderRadius: 8, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', fontSize: 14, fontWeight: 600 }}>
                Урилгыг амжилттай хүлээн авлаа. Ургийн мод руу шилжиж байна…
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={accept}
                  style={{ minHeight: 42, padding: '0 24px', fontWeight: 700, borderRadius: 10 }}
                >
                  {busy ? 'Шалгаж байна…' : 'Урилгыг хүлээн авах'}
                </button>
                <Link
                  href={`/login#invite=${encodeURIComponent(token)}`}
                  className="button secondary"
                  style={{ minHeight: 42, padding: '0 18px', display: 'inline-flex', alignItems: 'center', borderRadius: 10 }}
                >
                  Нэвтрэх
                </Link>
                <Link
                  href={`/register#invite=${encodeURIComponent(token)}`}
                  className="button secondary"
                  style={{ minHeight: 42, padding: '0 18px', display: 'inline-flex', alignItems: 'center', borderRadius: 10 }}
                >
                  Бүртгүүлэх
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d97706', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>
              <UserPlus size={16} /> ГЭР БҮЛИЙН ГИШҮҮН УРИХ
            </div>
            <h1 style={{ font: '700 28px Georgia, serif', margin: '8px 0 8px', color: '#1e293b' }}>
              {family?.name ? `${family.name} ургийн бичигт урих` : 'Гэр бүлийн гишүүн урих'}
            </h1>
            <p style={{ color: '#64748b', fontSize: 13.5, lineHeight: 1.6, marginBottom: 24 }}>
              Ах дүү, төрөл төрөгсдөө өөрийн гэр бүлийн модонд урьж хамтран хөтлөх боломжтой. Холбоос 7 хоног хүчинтэй.
            </p>

            {error && (
              <div className="error" role="alert" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: 13 }}>
                {error}
              </div>
            )}

            <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Урих хүний имэйл хаяг
                </label>
                <input
                  name="email"
                  type="email"
                  maxLength={320}
                  required
                  placeholder="bat@example.com"
                  style={{ width: '100%', minHeight: 42, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Олгох эрх
                </label>
                <select
                  name="role"
                  defaultValue="member"
                  style={{ width: '100%', minHeight: 42, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, background: '#ffffff' }}
                >
                  <option value="member">Гишүүн (Зөвхөн өөрийн нэмсэн хүн, дурсамжаа засах)</option>
                  <option value="editor">Засварлагч / Админ (Бүх хүний мэдээллийг удирдах)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy}
                  style={{ flex: 1, minHeight: 42, fontWeight: 700, borderRadius: 10, background: 'linear-gradient(135deg, #d97706, #b45309)', color: '#ffffff', border: 'none' }}
                >
                  {busy ? 'Илгээж байна…' : 'Урилга илгээх'}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={copyShareLink}
                  title="Гэр бүлийн хуудасны холбоосыг хуулах"
                  style={{ minHeight: 42, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 10 }}
                >
                  {copied ? <Check size={16} color="#16a34a" /> : <Copy size={16} />}
                  {copied ? 'Хуулагдлаа' : 'Холбоос хуулах'}
                </button>
              </div>
            </form>

            {issued && (
              <div className="card" style={{ marginTop: 24, padding: 20, borderRadius: 14, background: '#fefce8', border: '1.5px solid #fde047' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, font: '700 16px Georgia, serif', color: '#854d0e', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Shield size={16} /> Урилга амжилттай үүсгэгдлээ
                  </h3>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={revoke}
                    style={{ background: 'transparent', border: 'none', color: '#b91c1c', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Цуцлах
                  </button>
                </div>
                <p style={{ margin: '8px 0 0', color: '#713f12', fontSize: 13 }}>
                  <strong>{issued.email}</strong> хаяг руу <strong>{issued.role === 'editor' ? 'Засварлагч' : 'Гишүүн'}</strong> эрхтэй 7 хоногийн хүчинтэй урилга илгээв.
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
