'use client';

import Link from 'next/link';
import { FormEvent } from 'react';
import {
  Edit3,
  GitFork,
  Heart,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { Marriage, Person } from '../../lib/api';
import { RelativeRole } from '../pedigree-wizard-modal';
import { DuplicateCandidatePair as DuplicateCandidate, DuplicateCandidatePair } from '../../lib/duplicates';
import { AdminTabKey } from './admin-types';

export interface AdminPeopleSectionProps {
  activeTab: AdminTabKey;
  selectedFamilyId: string;
  people: Person[];
  filteredPeople: Person[];
  marriages: Marriage[];
  duplicateCandidates: DuplicateCandidatePair[];
  isAdmin: boolean;
  actionBusy: boolean;
  detailLoading: boolean;
  personSearch: string;
  setPersonSearch: (value: string) => void;
  showAddPerson: boolean;
  setShowAddPerson: (updater: (prev: boolean) => boolean) => void;
  newPersonLastName: string;
  setNewPersonLastName: (value: string) => void;
  newPersonFirstName: string;
  setNewPersonFirstName: (value: string) => void;
  newPersonGender: 'male' | 'female';
  setNewPersonGender: (value: 'male' | 'female') => void;
  newPersonBirthDate: string;
  setNewPersonBirthDate: (value: string) => void;
  newPersonIsAlive: boolean;
  setNewPersonIsAlive: (value: boolean) => void;
  newPersonDeathDate: string;
  setNewPersonDeathDate: (value: string) => void;
  newPersonLineage: string;
  setNewPersonLineage: (value: string) => void;
  handleAddPerson: (e: FormEvent) => Promise<void>;
  editingPerson: Person | null;
  setEditingPerson: (person: Person | null) => void;
  openEditPerson: (person: Person) => void;
  editLastName: string;
  setEditLastName: (value: string) => void;
  editFirstName: string;
  setEditFirstName: (value: string) => void;
  editGender: 'male' | 'female';
  setEditGender: (value: 'male' | 'female') => void;
  editBirthDate: string;
  setEditBirthDate: (value: string) => void;
  editIsAlive: boolean;
  setEditIsAlive: (value: boolean) => void;
  editDeathDate: string;
  setEditDeathDate: (value: string) => void;
  handleUpdatePerson: (e: FormEvent) => Promise<void>;
  handleDeletePerson: (person: Person) => void;
  onMergeDuplicate: (dup: DuplicateCandidate) => void;
  onOpenWizard: (anchorPersonId: string | null, role: RelativeRole) => void;
  relParentId: string;
  setRelParentId: (value: string) => void;
  relChildId: string;
  setRelChildId: (value: string) => void;
  handleAddParentChild: (e: FormEvent) => Promise<void>;
  parentChildEdges: { id?: string; parent_id: string; child_id: string; relationship_type?: string }[];
  handleDeleteParentChild: (parentId: string, childId: string) => void;
  marriageP1: string;
  setMarriageP1: (value: string) => void;
  marriageP2: string;
  setMarriageP2: (value: string) => void;
  marriageStartDate: string;
  setMarriageStartDate: (value: string) => void;
  handleAddMarriage: (e: FormEvent) => Promise<void>;
  handleDeleteMarriage: (marriageId: string) => void;
}

export function AdminPeopleSection({
  activeTab,
  selectedFamilyId,
  people,
  filteredPeople,
  marriages,
  duplicateCandidates,
  isAdmin,
  actionBusy,
  detailLoading,
  personSearch,
  setPersonSearch,
  showAddPerson,
  setShowAddPerson,
  newPersonLastName,
  setNewPersonLastName,
  newPersonFirstName,
  setNewPersonFirstName,
  newPersonGender,
  setNewPersonGender,
  newPersonBirthDate,
  setNewPersonBirthDate,
  newPersonIsAlive,
  setNewPersonIsAlive,
  newPersonDeathDate,
  setNewPersonDeathDate,
  newPersonLineage,
  setNewPersonLineage,
  handleAddPerson,
  editingPerson,
  setEditingPerson,
  openEditPerson,
  editLastName,
  setEditLastName,
  editFirstName,
  setEditFirstName,
  editGender,
  setEditGender,
  editBirthDate,
  setEditBirthDate,
  editIsAlive,
  setEditIsAlive,
  editDeathDate,
  setEditDeathDate,
  handleUpdatePerson,
  handleDeletePerson,
  onMergeDuplicate,
  onOpenWizard,
  relParentId,
  setRelParentId,
  relChildId,
  setRelChildId,
  handleAddParentChild,
  parentChildEdges,
  handleDeleteParentChild,
  marriageP1,
  setMarriageP1,
  marriageP2,
  setMarriageP2,
  marriageStartDate,
  setMarriageStartDate,
  handleAddMarriage,
  handleDeleteMarriage,
}: AdminPeopleSectionProps) {
  if (activeTab === 'people') {
    return (
      <div className="families-main-card">
        {duplicateCandidates.length > 0 && (
          <details className="admin-dup-details">
            <summary className="admin-dup-summary">
              Давхардсан байж болзошгүй {duplicateCandidates.length} бүртгэл илэрлээ (шалгах)
            </summary>
            <div className="admin-dup-list">
              {duplicateCandidates.map((dup, idx) => (
                <div
                  key={`${dup.personA.id}-${dup.personB.id}-${idx}`}
                  className="admin-dup-item"
                >
                  <div>
                    <strong>
                      {dup.personA.last_name} {dup.personA.first_name}
                    </strong>{' '}
                    ({dup.personA.birth_date?.slice(0, 4) || '—'}) ↔{' '}
                    <strong>
                      {dup.personB.last_name} {dup.personB.first_name}
                    </strong>{' '}
                    ({dup.personB.birth_date?.slice(0, 4) || '—'})
                    <span style={{ marginLeft: 8, color: 'var(--ui-text-muted)' }}>
                      [{dup.reasons.join(', ')}]
                    </span>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onMergeDuplicate(dup)}
                      className="admin-remove-btn"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                    >
                      Нэгтгэх
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="admin-card-header">
          <h3 className="admin-card-title">Хүмүүсийн бүртгэл ({people.length})</h3>
          <div className="admin-header-actions">
            <div className="admin-search-box">
              <input
                type="text"
                placeholder="Нэр, огноогоор хайх…"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                className="admin-search-input"
              />
              <Search size={14} className="admin-search-icon" />
            </div>
            {isAdmin && (
              <div className="admin-header-actions">
                <button
                  type="button"
                  onClick={() => onOpenWizard(null, 'standalone')}
                  className="homev2-button homev2-button--primary"
                  style={{
                    fontSize: 12,
                    padding: '8px 16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'linear-gradient(135deg, #059669, #047857)',
                    border: 'none',
                    color: '#fff',
                  }}
                >
                  <Sparkles size={14} /> + Ухаалаг Wizard-аар хүн нэмэх
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddPerson((prev) => !prev)}
                  className="homev2-button homev2-button--light"
                  style={{ fontSize: 12, padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <UserPlus size={14} /> {showAddPerson ? 'Хаах' : 'Энгийн хэлбэр'}
                </button>
              </div>
            )}
          </div>
        </div>

        {showAddPerson && (
          <form onSubmit={handleAddPerson} className="admin-inline-form">
            <h4 className="admin-form-heading">+ Шинэ хүн ургийн бүртгэлд нэмэх</h4>
            <div className="admin-form-grid">
              <label className="admin-field-label">
                Овог (Last Name) *
                <input
                  value={newPersonLastName}
                  onChange={(e) => setNewPersonLastName(e.target.value)}
                  placeholder="Жишээ: Боржигон"
                  required
                  className="admin-field-input"
                />
              </label>
              <label className="admin-field-label">
                Өөрийн нэр (First Name) *
                <input
                  value={newPersonFirstName}
                  onChange={(e) => setNewPersonFirstName(e.target.value)}
                  placeholder="Жишээ: Батбаяр"
                  required
                  className="admin-field-input"
                />
              </label>
              <label className="admin-field-label">
                Хүйс *
                <select
                  value={newPersonGender}
                  onChange={(e) => setNewPersonGender(e.target.value as 'male' | 'female')}
                  className="admin-role-select"
                  style={{ width: '100%', marginTop: 4, height: 36 }}
                >
                  <option value="male">Эрэгтэй</option>
                  <option value="female">Эмэгтэй</option>
                </select>
              </label>
              <label className="admin-field-label">
                Төрсөн огноо (YYYY эсвэл YYYY-MM-DD)
                <input
                  value={newPersonBirthDate}
                  onChange={(e) => setNewPersonBirthDate(e.target.value)}
                  placeholder="1960-05-12"
                  className="admin-field-input"
                />
              </label>
              <label className="admin-field-label">
                Амьд сэрүүн эсэх
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={newPersonIsAlive}
                    onChange={(e) => setNewPersonIsAlive(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#d97706' }}
                  />
                  <span style={{ fontSize: 12 }}>
                    {newPersonIsAlive ? 'Амьд сэрүүн' : 'Тэнгэрт хальсан'}
                  </span>
                </div>
              </label>
              {!newPersonIsAlive && (
                <label className="admin-field-label">
                  Нас барсан огноо
                  <input
                    value={newPersonDeathDate}
                    onChange={(e) => setNewPersonDeathDate(e.target.value)}
                    placeholder="2010"
                    className="admin-field-input"
                  />
                </label>
              )}
              <label className="admin-field-label">
                Ургийн овог / Яс салбар
                <input
                  value={newPersonLineage}
                  onChange={(e) => setNewPersonLineage(e.target.value)}
                  placeholder="Жишээ: Хиад Боржигон"
                  className="admin-field-input"
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="submit"
                className="homev2-button homev2-button--primary"
                disabled={actionBusy}
                style={{ fontSize: 12, padding: '8px 20px' }}
              >
                {actionBusy ? 'Бүртгэж байна…' : 'Хүн бүртгэх'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddPerson(() => false)}
                className="homev2-button homev2-button--light"
                style={{ fontSize: 12 }}
              >
                Болих
              </button>
            </div>
          </form>
        )}

        {editingPerson && (
          <div className="admin-modal-backdrop">
            <div className="admin-modal-card" style={{ padding: 24 }}>
              <div className="admin-card-header" style={{ marginBottom: 16 }}>
                <h3 className="admin-card-title">✏️ Хүний мэдээлэл засах</h3>
                <button
                  type="button"
                  onClick={() => setEditingPerson(null)}
                  className="admin-icon-close"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleUpdatePerson}>
                <div className="admin-form-grid">
                  <label className="admin-field-label">
                    Овог *
                    <input
                      value={editLastName}
                      onChange={(e) => setEditLastName(e.target.value)}
                      required
                      className="admin-field-input"
                    />
                  </label>
                  <label className="admin-field-label">
                    Өөрийн нэр *
                    <input
                      value={editFirstName}
                      onChange={(e) => setEditFirstName(e.target.value)}
                      required
                      className="admin-field-input"
                    />
                  </label>
                  <label className="admin-field-label">
                    Хүйс
                    <select
                      value={editGender}
                      onChange={(e) => setEditGender(e.target.value as 'male' | 'female')}
                      className="admin-role-select"
                      style={{ width: '100%', marginTop: 4, height: 36 }}
                    >
                      <option value="male">Эрэгтэй</option>
                      <option value="female">Эмэгтэй</option>
                    </select>
                  </label>
                  <label className="admin-field-label">
                    Төрсөн огноо
                    <input
                      value={editBirthDate}
                      onChange={(e) => setEditBirthDate(e.target.value)}
                      placeholder="1970-01-01"
                      className="admin-field-input"
                    />
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <input
                    type="checkbox"
                    checked={editIsAlive}
                    onChange={(e) => setEditIsAlive(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#d97706' }}
                  />
                  <span className="admin-field-label">
                    {editIsAlive ? 'Амьд сэрүүн' : 'Тэнгэрт хальсан'}
                  </span>
                </div>
                {!editIsAlive && (
                  <label className="admin-field-label" style={{ display: 'block', marginBottom: 14 }}>
                    Нас барсан огноо
                    <input
                      value={editDeathDate}
                      onChange={(e) => setEditDeathDate(e.target.value)}
                      placeholder="2015"
                      className="admin-field-input"
                    />
                  </label>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setEditingPerson(null)}
                    className="homev2-button homev2-button--light"
                    style={{ fontSize: 12 }}
                  >
                    Болих
                  </button>
                  <button
                    type="submit"
                    className="homev2-button homev2-button--primary"
                    disabled={actionBusy}
                    style={{ fontSize: 12, padding: '8px 18px' }}
                  >
                    {actionBusy ? 'Хадгалж байна…' : 'Өөрчлөлтийг хадгалах'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {detailLoading ? (
          <div className="admin-trash-empty">Хүмүүсийн бүртгэлийг ачаалж байна…</div>
        ) : filteredPeople.length ? (
          <div className="admin-list-stack">
            {filteredPeople.map((person) => {
              const isMale = person.gender === 'male';
              const isFemale = person.gender === 'female';
              const isMinorPerson =
                person.is_minor ||
                (person.birth_date &&
                  person.is_alive &&
                  new Date().getFullYear() - parseInt(person.birth_date.slice(0, 4), 10) < 18);

              return (
                <div key={person.id} className="admin-item-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      className="admin-person-avatar"
                      style={{
                        background: isMale
                          ? 'linear-gradient(135deg, #1e3a8a, #0284c7)'
                          : isFemale
                            ? 'linear-gradient(135deg, #9f1239, #ea580c)'
                            : '#64748b',
                      }}
                    >
                      {person.last_name?.slice(0, 1)}
                      {person.first_name?.slice(0, 1)}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 14.5, color: 'var(--ink-primary, #17372b)' }}>
                          {person.last_name} {person.first_name}
                        </strong>
                        {isMinorPerson && (
                          <span
                            className="admin-minor-badge"
                            title="Насанд хүрээгүй гишүүний хувийн нууцлал хамгаалагдсан"
                          >
                            <Shield size={10} /> Хүүхдийн хамгаалалт
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 11, color: 'var(--ink-muted, #74857b)' }}>
                        <span>{isMale ? 'Эрэгтэй' : isFemale ? 'Эмэгтэй' : 'Бусад'}</span>
                        <span>·</span>
                        <span>
                          {person.birth_date?.slice(0, 4) || '—'}{' '}
                          {person.is_alive ? '(амьд сэрүүн)' : `– ${person.death_date?.slice(0, 4) || '?'}`}
                        </span>
                        {person.created_by && (
                          <>
                            <span>·</span>
                            <span>Нэмсэн: {person.created_by.slice(0, 6)}…</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Link
                      href={`/profile?family=${encodeURIComponent(selectedFamilyId)}&person=${encodeURIComponent(person.id)}`}
                      className="homev2-button homev2-button--light"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                    >
                      Профайл
                    </Link>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpenWizard(person.id, 'son')}
                          className="homev2-button homev2-button--primary"
                          style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            border: 'none',
                            color: '#fff',
                          }}
                          title="Энэ хүнд үр хүүхэд, хань, эсвэл эцэг эх ухаалгаар холбох"
                        >
                          <GitFork size={12} style={{ display: 'inline', marginRight: 4 }} /> + Ураг зангидах
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditPerson(person)}
                          className="homev2-button homev2-button--light"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                        >
                          <Edit3 size={12} style={{ display: 'inline', marginRight: 4 }} /> Засах
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePerson(person)}
                          className="admin-remove-btn"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                        >
                          <Trash2 size={12} style={{ display: 'inline', marginRight: 4 }} /> Устгах
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="admin-muted-text" style={{ padding: '16px 0' }}>Бүртгэлтэй хүн олдсонгүй.</p>
        )}
      </div>
    );
  }

  if (activeTab === 'relationships') {
    return (
      <div className="admin-section-stack">
        <div className="families-main-card">
          <h3 className="admin-card-subtitle">Эцэг эх — Хүүхдийн холбоос үүсгэх</h3>
          <form
            onSubmit={handleAddParentChild}
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <label className="admin-field-label" style={{ minWidth: 220 }}>
              Эцэг / Эх:
              <select
                value={relParentId}
                onChange={(e) => setRelParentId(e.target.value)}
                required
                className="admin-role-select"
                style={{ width: '100%', marginTop: 4, height: 38 }}
              >
                <option value="">-- Сонгох --</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name} {p.first_name} ({p.gender === 'female' ? 'Эх' : 'Эцэг'})
                  </option>
                ))}
              </select>
            </label>

            <div style={{ paddingBottom: 10, color: '#d97706', fontWeight: 700 }}>→</div>

            <label className="admin-field-label" style={{ minWidth: 220 }}>
              Хүүхэд:
              <select
                value={relChildId}
                onChange={(e) => setRelChildId(e.target.value)}
                required
                className="admin-role-select"
                style={{ width: '100%', marginTop: 4, height: 38 }}
              >
                <option value="">-- Сонгох --</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name} {p.first_name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="homev2-button homev2-button--primary"
              disabled={actionBusy}
              style={{ fontSize: 12, padding: '8px 18px', height: 38 }}
            >
              Холбоос үүсгэх
            </button>
          </form>

          {parentChildEdges.length > 0 && (
            <div className="admin-list-stack" style={{ marginTop: 20 }}>
              {parentChildEdges.map((edge) => {
                const parent = people.find((p) => p.id === edge.parent_id);
                const child = people.find((p) => p.id === edge.child_id);
                return (
                  <div key={`${edge.parent_id}-${edge.child_id}`} className="admin-item-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <GitFork size={15} style={{ color: '#059669' }} />
                      <strong style={{ fontSize: 13.5, color: 'var(--ink-primary, #17372b)' }}>
                        {parent ? `${parent.last_name} ${parent.first_name}` : 'Эцэг/Эх'} →{' '}
                        {child ? `${child.last_name} ${child.first_name}` : 'Хүүхэд'}
                      </strong>
                      <span style={{ fontSize: 11, color: 'var(--ink-muted, #74857b)' }}>
                        ({edge.relationship_type === 'adoptive' ? 'Үрчилсэн' : 'Төрсөн'})
                      </span>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteParentChild(edge.parent_id, edge.child_id)}
                        className="admin-remove-btn"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                      >
                        Холбоос салгах
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="families-main-card">
          <h3 className="admin-card-subtitle">Гэрлэлтийн холбоо ({marriages.length})</h3>
          <form
            onSubmit={handleAddMarriage}
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 24 }}
          >
            <label className="admin-field-label" style={{ minWidth: 180 }}>
              1-р хүн:
              <select
                value={marriageP1}
                onChange={(e) => setMarriageP1(e.target.value)}
                required
                className="admin-role-select"
                style={{ width: '100%', marginTop: 4, height: 38 }}
              >
                <option value="">-- Сонгох --</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name} {p.first_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field-label" style={{ minWidth: 180 }}>
              2-р хүн (Хань):
              <select
                value={marriageP2}
                onChange={(e) => setMarriageP2(e.target.value)}
                required
                className="admin-role-select"
                style={{ width: '100%', marginTop: 4, height: 38 }}
              >
                <option value="">-- Сонгох --</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name} {p.first_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field-label" style={{ minWidth: 140 }}>
              Гэрлэсэн он:
              <input
                value={marriageStartDate}
                onChange={(e) => setMarriageStartDate(e.target.value)}
                placeholder="1985"
                className="admin-field-input"
              />
            </label>

            <button
              type="submit"
              className="homev2-button homev2-button--primary"
              disabled={actionBusy}
              style={{ fontSize: 12, padding: '8px 18px', height: 38 }}
            >
              Гэрлэлт бүртгэх
            </button>
          </form>

          <div className="admin-list-stack">
            {marriages.map((m) => {
              const p1 = people.find((p) => p.id === m.person_1_id);
              const p2 = people.find((p) => p.id === m.person_2_id);
              return (
                <div key={m.id} className="admin-item-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Heart size={16} style={{ color: '#e11d48' }} />
                    <strong style={{ fontSize: 13.5, color: 'var(--ink-primary, #17372b)' }}>
                      {p1 ? `${p1.last_name} ${p1.first_name}` : 'Хүн 1'} &{' '}
                      {p2 ? `${p2.last_name} ${p2.first_name}` : 'Хүн 2'}
                    </strong>
                    {m.start_date && (
                      <span style={{ fontSize: 11, color: 'var(--ink-muted, #74857b)' }}>
                        ({m.start_date.slice(0, 4)} онд)
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteMarriage(m.id)}
                      className="admin-remove-btn"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                    >
                      Холбоос цуцлах
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
