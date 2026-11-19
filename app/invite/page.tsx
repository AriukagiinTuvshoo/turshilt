'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, Family } from '../../lib/api';
import { Mail, Shield, UserPlus, Check, Copy, ArrowLeft, Calendar, KeyRound } from 'lucide-react';

type InvitationPreview = {
  family_name: string;
  role: string;
  expires_at: string;
};

export default function InvitePage() {
  const router = useRouter();
  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [token, setToken] = useState('');
  const [issued, setIssued] = useState<{ id: string; email: string; role?: string } | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState('member');
  const [pastedCode, setPastedCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [acceptedFamilyId, setAcceptedFamilyId] = useState('');
  const [copied, setCopied] = useState(false);

  const inspectInvitation = useCallback(async (invitationToken: string) => {
    const trimmed = invitationToken.trim();
    if (!trimmed) return;
    setPreviewBusy(true);
    setError('');
    try {
      const data = await api<InvitationPreview>('/invitations/preview', {
        method: 'POST',
        body: JSON.stringify({ token: trimmed }),
      });
      setPreview(data);
    } catch (cause) {
      setPreview(null);
      if (cause instanceof ApiError && cause.status === 401) {
        setError('Урилгын гэр бүл, эрхийг шалгахын тулд урьсан имэйл бүртгэлээрээ нэвтэрнэ үү.');
      } else {
        setError(cause instanceof Error ? cause.message : 'Урилгыг шалгаж чадсангүй.');
      }
    } finally {
      setPreviewBusy(false);
    }
  }, []);

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
    if (invitationToken) {
      void inspectInvitation(invitationToken);
    }
  }, [inspectInvitation]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const email = String(form.get('email') ?? '').trim();
    const role = String(form.get('role') ?? selectedRole);
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
      setAcceptedFamilyId(result.family_id);
      setDone(true);
      setToken('');
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/invite');
      }
      router.replace(`/tree?family=${encodeURIComponent(result.family_id)}`);
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

  function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = pastedCode.trim();
    if (!cleaned) return;
    setToken(cleaned);
    setPreview(null);
    void inspectInvitation(cleaned);
  }

  return (
    <main className="invite-page" style={{ minHeight: '85vh', padding: '40px 20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <section className="card" style={{ maxWidth: 640, width: '100%', padding: '32px 28px', borderRadius: 20, boxShadow: '0 12px 36px rgba(0,0,0,0.06)' }}>
        <Link
          href={familyId ? `/dashboard?family=${encodeURIComponent(familyId)}` : '/families'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#d97706', textDecoration: 'none', marginBottom: 20 }}
        >
          <ArrowLeft size={16} /> {family?.name ? `${family.name} тойм руу буцах` : 'Гэр бүлүүд'}
        </Link>

        {done ? (
          <div>
            <div className="success" role="status" style={{ padding: '16px 18px', borderRadius: 12, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', fontSize: 14 }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Гэр бүлд амжилттай нэгдлээ</h2>
              {preview && (
                <p style={{ margin: '0 0 12px', fontSize: 13.5 }}>
                  {preview.family_name} · {preview.role === 'editor' ? 'Засварлагч' : 'Гишүүн'}
                </p>
              )}
              <p style={{ margin: 0, fontWeight: 600 }}>Ургийн мод руу шилжиж байна…</p>
              {acceptedFamilyId && (
                <Link
                  href={`/tree?family=${encodeURIComponent(acceptedFamilyId)}`}
                  className="button primary"
                  style={{ display: 'inline-flex', marginTop: 12, minHeight: 40, padding: '0 18px', alignItems: 'center', borderRadius: 10 }}
                >
                  Ургийн модыг нээх →
                </Link>
              )}
            </div>
          </div>
        ) : token ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d97706', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>
              <Mail size={16} /> УРИЛГА ХҮЛЭЭН АВАХ
            </div>
            <h1 style={{ font: '700 28px Georgia, serif', margin: '8px 0 12px', color: '#1e293b' }}>
              Гэр бүлийн модонд нэгдэх урилга
            </h1>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              Урилгыг зөвхөн уригдсан баталгаажсан имэйл хаягаар нэвтрэн хүлээн авна. Эхлээд гэр бүл болон олгох эрхээ нягтална уу.
            </p>

            {error && (
              <div className="error" role="alert" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: 13 }}>
                {error}
              </div>
            )}

            {previewBusy && !preview && (
              <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: 13.5 }}>
                Урилгын мэдээллийг шалгаж байна…
              </div>
            )}

            {preview && (
              <div
                className="card"
                style={{
                  marginBottom: 20,
                  padding: '18px 20px',
                  borderRadius: 14,
                  background: '#fffbeb',
                  border: '1.5px solid #fde68a',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <h2 style={{ margin: 0, font: '700 20px Georgia, serif', color: '#1e293b' }}>
                    {preview.family_name}
                  </h2>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: preview.role === 'editor' ? '#fef3c7' : '#e0f2fe',
                      color: preview.role === 'editor' ? '#92400e' : '#075985',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <Shield size={13} />
                    {preview.role === 'editor' ? 'Засварлагч' : 'Гишүүн'}
                  </span>
                </div>
                <p style={{ margin: '0 0 10px', color: '#475569', fontSize: 13.5, lineHeight: 1.55 }}>
                  {preview.role === 'editor'
                    ? 'Гэр бүлийн мэдээлэл нэмэх, засах эрхтэй. Эзэмшигч болон глобал админ эрх олгогдохгүй.'
                    : 'Гэр бүлийн зөвшөөрөгдсөн мэдээллийг үзэж, өөрийн дурсамжийг нэмэх эрхтэй.'}
                </p>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12.5 }}>
                  <Calendar size={14} />
                  Хүчинтэй хугацаа: {new Date(preview.expires_at).toLocaleDateString('mn-MN')}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {preview ? (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={accept}
                  style={{ minHeight: 42, padding: '0 24px', fontWeight: 700, borderRadius: 10 }}
                >
                  {busy ? 'Нэгдэж байна…' : 'Зөвшөөрч гэр бүлд нэгдэх'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="button primary"
                    disabled={previewBusy || busy}
                    onClick={() => void inspectInvitation(token)}
                    style={{ minHeight: 42, padding: '0 22px', fontWeight: 700, borderRadius: 10 }}
                  >
                    {previewBusy ? 'Шалгаж байна…' : 'Урилгын мэдээллийг шалгах'}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || previewBusy}
                    onClick={accept}
                    style={{ minHeight: 42, padding: '0 18px', fontWeight: 600, borderRadius: 10 }}
                  >
                    {busy ? 'Шалгаж байна…' : 'Шууд нэгдэх'}
                  </button>
                </>
              )}
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
          </div>
        ) : familyId ? (
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
                <label htmlFor="invite-email" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Урих хүний имэйл хаяг
                </label>
                <input
                  id="invite-email"
                  name="email"
                  type="email"
                  maxLength={320}
                  required
                  autoComplete="email"
                  placeholder="bat@example.com"
                  style={{ width: '100%', minHeight: 42, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14 }}
                />
              </div>

              <div>
                <label htmlFor="invite-role" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Олгох эрх
                </label>
                <select
                  id="invite-role"
                  name="role"
                  value={selectedRole}
                  onChange={(event) => setSelectedRole(event.target.value)}
                  aria-describedby="invitation-role-help"
                  style={{ width: '100%', minHeight: 42, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, background: '#ffffff' }}
                >
                  <option value="member">Гишүүн (Зөвхөн зөвшөөрөгдсөн мэдээлэл үзэх, дурсамж нэмэх)</option>
                  <option value="editor">Засварлагч / Админ (Гэр бүлийн мэдээлэл нэмэх, засах)</option>
                </select>
                <p id="invitation-role-help" style={{ margin: '6px 0 0', fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>
                  {selectedRole === 'editor'
                    ? 'Гэр бүлийн мэдээлэл нэмэх, засах боломж олгоно. Зөвхөн итгэлтэй хүнд сонгоно уу.'
                    : 'Зөвшөөрөгдсөн мэдээллийг үзэх болон өөрийн дурсамжийг нэмэх эрх.'}
                </p>
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
              <div className="card" role="status" style={{ marginTop: 24, padding: 20, borderRadius: 14, background: '#fefce8', border: '1.5px solid #fde047' }}>
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
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d97706', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>
              <KeyRound size={16} /> УРИЛГЫН КОД ШАЛГАХ
            </div>
            <h1 style={{ font: '700 28px Georgia, serif', margin: '8px 0 10px', color: '#1e293b' }}>
              Гэр бүлийн урилга
            </h1>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              Имэйлээр ирсэн урилгын холбоосыг нээнэ үү. Эсвэл урилгын нууц кодыг энд оруулан гэр бүл, эрхийг шалгаж болно.
            </p>

            {error && (
              <div className="error" role="alert" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: 13 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleCodeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label htmlFor="invite-code-input" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Урилгын код
                </label>
                <input
                  id="invite-code-input"
                  type="password"
                  value={pastedCode}
                  onChange={(event) => setPastedCode(event.target.value)}
                  minLength={32}
                  maxLength={128}
                  autoComplete="off"
                  required
                  placeholder="Имэйлээр ирсэн урилгын кодыг хуулж тавина уу"
                  style={{ width: '100%', minHeight: 42, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14 }}
                />
              </div>
              <button
                type="submit"
                className="button primary"
                disabled={previewBusy}
                style={{ minHeight: 42, padding: '0 22px', fontWeight: 700, borderRadius: 10 }}
              >
                {previewBusy ? 'Шалгаж байна…' : 'Кодыг шалгах'}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
