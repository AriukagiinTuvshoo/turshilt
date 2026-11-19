'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, AdminDataRefreshResult } from '../../lib/api';
import { useAdminContext } from '../../components/admin/admin-shell';
import { friendlyError, RoleBadge } from '../../components/admin/admin-types';

function computeHealthPercent(opts: {
  totalPersons: number;
  missingBirth: number;
  missingGender: number;
  isolated: number;
  unlinkedMembers: number;
  memberCount: number;
}) {
  if (opts.totalPersons === 0) return 100;
  const totalChecks = opts.totalPersons * 3 + Math.max(opts.memberCount, 1);
  const penalties =
    opts.missingBirth +
    opts.missingGender +
    opts.isolated +
    Math.min(opts.unlinkedMembers, opts.memberCount);
  const ratio = Math.max(0, Math.min(1, 1 - penalties / Math.max(totalChecks, 1)));
  return Math.round(ratio * 100);
}

export default function AdminCockpitPage() {
  const {
    selectedFamilyId,
    selectedFamily,
    overview,
    overviewLoading,
    setNotice,
    setError,
    refreshOverview,
    can,
    withFamilyHref,
  } = useAdminContext();

  const [refreshBusy, setRefreshBusy] = useState(false);

  const handleQuickReindex = async () => {
    if (!selectedFamilyId || refreshBusy) return;
    setRefreshBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api<AdminDataRefreshResult>(
        `/families/${selectedFamilyId}/admin/reindex-data`,
        { method: 'POST' },
      );
      setNotice(
        `🔄 Өгөгдөл шинэчлэгдлээ: ${res.refreshed_persons} хүний нэр ба хайлтын индекс цэгцэлж, ${res.pruned_trash} хугацаа дууссан бүртгэлийг цэвэрлэлээ.`,
      );
      await refreshOverview();
    } catch (cause) {
      setError(friendlyError(cause, 'Өгөгдөл шинэчлэх үед алдаа гарлаа.'));
    } finally {
      setRefreshBusy(false);
    }
  };

  if (overviewLoading && !overview) {
    return (
      <div className="families-main-card">
        <div className="admin-trash-empty">🏛️ Админы ерөнхий самбарыг ачаалж байна…</div>
      </div>
    );
  }

  if (!selectedFamily || !overview) {
    return null;
  }

  const healthScore = computeHealthPercent({
    totalPersons: overview.total_persons,
    missingBirth: overview.missing_birth_date_count,
    missingGender: overview.missing_gender_count,
    isolated: overview.isolated_persons_count,
    unlinkedMembers: overview.unlinked_members_count,
    memberCount: overview.member_count,
  });

  const attentionItems = [
    overview.missing_birth_date_count > 0 && {
      key: 'birth',
      emoji: '🎂',
      text: `Төрсөн огноо дутуу: ${overview.missing_birth_date_count} хүн`,
      href: withFamilyHref('/admin/people'),
    },
    overview.missing_gender_count > 0 && {
      key: 'gender',
      emoji: '❓',
      text: `Хүйс тодорхойгүй: ${overview.missing_gender_count} хүн`,
      href: withFamilyHref('/admin/people'),
    },
    overview.isolated_persons_count > 0 && {
      key: 'isolated',
      emoji: '🔗',
      text: `Ургийн холбоосгүй: ${overview.isolated_persons_count} хүн`,
      href: withFamilyHref('/admin/people'),
    },
    overview.unlinked_members_count > 0 && {
      key: 'unlinked',
      emoji: '👤',
      text: `Модонд холбогдоогүй гишүүн: ${overview.unlinked_members_count}`,
      href: withFamilyHref('/admin/members'),
    },
    overview.trash_count > 0 && {
      key: 'trash',
      emoji: '🗑️',
      text: `Хогийн саванд: ${overview.trash_count}`,
      href: withFamilyHref('/admin/data'),
    },
  ].filter(Boolean) as { key: string; emoji: string; text: string; href: string }[];

  const moduleCards = [
    {
      href: withFamilyHref('/admin/admins'),
      emoji: '👑',
      stat: `${overview.owner_count + overview.admin_count} админ`,
      title: 'Админ ба Туслах үүрэг',
      description:
        'Ерөнхий админ нэмэлт туслах админ томилох, үүргийн нэр ба нарийвчилсан эрх олгох/хасах.',
      cta: 'Админ удирдах →',
    },
    {
      href: withFamilyHref('/admin/people'),
      emoji: '🌳',
      stat: `${overview.total_persons} хүн · ${overview.generation_depth} үе`,
      title: 'Хүмүүс, Ураг & Удам салаа',
      description:
        'Хүн нэмэх/засах, дутуу дата шүүлтүүр, давхардал нэгтгэх, эцэг-эх/гэрлэлт ба удам угсаа.',
      cta: 'Хүмүүс ба ураг →',
    },
    {
      href: withFamilyHref('/admin/members'),
      emoji: '👥',
      stat: `${overview.member_count} гишүүн · ${overview.pending_invitations_count} урилга`,
      title: 'Гишүүд, Мод холболт & Урилга',
      description:
        'Хэрэглэгчдийг модон дахь хүнтэй холбох, имэйл урилга илгээх, хүлээгдэж буй урилга хянах.',
      cta: 'Гишүүд ба урилга →',
    },
    {
      href: withFamilyHref('/admin/content'),
      emoji: '📜',
      stat: `${overview.total_stories + overview.total_memories + overview.total_archives} бүртгэл`,
      title: 'Өв сан, Архив & Санхүү',
      description: `Түүх (${overview.total_stories}), дурсамж (${overview.total_memories}), архив (${overview.total_archives}), ургийн батламж, сан (${overview.net_balance_minor.toLocaleString('mn-MN')} ₮).`,
      cta: 'Өв сан ба санхүү →',
    },
    {
      href: withFamilyHref('/admin/data'),
      emoji: '💾',
      stat: `${overview.trash_count} хогийн сав`,
      title: 'Өгөгдөл шинэчлэл, Хогийн сав & Аудит',
      description:
        '1 дарж дата & хайлтын индекс шинэчлэх, хогийн савнаас сэргээх, үйлдлийн түүх ба ерөнхий тохиргоо.',
      cta: 'Өгөгдөл ба аудит →',
    },
  ];

  return (
    <div className="admin-section-stack">
      <section className="families-main-card admin-cockpit-hero">
        <div className="admin-cockpit-intro">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <RoleBadge role={overview.my_role} adminTitle={overview.my_admin_title} />
            <span className="admin-pill-neutral">🏡 {overview.family_name}</span>
          </div>
          <h2>✨ {overview.family_name} — Админы Ерөнхий Төв</h2>
          <p>Ургийн бүртгэл, гишүүд, өв сан болон өгөгдлийн нэгдсэн удирдлагын төв.</p>
        </div>

        <div className="admin-health-box">
          <div className="admin-health-head">
            <span>🩺 Өгөгдлийн эрүүл мэнд</span>
            <strong>{healthScore}%</strong>
          </div>
          <div className="admin-health-track" role="progressbar" aria-valuenow={healthScore} aria-valuemin={0} aria-valuemax={100}>
            <div className="admin-health-fill" style={{ width: `${healthScore}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <small className="admin-muted-text">
              🌱 {overview.living_count} энх тунх · 🕊️ {overview.deceased_count}
            </small>
            {can('manage_data') && (
              <button
                type="button"
                onClick={() => void handleQuickReindex()}
                disabled={refreshBusy}
                className="admin-action-accent-btn"
              >
                <RefreshCw size={13} className={refreshBusy ? 'animate-spin' : ''} />
                {refreshBusy ? 'Шинэчилж байна…' : '🔄 Дата шинэчлэх'}
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="admin-attention-row" aria-label="Анхаарах шаардлагатай бүртгэлүүд">
        {attentionItems.length > 0 ? (
          attentionItems.map((item) => (
            <Link key={item.key} href={item.href} className="admin-attention-chip">
              <span>{item.emoji}</span>
              <span>{item.text} →</span>
            </Link>
          ))
        ) : (
          <div className="admin-attention-chip is-healthy">
            <span>✨</span>
            <span>Бүх хүний мэдээлэл ба холбоосууд бүрэн цэмцгэр байна!</span>
          </div>
        )}
      </div>

      <div className="admin-kpi-grid">
        <div className="admin-kpi-box">
          <small>🌳 Ургийн нийт хүн</small>
          <strong>{overview.total_persons}</strong>
        </div>
        <div className="admin-kpi-box">
          <small>🌿 Ургийн үеийн гүн</small>
          <strong>{overview.generation_depth} үе</strong>
        </div>
        <div className="admin-kpi-box">
          <small>💍 Гэрлэлт / Эцэг-эх</small>
          <strong>{overview.marriage_count} / {overview.parent_child_count}</strong>
        </div>
        <div className="admin-kpi-box">
          <small>💰 Сангийн цэвэр үлдэгдэл</small>
          <strong>{overview.net_balance_minor.toLocaleString('mn-MN')} ₮</strong>
        </div>
        <div className="admin-kpi-box">
          <small>🎉 Ирэх уулзалт / Идэвхтэй сан</small>
          <strong>{overview.upcoming_events_count} / {overview.active_funds_count}</strong>
        </div>
      </div>

      <section className="admin-module-grid" aria-label="Тусгай удирдлагын хэсгүүд">
        {moduleCards.map((card) => (
          <Link key={card.href} href={card.href} className="admin-module-card">
            <div>
              <div className="admin-module-top">
                <div className="admin-module-emoji" aria-hidden="true">
                  {card.emoji}
                </div>
                <span className="admin-module-stat">{card.stat}</span>
              </div>
              <h3 style={{ marginTop: 14 }}>{card.title}</h3>
              <p>{card.description}</p>
            </div>
            <span className="admin-module-cta">{card.cta}</span>
          </Link>
        ))}

        <div className="admin-module-card">
          <div>
            <div className="admin-module-top">
              <div className="admin-module-emoji" aria-hidden="true">
                🚀
              </div>
              <span className="admin-module-stat">Шууд холбоос</span>
            </div>
            <h3 style={{ marginTop: 14 }}>Шууд шилжих орчнууд</h3>
            <p>
              Ургийн мод, гэр бүлийн сан болон бодит цагийн ярианы өрөө рүү шууд орж ажиллана уу.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href={withFamilyHref('/tree')}
              className="homev2-button homev2-button--light"
              style={{ fontSize: 11.5, padding: '6px 10px' }}
            >
              🌳 Удмын мод
            </Link>
            <Link
              href={withFamilyHref('/activities')}
              className="homev2-button homev2-button--light"
              style={{ fontSize: 11.5, padding: '6px 10px' }}
            >
              💰 Сан ба Уулзалт
            </Link>
            <Link
              href={withFamilyHref('/chat')}
              className="homev2-button homev2-button--light"
              style={{ fontSize: 11.5, padding: '6px 10px' }}
            >
              💬 Чат
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
