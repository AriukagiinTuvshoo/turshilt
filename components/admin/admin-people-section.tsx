'use client';

import Link from 'next/link';
import { FormEvent, ReactNode, useRef } from 'react';
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
import { useFocusTrap } from '../../lib/use-focus-trap';
import { RelativeRole } from '../pedigree-wizard-modal';
import { DuplicateCandidatePair } from '../../lib/duplicates';
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
  filterBar?: ReactNode;
  showAddPerson: boolean;
  setShowAddPerson: (updater: (prev: boolean) => boolean) => void;
  newPersonLastName: string;
  setNewPersonLastName: (value: string) => void;
  newPersonFirstName: string;
  setNewPersonFirstName: (value: string) => void;
  newPersonGender: 'male' | 'female' | 'unknown';
  setNewPersonGender: (value: 'male' | 'female' | 'unknown') => void;
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
  editGender: 'male' | 'female' | 'unknown';
  setEditGender: (value: 'male' | 'female' | 'unknown') => void;
  editBirthDate: string;
  setEditBirthDate: (value: string) => void;
  editBirthPlace: string;
  setEditBirthPlace: (value: string) => void;
  editShortDescription: string;
  setEditShortDescription: (value: string) => void;
  editVisibility: 'family' | 'private' | 'public';
  setEditVisibility: (value: 'family' | 'private' | 'public') => void;
  editIsAlive: boolean;
  setEditIsAlive: (value: boolean) => void;
  editDeathDate: string;
  setEditDeathDate: (value: string) => void;
  handleUpdatePerson: (e: FormEvent) => Promise<void>;
  handleDeletePerson: (person: Person) => void;
  onMergeDuplicate: (dup: DuplicateCandidatePair) => void;
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
  filterBar,
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
  editBirthPlace,
  setEditBirthPlace,
  editShortDescription,
  setEditShortDescription,
  editVisibility,
  setEditVisibility,
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
  const editModalRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(Boolean(editingPerson), editModalRef, {
    onEscape: () => setEditingPerson(null),
  });

  if (activeTab === 'people') {
    return (
      <div className="families-main-card">
        {duplicateCandidates.length > 0 && (
          <details className="admin-dup-details">
            <summary className="admin-dup-summary">
              ⚠️ Давхардсан байж болзошгүй {duplicateCandidates.length} бүртгэл илэрлээ (шалгах)
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
                    <span className="admin-muted-text" style={{ marginLeft: 8 }}>
                      [{dup.reasons.join(', ')}]
                    </span>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onMergeDuplicate(dup)}
                      className="admin-remove-btn"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                    >
                      🔗 Нэгтгэх
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="admin-card-header">
          <h3 className="admin-card-title">🌳 Хүмүүсийн бүртгэл ({filteredPeople.length}/{people.length})</h3>
          <div className="admin-header-actions">
            <div className="admin-search-box">
              <input
                type="text"
                placeholder="Нэр, овгоор, төрсөн оноор хайх…"
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
                  className="admin-action-accent-btn"
                >
                  <Sparkles size={14} /> + Ухаалаг Wizard-аар нэмэх
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddPerson((prev) => !prev)}
                  className="homev2-button homev2-button--light"
                  style={{ fontSize: 12, padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <UserPlus size={14} /> {showAddPerson ? 'Хаах' : 'Энгийн бүртгэл'}
                </button>
              </div>
            )}
          </div>
        </div>

        {filterBar}

        {showAddPerson && (
          <form onSubmit={handleAddPerson} className="admin-inline-form">
            <h4 className="admin-form-heading">✨ Шинэ хүн ургийн бүртгэлд нэмэх</h4>
            <div className="admin-form-grid">
              <label className="admin-field-label">
                Овог *
                <input
                  value={newPersonLastName}
                  onChange={(e) => setNewPersonLastName(e.target.value)}
                  placeholder="Жишээ: Боржигон"
                  required
                  className="admin-field-input"
                />
              </label>
              <label className="admin-field-label">
                Өөрийн нэр *
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
                  onChange={(e) => setNewPersonGender(e.target.value as 'male' | 'female' | 'unknown')}
                  className="admin-field-input"
                >
                  <option value="male">Эрэгтэй</option>
                  <option value="female">Эмэгтэй</option>
                  <option value="unknown">Тодорхойгүй</option>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={newPersonIsAlive}
                    onChange={(e) => setNewPersonIsAlive(e.target.checked)}
                    style={{ width: 16, height: 16 }}
                  />
                  <span>{newPersonIsAlive ? '🌱 Амьд сэрүүн' : '🕊️ Тэнгэрт хальсан'}</span>
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
                {actionBusy ? 'Бүртгэж байна…' : '💾 Хүн бүртгэх'}
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
          <div className="admin-modal-backdrop" role="presentation">
            <div
              ref={editModalRef}
              className="admin-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-person-modal-title"
            >
              <div className="admin-modal-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 id="edit-person-modal-title" className="admin-modal-title">
                    ✏️ Хүний мэдээлэл шинэчлэх
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingPerson(null)}
                    className="admin-icon-close"
                    aria-label="Цонх хаах"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              <form onSubmit={handleUpdatePerson}>
                <div className="admin-modal-body">
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
                        onChange={(e) => setEditGender(e.target.value as 'male' | 'female' | 'unknown')}
                        className="admin-field-input"
                      >
                        <option value="male">Эрэгтэй</option>
                        <option value="female">Эмэгтэй</option>
                        <option value="unknown">Тодорхойгүй</option>
                      </select>
                    </label>
                    <label className="admin-field-label">
                      Төрсөн огноо (YYYY-MM-DD)
                      <input
                        value={editBirthDate}
                        onChange={(e) => setEditBirthDate(e.target.value)}
                        placeholder="1970-01-01"
                        className="admin-field-input"
                      />
                    </label>
                    <label className="admin-field-label">
                      Төрсөн газар
                      <input
                        value={editBirthPlace}
                        onChange={(e) => setEditBirthPlace(e.target.value)}
                        placeholder="Архангай аймаг..."
                        className="admin-field-input"
                      />
                    </label>
                    <label className="admin-field-label">
                      Харагдах хүрээ
                      <select
                        value={editVisibility}
                        onChange={(e) => setEditVisibility(e.target.value as 'family' | 'private' | 'public')}
                        className="admin-field-input"
                      >
                        <option value="family">🏡 Гэр бүл дотроо</option>
                        <option value="private">🔒 Хувийн (Зөвхөн үүсгэгч/өөрөө)</option>
                        <option value="public">🌐 Нийтийн</option>
                      </select>
                    </label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <input
                      id="edit-person-alive-check"
                      type="checkbox"
                      checked={editIsAlive}
                      onChange={(e) => setEditIsAlive(e.target.checked)}
                      style={{ width: 16, height: 16 }}
                    />
                    <label htmlFor="edit-person-alive-check" className="admin-field-label">
                      {editIsAlive ? '🌱 Амьд сэрүүн' : '🕊️ Тэнгэрт хальсан'}
                    </label>
                  </div>
                  {!editIsAlive && (
                    <label className="admin-field-label" style={{ marginBottom: 14 }}>
                      Нас барсан огноо (YYYY-MM-DD)
                      <input
                        value={editDeathDate}
                        onChange={(e) => setEditDeathDate(e.target.value)}
                        placeholder="2015-03-10"
                        className="admin-field-input"
                      />
                    </label>
                  )}
                  <label className="admin-field-label">
                    Товч намтар / Тэмдэглэл
                    <textarea
                      rows={3}
                      value={editShortDescription}
                      onChange={(e) => setEditShortDescription(e.target.value)}
                      placeholder="Товч танилцуулга, гавьяа, онцлох мэдээлэл..."
                      className="admin-field-input"
                    />
                  </label>
                </div>
                <div className="admin-modal-footer">
                  <button
                    type="button"
                    onClick={() => setEditingPerson(null)}
                    className="homev2-button homev2-button--light"
                  >
                    Болих
                  </button>
                  <button
                    type="submit"
                    className="homev2-button homev2-button--primary"
                    disabled={actionBusy}
                  >
                    {actionBusy ? 'Хадгалж байна…' : '💾 Өөрчлөлтийг хадгалах'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {detailLoading ? (
          <div className="admin-trash-empty">🌳 Хүмүүсийн бүртгэлийг ачаалж байна…</div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div
                      className={`admin-person-avatar ${
                        isMale ? 'is-male' : isFemale ? 'is-female' : 'is-unknown'
                      }`}
                    >
                      {person.last_name?.slice(0, 1)}
                      {person.first_name?.slice(0, 1)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 14.5, color: 'var(--ui-text)' }}>
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
                        {!person.birth_date && (
                          <span className="admin-pill-neutral">🎂 Огноо дутуу</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }} className="admin-muted-text">
                        <span>{isMale ? 'Эрэгтэй' : isFemale ? 'Эмэгтэй' : 'Хүйс тодорхойгүй'}</span>
                        <span>·</span>
                        <span>
                          {person.birth_date?.slice(0, 4) || '—'}{' '}
                          {person.is_alive ? '(энх тунх)' : `– ${person.death_date?.slice(0, 4) || '?'}`}
                        </span>
                        {person.birth_place && (
                          <>
                            <span>·</span>
                            <span>📍 {person.birth_place}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="admin-header-actions">
                    <Link
                      href={`/profile?family=${encodeURIComponent(selectedFamilyId)}&person=${encodeURIComponent(person.id)}`}
                      className="homev2-button homev2-button--light"
                      style={{ fontSize: 11.5, padding: '5px 10px' }}
                    >
                      Профайл
                    </Link>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpenWizard(person.id, 'son')}
                          className="admin-action-accent-btn"
                          style={{ fontSize: 11.5, padding: '5px 10px' }}
                          title="Энэ хүнд үр хүүхэд, хань, эсвэл эцэг эх ухаалгаар холбох"
                        >
                          <GitFork size={12} /> + Ураг зангидах
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditPerson(person)}
                          className="homev2-button homev2-button--light"
                          style={{ fontSize: 11.5, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Edit3 size={12} /> Засах
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePerson(person)}
                          className="admin-remove-btn"
                          style={{ fontSize: 11.5, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Trash2 size={12} /> Устгах
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="admin-muted-text" style={{ padding: '16px 0' }}>
            Шүүлтүүрт тохирох хүн олдсонгүй.
          </p>
        )}
      </div>
    );
  }

  if (activeTab === 'relationships') {
    return (
      <div className="admin-section-stack">
        <div className="families-main-card">
          <h3 className="admin-card-subtitle">🌿 Эцэг эх — Хүүхдийн холбоос үүсгэх</h3>
          <form
            onSubmit={handleAddParentChild}
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <label className="admin-field-label" style={{ flex: '1 1 200px' }}>
              Эцэг / Эх:
              <select
                value={relParentId}
                onChange={(e) => setRelParentId(e.target.value)}
                required
                className="admin-field-input"
              >
                <option value="">-- Сонгох --</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name} {p.first_name} ({p.gender === 'female' ? 'Эх' : 'Эцэг'})
                  </option>
                ))}
              </select>
            </label>

            <div style={{ paddingBottom: 10, color: 'var(--ui-accent-text)', fontWeight: 700 }}>→</div>

            <label className="admin-field-label" style={{ flex: '1 1 200px' }}>
              Хүүхэд:
              <select
                value={relChildId}
                onChange={(e) => setRelChildId(e.target.value)}
                required
                className="admin-field-input"
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
                      <GitFork size={15} style={{ color: 'var(--ui-success-text)' }} />
                      <strong style={{ fontSize: 13.5, color: 'var(--ui-text)' }}>
                        {parent ? `${parent.last_name} ${parent.first_name}` : 'Эцэг/Эх'} →{' '}
                        {child ? `${child.last_name} ${child.first_name}` : 'Хүүхэд'}
                      </strong>
                      <span className="admin-muted-text">
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
          <h3 className="admin-card-subtitle">💍 Гэрлэлтийн холбоо ({marriages.length})</h3>
          <form
            onSubmit={handleAddMarriage}
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 24 }}
          >
            <label className="admin-field-label" style={{ flex: '1 1 180px' }}>
              1-р хүн:
              <select
                value={marriageP1}
                onChange={(e) => setMarriageP1(e.target.value)}
                required
                className="admin-field-input"
              >
                <option value="">-- Сонгох --</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name} {p.first_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field-label" style={{ flex: '1 1 180px' }}>
              2-р хүн (Хань):
              <select
                value={marriageP2}
                onChange={(e) => setMarriageP2(e.target.value)}
                required
                className="admin-field-input"
              >
                <option value="">-- Сонгох --</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name} {p.first_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field-label" style={{ flex: '0 1 140px' }}>
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
                    <Heart size={16} style={{ color: 'var(--ui-danger-text)' }} />
                    <strong style={{ fontSize: 13.5, color: 'var(--ui-text)' }}>
                      {p1 ? `${p1.last_name} ${p1.first_name}` : 'Хүн 1'} &amp;{' '}
                      {p2 ? `${p2.last_name} ${p2.first_name}` : 'Хүн 2'}
                    </strong>
                    {m.start_date && (
                      <span className="admin-muted-text">
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
