'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  X,
  Sparkles,
  TreeDeciduous,
  UserCheck,
  Heart,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Users,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Lock,
} from 'lucide-react';
import { ApiError, api, Person, Marriage, personName } from '../lib/api';

export type RelativeRole = 'father' | 'mother' | 'spouse' | 'son' | 'daughter' | 'sibling' | 'standalone';

export type WizardPersonItem = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  nickname?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  is_alive?: boolean;
  death_date?: string | null;
  lineage_name?: string | null;
};

function formatPersonName(p: WizardPersonItem): string {
  if (p.middle_name) {
    return `${p.last_name} ${p.middle_name} ${p.first_name}`.trim();
  }
  return [p.last_name, p.first_name].filter(Boolean).join(' ').trim() || 'Тодорхойгүй';
}

export interface PedigreeWizardModalProps {
  familyId: string;
  people: WizardPersonItem[];
  marriages?: Marriage[];
  parentChildEdges?: { parent_id: string; child_id: string }[];
  initialAnchorPersonId?: string | null;
  initialRole?: RelativeRole;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newPerson: Person, message: string) => void;
}

export function PedigreeWizardModal({
  familyId,
  people,
  marriages = [],
  parentChildEdges = [],
  initialAnchorPersonId = null,
  initialRole = 'son',
  isOpen,
  onClose,
  onSuccess,
}: PedigreeWizardModalProps) {
  const [anchorPersonId, setAnchorPersonId] = useState<string>('');
  const [role, setRole] = useState<RelativeRole>(initialRole);
  const [coParentId, setCoParentId] = useState<string>('');

  // Form Fields
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [birthDate, setBirthDate] = useState('');
  const [isAlive, setIsAlive] = useState(true);
  const [deathDate, setDeathDate] = useState('');
  const [lineageName, setLineageName] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Initialize Anchor & Role
  useEffect(() => {
    if (!isOpen) return;
    setError('');
    const defaultAnchor =
      initialAnchorPersonId && people.some((p) => p.id === initialAnchorPersonId)
        ? initialAnchorPersonId
        : people[0]?.id || '';
    setAnchorPersonId(defaultAnchor);
    setRole(initialRole);
  }, [isOpen, initialAnchorPersonId, initialRole, people]);

  const anchorPerson = useMemo(() => {
    return people.find((p) => p.id === anchorPersonId) ?? null;
  }, [people, anchorPersonId]);

  // Find candidate co-parents (spouses of anchor)
  const candidateCoParents = useMemo(() => {
    if (!anchorPersonId) return [];
    const spouseIds = new Set<string>();
    for (const m of marriages) {
      if (m.person_1_id === anchorPersonId) spouseIds.add(m.person_2_id);
      if (m.person_2_id === anchorPersonId) spouseIds.add(m.person_1_id);
    }
    return people.filter((p) => spouseIds.has(p.id));
  }, [anchorPersonId, marriages, people]);

  // Adjust defaults when role or anchor changes
  useEffect(() => {
    if (!anchorPerson) return;

    if (role === 'father') {
      setGender('male');
      setLastName(anchorPerson.last_name || '');
      setLineageName(anchorPerson.lineage_name || anchorPerson.nickname || '');
    } else if (role === 'mother') {
      setGender('female');
      setLineageName('');
    } else if (role === 'spouse') {
      setGender(anchorPerson.gender === 'male' ? 'female' : 'male');
    } else if (role === 'son') {
      setGender('male');
      setLastName(anchorPerson.gender === 'male' ? anchorPerson.last_name : '');
      setLineageName(anchorPerson.lineage_name || anchorPerson.nickname || '');
      if (candidateCoParents.length === 1 && candidateCoParents[0]) {
        setCoParentId(candidateCoParents[0].id);
      }
    } else if (role === 'daughter') {
      setGender('female');
      setLastName(anchorPerson.gender === 'male' ? anchorPerson.last_name : '');
      setLineageName(anchorPerson.lineage_name || anchorPerson.nickname || '');
      if (candidateCoParents.length === 1 && candidateCoParents[0]) {
        setCoParentId(candidateCoParents[0].id);
      }
    } else if (role === 'sibling') {
      setLastName(anchorPerson.last_name || '');
      setLineageName(anchorPerson.lineage_name || anchorPerson.nickname || '');
    }
  }, [role, anchorPerson, candidateCoParents]);

  // Heuristic Temporal & Biological Validation
  const validationWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!anchorPerson || !birthDate || role === 'standalone') return warnings;

    const anchorYear = anchorPerson.birth_date ? parseInt(anchorPerson.birth_date.slice(0, 4), 10) : null;
    const newYear = parseInt(birthDate.slice(0, 4), 10);

    if (anchorYear && newYear && !isNaN(anchorYear) && !isNaN(newYear)) {
      if (role === 'father' || role === 'mother') {
        if (newYear >= anchorYear) {
          warnings.push(`Эцэг/эх нь хүүхдээсээ залуу эсвэл ижил онд (${newYear} vs ${anchorYear}) төрсөн байж болохгүй.`);
        } else if (anchorYear - newYear < 14) {
          warnings.push(`Эцэг/эх ба хүүхдийн насны зөрүү хэт ойрхон (${anchorYear - newYear} жил) байна.`);
        } else if (anchorYear - newYear > 75) {
          warnings.push(`Эцэг/эх ба хүүхдийн насны зөрүү хэт хол (${anchorYear - newYear} жил) байна.`);
        }
      } else if (role === 'son' || role === 'daughter') {
        if (newYear <= anchorYear) {
          warnings.push(`Хүүхэд нь эцэг/эхээсээ өмнө эсвэл ижил онд (${newYear} vs ${anchorYear}) төрсөн байж болохгүй.`);
        } else if (newYear - anchorYear < 14) {
          warnings.push(`Эцэг/эх ба хүүхдийн насны зөрүү хэт бага (${newYear - anchorYear} жил) байна.`);
        }
      }
    }

    if (!isAlive && deathDate && birthDate) {
      const bY = parseInt(birthDate.slice(0, 4), 10);
      const dY = parseInt(deathDate.slice(0, 4), 10);
      if (bY && dY && dY < bY) {
        warnings.push(`Нас барсан он (${dY}) нь төрсөн оноос (${bY}) өмнө байж болохгүй.`);
      }
    }

    return warnings;
  }, [anchorPerson, birthDate, role, isAlive, deathDate]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError('Овог болон нэрийг заавал гүйцэд оруулна уу.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      // 1. Create Person
      const newPerson = await api<Person>(`/families/${familyId}/persons`, {
        method: 'POST',
        body: JSON.stringify({
          last_name: lastName.trim(),
          first_name: firstName.trim(),
          gender,
          birth_date: birthDate || null,
          is_alive: isAlive,
          death_date: !isAlive && deathDate ? deathDate : null,
          lineage_name: lineageName.trim() || null,
        }),
      });

      let relationSummary = '';

      // 2. Wire Relationships automatically
      if (anchorPerson && role !== 'standalone') {
        if (role === 'father' || role === 'mother') {
          // Parent-child: newPerson is parent of anchor
          await api(`/families/${familyId}/relationships/parent-child`, {
            method: 'POST',
            body: JSON.stringify({
              parent_id: newPerson.id,
              child_id: anchorPerson.id,
              relationship_type: 'biological',
            }),
          });
          relationSummary = `${formatPersonName(anchorPerson)}-ийн ${role === 'father' ? 'эцэг' : 'эх'}-ээр холбогдлоо.`;
        } else if (role === 'spouse') {
          // Marriage between anchor and newPerson
          await api<Marriage>(`/families/${familyId}/marriages`, {
            method: 'POST',
            body: JSON.stringify({
              person_1_id: anchorPerson.id,
              person_2_id: newPerson.id,
              status: 'married',
              start_date: null,
            }),
          });
          relationSummary = `${formatPersonName(anchorPerson)}-ийн ханиар гэрлэлт бүртгэгдлээ.`;
        } else if (role === 'son' || role === 'daughter') {
          // Parent-child: anchor is parent of newPerson
          await api(`/families/${familyId}/relationships/parent-child`, {
            method: 'POST',
            body: JSON.stringify({
              parent_id: anchorPerson.id,
              child_id: newPerson.id,
              relationship_type: 'biological',
            }),
          });

          // If co-parent selected, wire second parent too!
          if (coParentId && coParentId !== anchorPerson.id) {
            try {
              await api(`/families/${familyId}/relationships/parent-child`, {
                method: 'POST',
                body: JSON.stringify({
                  parent_id: coParentId,
                  child_id: newPerson.id,
                  relationship_type: 'biological',
                }),
              });
            } catch {
              // Gracefully handle if edge already existed
            }
          }
          relationSummary = `${formatPersonName(anchorPerson)}-ийн ${role === 'son' ? 'хүү' : 'охин'}-оор модонд зангилагдлаа.`;
        } else if (role === 'sibling') {
          // Sibling: find anchor's parents and link to newPerson
          const anchorParents = parentChildEdges
            .filter((edge) => edge.child_id === anchorPerson.id)
            .map((edge) => edge.parent_id);

          for (const pId of anchorParents) {
            try {
              await api(`/families/${familyId}/relationships/parent-child`, {
                method: 'POST',
                body: JSON.stringify({
                  parent_id: pId,
                  child_id: newPerson.id,
                  relationship_type: 'biological',
                }),
              });
            } catch {
              // ignore duplicate
            }
          }
          relationSummary = `${formatPersonName(anchorPerson)}-ийн ах/дүүгээр эцэг эхтэй нь холбогдлоо.`;
        }
      } else {
        relationSummary = 'Анхдагч язгуур хүнээр бүртгэгдлээ.';
      }

      onSuccess(newPerson, `"${lastName} ${firstName}" амжилттай бүртгэгдэж, ${relationSummary}`);
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError('Ургийн холболт үүсгэхэд алдаа гарлаа. Дахин оролдоно уу.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        display: 'grid',
        placeItems: 'center',
        padding: '16px',
        background: 'rgba(7, 24, 18, 0.72)',
        backdropFilter: 'blur(6px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pedigree-wizard-title"
    >
      <div
        style={{
          width: 'min(660px, 100%)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--parchment-card, #fffdf9)',
          border: '1.5px solid var(--parchment-border, #e2d9c8)',
          borderRadius: '20px',
          boxShadow: '0 24px 70px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid var(--parchment-border, #e2d9c8)',
            background: 'var(--parchment-canvas, #f6f2e8)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(217, 119, 6, 0.15)',
                color: '#d97706',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TreeDeciduous size={20} />
            </div>
            <div>
              <h2 id="pedigree-wizard-title" style={{ font: '700 18px Georgia, serif', margin: 0, color: 'var(--ink-primary, #17372b)' }}>
                Ургийн шууд холболттой хүн нэмэх (Wizard)
              </h2>
              <small style={{ color: 'var(--ink-secondary, #485c53)', fontSize: '11.5px' }}>
                Хүнийг модон дээрх байршлаас нь шууд зангидан үүсгэх ухаалаг хөтөч
              </small>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: '1px solid var(--parchment-border, #e2d9c8)',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Error Message */}
          {error && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#b91c1c',
                fontSize: '12.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* SECTION 1: ANCHOR PERSON & RELATION ROLE */}
          <div
            style={{
              padding: '16px',
              borderRadius: '14px',
              background: 'var(--parchment-canvas, #f6f2e8)',
              border: '1px solid var(--parchment-border, #e2d9c8)',
            }}
          >
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b45309', display: 'block', marginBottom: '6px' }}>
                1. Тулгуур хүн (Anchor Person):
              </label>
              <select
                value={anchorPersonId}
                onChange={(e) => setAnchorPersonId(e.target.value)}
                disabled={loading}
                className="admin-role-select"
                style={{ width: '100%', height: '40px', fontSize: '13.5px', fontWeight: 600 }}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name} {p.first_name} {p.birth_date ? `(${p.birth_date.slice(0, 4)})` : ''} - {p.gender === 'female' ? 'Эмэгтэй' : 'Эрэгтэй'}
                  </option>
                ))}
              </select>
            </div>

            <label style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b45309', display: 'block', marginBottom: '8px' }}>
              2. Энэ хүний хэн болох вэ? (Харьцангуй үүрэг):
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
              {[
                { key: 'father', label: '👨‍🦳 Эцэг нэмэх', desc: 'Дээд үе (Эрэгтэй)' },
                { key: 'mother', label: '👵 Эх нэмэх', desc: 'Дээд үе (Эмэгтэй)' },
                { key: 'spouse', label: '💍 Хань нэмэх', desc: 'Гэрлэлтийн холбоо' },
                { key: 'son', label: '👦 Хүү нэмэх', desc: 'Үр сад (Эрэгтэй)' },
                { key: 'daughter', label: '👧 Охин нэмэх', desc: 'Үр сад (Эмэгтэй)' },
                { key: 'sibling', label: '🤝 Ах, дүү', desc: 'Зэрэгцээ үе' },
                { key: 'standalone', label: '⭐ Салангид язгуур', desc: 'Шинэ шугам' },
              ].map((item) => {
                const isSelected = role === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setRole(item.key as RelativeRole)}
                    disabled={loading}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      textAlign: 'left',
                      border: isSelected ? '2px solid #d97706' : '1px solid var(--parchment-border, #e2d9c8)',
                      background: isSelected ? 'rgba(217, 119, 6, 0.12)' : '#ffffff',
                      color: isSelected ? '#b45309' : 'var(--ink-primary, #17372b)',
                      cursor: 'pointer',
                      transition: 'all 0.14s ease',
                    }}
                  >
                    <strong style={{ display: 'block', fontSize: '12.5px' }}>{item.label}</strong>
                    <small style={{ fontSize: '10px', color: '#64748b' }}>{item.desc}</small>
                  </button>
                );
              })}
            </div>

            {/* Co-parent selector if adding son/daughter */}
            {(role === 'son' || role === 'daughter') && candidateCoParents.length > 0 && (
              <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed var(--parchment-border, #e2d9c8)' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-secondary, #485c53)' }}>
                  Хоёрдогч эцэг/эх (Хань) сонгох:
                </label>
                <select
                  value={coParentId}
                  onChange={(e) => setCoParentId(e.target.value)}
                  className="admin-role-select"
                  style={{ width: '100%', marginTop: '4px', height: '36px', fontSize: '12px' }}
                >
                  <option value="">-- Зөвхөн {anchorPerson ? formatPersonName(anchorPerson) : ''}-тэй холбох --</option>
                  {candidateCoParents.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.last_name} {sp.first_name} (Хань)
                    </option>
                  ))}
                </select>
                <small style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '3px' }}>
                  Хүүхэд нэгэн зэрэг хоёр эцэг эхтэйгээ модон дээр зөв салаалж зангидагдана.
                </small>
              </div>
            )}
          </div>

          {/* HEURISTIC VALIDATION WARNINGS */}
          {validationWarnings.length > 0 && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: '#b45309',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                <AlertTriangle size={15} /> Огнооны логик анхааруулга:
              </div>
              {validationWarnings.map((w, idx) => (
                <span key={idx} style={{ paddingLeft: '20px' }}>• {w}</span>
              ))}
            </div>
          )}

          {/* SECTION 2: NEW PERSON DETAILS */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b45309', display: 'block', marginBottom: '10px' }}>
              3. Шинэ хүний мэдээлэл:
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                Овог (Last Name) *
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Боржигон"
                  required
                  disabled={loading}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px', fontSize: '13px' }}
                />
              </label>

              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                Өөрийн нэр (First Name) *
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Батбаяр"
                  required
                  disabled={loading}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px', fontSize: '13px' }}
                />
              </label>

              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                Хүйс *
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as 'male' | 'female')}
                  disabled={loading || role === 'father' || role === 'mother'}
                  className="admin-role-select"
                  style={{ width: '100%', marginTop: '4px', height: '38px', fontSize: '13px' }}
                >
                  <option value="male">Эрэгтэй</option>
                  <option value="female">Эмэгтэй</option>
                </select>
              </label>

              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                Төрсөн огноо (YYYY эсвэл YYYY-MM-DD)
                <input
                  type="text"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  placeholder="1985-06-15"
                  disabled={loading}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px', fontSize: '13px' }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isAlive}
                  onChange={(e) => setIsAlive(e.target.checked)}
                  disabled={loading}
                  style={{ width: '18px', height: '18px', accentColor: '#d97706' }}
                />
                <span>{isAlive ? 'Амьд сэрүүн' : 'Тэнгэрт хальсан'}</span>
              </label>

              {!isAlive && (
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Нас барсан он / огноо:
                  <input
                    type="text"
                    value={deathDate}
                    onChange={(e) => setDeathDate(e.target.value)}
                    placeholder="2018"
                    disabled={loading}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px', fontSize: '13px' }}
                  />
                </label>
              )}

              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                Ургийн овог / Салбар:
                <input
                  type="text"
                  value={lineageName}
                  onChange={(e) => setLineageName(e.target.value)}
                  placeholder="Хиад Боржигон"
                  disabled={loading}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--parchment-border, #e2d9c8)', marginTop: '4px', fontSize: '13px' }}
                />
              </label>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
              paddingTop: '16px',
              borderTop: '1px solid var(--parchment-border, #e2d9c8)',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="homev2-button homev2-button--light"
              style={{ fontSize: '13px', padding: '9px 18px' }}
            >
              Болих
            </button>
            <button
              type="submit"
              disabled={loading}
              className="homev2-button homev2-button--primary"
              style={{
                fontSize: '13px',
                padding: '9px 24px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 700,
              }}
            >
              {loading ? (
                'Бүртгэж байна…'
              ) : (
                <>
                  <Sparkles size={16} /> Бүртгэж, Ургийн модонд зангидах
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
