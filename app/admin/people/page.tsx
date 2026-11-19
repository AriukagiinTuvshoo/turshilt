'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BranchSummary,
  LineageSummary,
  Marriage,
  ParentChildRelationshipItem,
  Person,
  api,
} from '../../../lib/api';
import { DuplicateCandidatePair, findDuplicatePeople } from '../../../lib/duplicates';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { PedigreeWizardModal, RelativeRole } from '../../../components/pedigree-wizard-modal';
import { useAdminContext } from '../../../components/admin/admin-shell';
import { AdminPeopleSection } from '../../../components/admin/admin-people-section';
import { friendlyError } from '../../../components/admin/admin-types';

type QualityFilter = 'all' | 'missing_birth' | 'missing_gender' | 'isolated';

function normalizeOptionalDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;
  return trimmed;
}

export default function AdminPeoplePage() {
  const {
    selectedFamilyId,
    selectedFamily,
    can,
    setNotice,
    setError,
    refreshOverview,
  } = useAdminContext();

  const [subView, setSubView] = useState<'people' | 'relationships' | 'lineages'>('people');
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all');
  const [personSearch, setPersonSearch] = useState('');

  const [people, setPeople] = useState<Person[]>([]);
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [parentChildEdges, setParentChildEdges] = useState<ParentChildRelationshipItem[]>([]);
  const [lineages, setLineages] = useState<LineageSummary[]>([]);
  const [branchesByLineage, setBranchesByLineage] = useState<Record<string, BranchSummary[]>>({});
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  // Add person form
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonLastName, setNewPersonLastName] = useState('');
  const [newPersonFirstName, setNewPersonFirstName] = useState('');
  const [newPersonGender, setNewPersonGender] = useState<'male' | 'female' | 'unknown'>('male');
  const [newPersonBirthDate, setNewPersonBirthDate] = useState('');
  const [newPersonIsAlive, setNewPersonIsAlive] = useState(true);
  const [newPersonDeathDate, setNewPersonDeathDate] = useState('');
  const [newPersonLineage, setNewPersonLineage] = useState('');

  // Edit person modal
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editLastName, setEditLastName] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editGender, setEditGender] = useState<'male' | 'female' | 'unknown'>('male');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [editBirthPlace, setEditBirthPlace] = useState('');
  const [editShortDescription, setEditShortDescription] = useState('');
  const [editVisibility, setEditVisibility] = useState<'family' | 'private' | 'public'>('family');
  const [editIsAlive, setEditIsAlive] = useState(true);
  const [editDeathDate, setEditDeathDate] = useState('');

  // Relationships forms
  const [relParentId, setRelParentId] = useState('');
  const [relChildId, setRelChildId] = useState('');
  const [marriageP1, setMarriageP1] = useState('');
  const [marriageP2, setMarriageP2] = useState('');
  const [marriageStartDate, setMarriageStartDate] = useState('');

  // Lineages & branches forms
  const [lineageName, setLineageName] = useState('');
  const [lineageDesc, setLineageDesc] = useState('');
  const [branchLineageId, setBranchLineageId] = useState('');
  const [branchName, setBranchName] = useState('');

  // Wizard & Confirm dialogs
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAnchorId, setWizardAnchorId] = useState<string | null>(null);
  const [wizardRole, setWizardRole] = useState<RelativeRole>('son');
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'warning' | 'primary';
    onConfirm: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Батлах',
    variant: 'danger',
    onConfirm: async () => {},
  });

  const canEditPeople = can('manage_people');

  const loadData = useCallback(async () => {
    if (!selectedFamilyId) return;
    setLoading(true);
    try {
      const [peopleData, marriagesData, pcData, lineagesData] = await Promise.all([
        api<Person[]>(`/families/${selectedFamilyId}/persons`),
        api<Marriage[]>(`/families/${selectedFamilyId}/marriages`).catch(() => []),
        api<ParentChildRelationshipItem[]>(
          `/families/${selectedFamilyId}/relationships/parent-child`,
        ).catch(() => []),
        api<LineageSummary[]>(`/families/${selectedFamilyId}/lineages`).catch(() => []),
      ]);
      setPeople(peopleData);
      setMarriages(marriagesData);
      setParentChildEdges(pcData);
      setLineages(lineagesData);
      if (lineagesData.length > 0) {
        setBranchLineageId((curr) =>
          curr && lineagesData.some((l) => l.id === curr) ? curr : lineagesData[0].id,
        );
        const branchEntries = await Promise.all(
          lineagesData.map(async (lin) => [
            lin.id,
            await api<BranchSummary[]>(`/lineages/${lin.id}/branches`).catch(() => []),
          ] as const),
        );
        setBranchesByLineage(Object.fromEntries(branchEntries));
      } else {
        setBranchesByLineage({});
      }
    } catch (cause) {
      setError(friendlyError(cause, 'Хүмүүс болон ургийн мэдээллийг ачаалж чадсангүй.'));
    } finally {
      setLoading(false);
    }
  }, [selectedFamilyId, setError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const connectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of parentChildEdges) {
      ids.add(edge.parent_id);
      ids.add(edge.child_id);
    }
    for (const m of marriages) {
      ids.add(m.person_1_id);
      ids.add(m.person_2_id);
    }
    return ids;
  }, [marriages, parentChildEdges]);

  const qualityCounts = useMemo(
    () => ({
      all: people.length,
      missing_birth: people.filter((p) => !p.birth_date).length,
      missing_gender: people.filter((p) => p.gender !== 'male' && p.gender !== 'female').length,
      isolated: people.length > 1 ? people.filter((p) => !connectedIds.has(p.id)).length : 0,
    }),
    [connectedIds, people],
  );

  const filteredPeople = useMemo(() => {
    let list = people;
    if (qualityFilter === 'missing_birth') {
      list = list.filter((p) => !p.birth_date);
    } else if (qualityFilter === 'missing_gender') {
      list = list.filter((p) => p.gender !== 'male' && p.gender !== 'female');
    } else if (qualityFilter === 'isolated' && people.length > 1) {
      list = list.filter((p) => !connectedIds.has(p.id));
    }

    if (!personSearch.trim()) return list;
    const q = personSearch.toLowerCase();
    return list.filter(
      (p) =>
        p.first_name.toLowerCase().includes(q) ||
        p.last_name.toLowerCase().includes(q) ||
        (p.nickname && p.nickname.toLowerCase().includes(q)) ||
        (p.birth_date && p.birth_date.includes(q)),
    );
  }, [connectedIds, people, personSearch, qualityFilter]);

  const duplicateCandidates = useMemo(() => findDuplicatePeople(people), [people]);

  const openEditPerson = (person: Person) => {
    setEditingPerson(person);
    setEditLastName(person.last_name || '');
    setEditFirstName(person.first_name || '');
    setEditGender(
      person.gender === 'female' ? 'female' : person.gender === 'male' ? 'male' : 'unknown',
    );
    setEditBirthDate(person.birth_date || '');
    setEditBirthPlace(person.birth_place || '');
    setEditShortDescription(person.short_description || '');
    setEditVisibility(
      person.visibility === 'private' || person.visibility === 'public'
        ? person.visibility
        : 'family',
    );
    setEditIsAlive(person.is_alive);
    setEditDeathDate(person.death_date || '');
  };

  const handleAddPerson = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !canEditPeople) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api<Person>(`/families/${selectedFamilyId}/persons`, {
        method: 'POST',
        body: JSON.stringify({
          last_name: newPersonLastName.trim(),
          first_name: newPersonFirstName.trim(),
          gender: newPersonGender,
          birth_date: normalizeOptionalDate(newPersonBirthDate),
          is_alive: newPersonIsAlive,
          death_date: newPersonIsAlive ? null : normalizeOptionalDate(newPersonDeathDate),
          short_description: newPersonLineage.trim()
            ? `Ургийн овог: ${newPersonLineage.trim()}`
            : null,
        }),
      });
      setNewPersonLastName('');
      setNewPersonFirstName('');
      setNewPersonBirthDate('');
      setNewPersonDeathDate('');
      setNewPersonLineage('');
      setShowAddPerson(false);
      setNotice('🌱 Шинэ хүн ургийн бүртгэлд нэмэгдлээ.');
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Хүн бүртгэх үед алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleUpdatePerson = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !editingPerson || !canEditPeople) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api<Person>(`/families/${selectedFamilyId}/persons/${editingPerson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          last_name: editLastName.trim(),
          first_name: editFirstName.trim(),
          gender: editGender,
          birth_date: normalizeOptionalDate(editBirthDate),
          birth_place: editBirthPlace.trim() || null,
          short_description: editShortDescription.trim() || null,
          visibility: editVisibility,
          is_alive: editIsAlive,
          death_date: editIsAlive ? null : normalizeOptionalDate(editDeathDate),
        }),
      });
      setEditingPerson(null);
      setNotice('✏️ Хүний мэдээлэл амжилттай шинэчлэгдлээ.');
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Хүний мэдээлэл шинэчлэхэд алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeletePerson = (person: Person) => {
    setConfirmState({
      isOpen: true,
      title: '🗑️ Хүнийг модноос хасах',
      message: `"${person.last_name} ${person.first_name}"-ийг гэр бүлийн бүртгэлээс хасаж хогийн сав руу зөөх үү?`,
      confirmLabel: 'Хогийн сав руу зөөх',
      variant: 'danger',
      onConfirm: async () => {
        setActionBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/persons/${person.id}`, { method: 'DELETE' });
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice(`🗑️ “${person.last_name} ${person.first_name}”-г хогийн сав руу зөөлөө.`);
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Хүнийг устгах үед алдаа гарлаа.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleMergeDuplicate = (dup: DuplicateCandidatePair) => {
    setConfirmState({
      isOpen: true,
      title: '🔗 Давхардсан бүртгэл нэгтгэх',
      message: `"${dup.personA.last_name} ${dup.personA.first_name}" бүртгэлийг үндсэн болгож, "${dup.personB.last_name} ${dup.personB.first_name}" бүртгэлийн бүх холбоос ба өгөгдлийг шилжүүлэн нэгтгэх үү?`,
      confirmLabel: 'Нэгтгэх',
      variant: 'warning',
      onConfirm: async () => {
        setActionBusy(true);
        try {
          await api(
            `/families/${selectedFamilyId}/persons/${dup.personA.id}/merge/${dup.personB.id}`,
            { method: 'POST' },
          );
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice('🔗 Хоёр давхардсан бүртгэл амжилттай нэгтгэгдлээ.');
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Бүртгэл нэгтгэх үед алдаа гарлаа.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleAddParentChild = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !relParentId || !relChildId) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/families/${selectedFamilyId}/relationships/parent-child`, {
        method: 'POST',
        body: JSON.stringify({
          parent_id: relParentId,
          child_id: relChildId,
          relationship_type: 'biological',
        }),
      });
      setRelParentId('');
      setRelChildId('');
      setNotice('🌿 Эцэг эх — хүүхдийн холбоос үүслээ.');
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Ургийн холбоос үүсгэхэд алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteParentChild = (parentId: string, childId: string) => {
    setConfirmState({
      isOpen: true,
      title: '✂️ Эцэг эхийн холбоосыг салгах',
      message: 'Энэ эцэг эх ба хүүхдийн шууд холбоосыг салгах уу?',
      confirmLabel: 'Салгах',
      variant: 'danger',
      onConfirm: async () => {
        setActionBusy(true);
        try {
          await api(
            `/families/${selectedFamilyId}/relationships/parent-child?parent_id=${encodeURIComponent(parentId)}&child_id=${encodeURIComponent(childId)}`,
            { method: 'DELETE' },
          );
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice('✂️ Эцэг эхийн холбоос салгагдлаа.');
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Холбоос салгах үед алдаа гарлаа.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleAddMarriage = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !marriageP1 || !marriageP2) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/families/${selectedFamilyId}/marriages`, {
        method: 'POST',
        body: JSON.stringify({
          person_1_id: marriageP1,
          person_2_id: marriageP2,
          status: 'married',
          start_date: normalizeOptionalDate(marriageStartDate),
        }),
      });
      setMarriageP1('');
      setMarriageP2('');
      setMarriageStartDate('');
      setNotice('💍 Гэрлэлтийн холбоос бүртгэгдлээ.');
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Гэрлэлт бүртгэх үед алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteMarriage = (marriageId: string) => {
    setConfirmState({
      isOpen: true,
      title: '💍 Гэрлэлтийн холбоос цуцлах',
      message: 'Энэ гэрлэлтийн бүртгэлийг архивлаж цуцлах уу?',
      confirmLabel: 'Цуцлах',
      variant: 'danger',
      onConfirm: async () => {
        setActionBusy(true);
        try {
          await api(`/families/${selectedFamilyId}/marriages/${marriageId}`, { method: 'DELETE' });
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          setNotice('💍 Гэрлэлтийн холбоос цуцлагдлаа.');
          await Promise.all([loadData(), refreshOverview()]);
        } catch (cause) {
          setError(friendlyError(cause, 'Гэрлэлт устгах үед алдаа гарлаа.'));
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleCreateLineage = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !lineageName.trim() || !canEditPeople) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/families/${selectedFamilyId}/lineages`, {
        method: 'POST',
        body: JSON.stringify({
          name: lineageName.trim(),
          description: lineageDesc.trim() || null,
        }),
      });
      setLineageName('');
      setLineageDesc('');
      setNotice('🌿 Шинэ удам угсаа нэмэгдлээ.');
      await Promise.all([loadData(), refreshOverview()]);
    } catch (cause) {
      setError(friendlyError(cause, 'Удам угсаа үүсгэхэд алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateBranch = async (e: FormEvent) => {
    e.preventDefault();
    if (!branchLineageId || !branchName.trim() || !canEditPeople) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/lineages/${branchLineageId}/branches`, {
        method: 'POST',
        body: JSON.stringify({ name: branchName.trim() }),
      });
      setBranchName('');
      setNotice('🌱 Шинэ салаа мөчир бүртгэгдлээ.');
      await loadData();
    } catch (cause) {
      setError(friendlyError(cause, 'Салаа үүсгэхэд алдаа гарлаа.'));
    } finally {
      setActionBusy(false);
    }
  };

  if (!selectedFamily) return null;

  const filterBar = (
    <div className="admin-filter-row" role="group" aria-label="Дата бүрэн байдлын шүүлтүүр">
      <button
        type="button"
        onClick={() => setQualityFilter('all')}
        className={`admin-filter-pill ${qualityFilter === 'all' ? 'is-active' : ''}`}
      >
        ✨ Бүгд ({qualityCounts.all})
      </button>
      <button
        type="button"
        onClick={() => setQualityFilter('missing_birth')}
        className={`admin-filter-pill ${qualityFilter === 'missing_birth' ? 'is-active' : ''}`}
      >
        🎂 Огноо дутуу ({qualityCounts.missing_birth})
      </button>
      <button
        type="button"
        onClick={() => setQualityFilter('missing_gender')}
        className={`admin-filter-pill ${qualityFilter === 'missing_gender' ? 'is-active' : ''}`}
      >
        ❓ Хүйс тодорхойгүй ({qualityCounts.missing_gender})
      </button>
      <button
        type="button"
        onClick={() => setQualityFilter('isolated')}
        className={`admin-filter-pill ${qualityFilter === 'isolated' ? 'is-active' : ''}`}
      >
        🔗 Холбоосгүй ({qualityCounts.isolated})
      </button>
    </div>
  );

  return (
    <div className="admin-section-stack">
      <div className="admin-subnav" role="tablist" aria-label="Хүмүүс ба ураг төрлийн дэд хэсгүүд">
        <button
          type="button"
          onClick={() => setSubView('people')}
          className={`homev2-button admin-subtab-btn ${subView === 'people' ? 'homev2-button--primary' : 'homev2-button--light'}`}
        >
          🌳 Хүмүүсийн бүртгэл ({people.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('relationships')}
          className={`homev2-button admin-subtab-btn ${subView === 'relationships' ? 'homev2-button--primary' : 'homev2-button--light'}`}
        >
          💍 Ураг ба Гэрлэлт ({parentChildEdges.length + marriages.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('lineages')}
          className={`homev2-button admin-subtab-btn ${subView === 'lineages' ? 'homev2-button--primary' : 'homev2-button--light'}`}
        >
          🌿 Удам угсаа ба Салаа ({lineages.length})
        </button>
      </div>

      {!canEditPeople && (
        <div className="admin-alert-notice">
          👁️ Танд одоогоор зөвхөн унших эрх байна — хүн/ураг засахын тулд &quot;🌳 Хүмүүс &amp; Ураг төрөл&quot; админ эрх шаардлагатай.
        </div>
      )}

      {(subView === 'people' || subView === 'relationships') && (
        <AdminPeopleSection
          activeTab={subView}
          selectedFamilyId={selectedFamilyId}
          people={people}
          filteredPeople={filteredPeople}
          marriages={marriages}
          duplicateCandidates={duplicateCandidates}
          isAdmin={canEditPeople}
          actionBusy={actionBusy}
          detailLoading={loading}
          personSearch={personSearch}
          setPersonSearch={setPersonSearch}
          filterBar={filterBar}
          showAddPerson={showAddPerson}
          setShowAddPerson={setShowAddPerson}
          newPersonLastName={newPersonLastName}
          setNewPersonLastName={setNewPersonLastName}
          newPersonFirstName={newPersonFirstName}
          setNewPersonFirstName={setNewPersonFirstName}
          newPersonGender={newPersonGender}
          setNewPersonGender={setNewPersonGender}
          newPersonBirthDate={newPersonBirthDate}
          setNewPersonBirthDate={setNewPersonBirthDate}
          newPersonIsAlive={newPersonIsAlive}
          setNewPersonIsAlive={setNewPersonIsAlive}
          newPersonDeathDate={newPersonDeathDate}
          setNewPersonDeathDate={setNewPersonDeathDate}
          newPersonLineage={newPersonLineage}
          setNewPersonLineage={setNewPersonLineage}
          handleAddPerson={handleAddPerson}
          editingPerson={editingPerson}
          setEditingPerson={setEditingPerson}
          openEditPerson={openEditPerson}
          editLastName={editLastName}
          setEditLastName={setEditLastName}
          editFirstName={editFirstName}
          setEditFirstName={setEditFirstName}
          editGender={editGender}
          setEditGender={setEditGender}
          editBirthDate={editBirthDate}
          setEditBirthDate={setEditBirthDate}
          editBirthPlace={editBirthPlace}
          setEditBirthPlace={setEditBirthPlace}
          editShortDescription={editShortDescription}
          setEditShortDescription={setEditShortDescription}
          editVisibility={editVisibility}
          setEditVisibility={setEditVisibility}
          editIsAlive={editIsAlive}
          setEditIsAlive={setEditIsAlive}
          editDeathDate={editDeathDate}
          setEditDeathDate={setEditDeathDate}
          handleUpdatePerson={handleUpdatePerson}
          handleDeletePerson={handleDeletePerson}
          onMergeDuplicate={handleMergeDuplicate}
          onOpenWizard={(anchorId, role) => {
            setWizardAnchorId(anchorId);
            setWizardRole(role);
            setWizardOpen(true);
          }}
          relParentId={relParentId}
          setRelParentId={setRelParentId}
          relChildId={relChildId}
          setRelChildId={setRelChildId}
          handleAddParentChild={handleAddParentChild}
          parentChildEdges={parentChildEdges}
          handleDeleteParentChild={handleDeleteParentChild}
          marriageP1={marriageP1}
          setMarriageP1={setMarriageP1}
          marriageP2={marriageP2}
          setMarriageP2={setMarriageP2}
          marriageStartDate={marriageStartDate}
          setMarriageStartDate={setMarriageStartDate}
          handleAddMarriage={handleAddMarriage}
          handleDeleteMarriage={handleDeleteMarriage}
        />
      )}

      {subView === 'lineages' && (
        <div className="families-main-card">
          <h3 className="admin-card-title" style={{ marginBottom: 14 }}>
            🌿 Удам угсаа ба Салаа мөчрүүд ({lineages.length})
          </h3>

          {canEditPeople && (
            <div className="admin-form-grid" style={{ marginBottom: 20 }}>
              <form onSubmit={handleCreateLineage} className="admin-inline-form" style={{ marginBottom: 0 }}>
                <h4 className="admin-form-heading">✨ Шинэ Удам угсаа нэмэх</h4>
                <label className="admin-field-label" style={{ marginBottom: 10 }}>
                  Удам угсааны нэр *
                  <input
                    value={lineageName}
                    onChange={(e) => setLineageName(e.target.value)}
                    placeholder="Ж: Хиад Боржигон"
                    required
                    className="admin-field-input"
                  />
                </label>
                <label className="admin-field-label" style={{ marginBottom: 12 }}>
                  Тайлбар
                  <input
                    value={lineageDesc}
                    onChange={(e) => setLineageDesc(e.target.value)}
                    placeholder="Үүсэл гарал, онцлог"
                    className="admin-field-input"
                  />
                </label>
                <button
                  type="submit"
                  disabled={actionBusy}
                  className="homev2-button homev2-button--primary"
                  style={{ fontSize: 12, padding: '8px 16px' }}
                >
                  + Удам угсаа үүсгэх
                </button>
              </form>

              <form onSubmit={handleCreateBranch} className="admin-inline-form" style={{ marginBottom: 0 }}>
                <h4 className="admin-form-heading">🌱 Салаа мөчир нэмэх</h4>
                <label className="admin-field-label" style={{ marginBottom: 10 }}>
                  Удам угсаа сонгох *
                  <select
                    value={branchLineageId}
                    onChange={(e) => setBranchLineageId(e.target.value)}
                    disabled={!lineages.length}
                    className="admin-field-input"
                  >
                    {!lineages.length && <option value="">Эхлээд удам угсаа үүсгэнэ үү</option>}
                    {lineages.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field-label" style={{ marginBottom: 12 }}>
                  Салааны нэр *
                  <input
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="Ж: Баруун салаа"
                    required
                    disabled={!lineages.length}
                    className="admin-field-input"
                  />
                </label>
                <button
                  type="submit"
                  disabled={actionBusy || !lineages.length}
                  className="homev2-button homev2-button--primary"
                  style={{ fontSize: 12, padding: '8px 16px' }}
                >
                  + Салаа нэмэх
                </button>
              </form>
            </div>
          )}

          {lineages.length > 0 ? (
            <div className="admin-lineage-grid">
              {lineages.map((lin) => (
                <div key={lin.id} className="admin-lineage-card">
                  <strong style={{ fontSize: 15, color: 'var(--ui-text)' }}>🌿 {lin.name}</strong>
                  {lin.description && (
                    <span className="admin-muted-text">{lin.description}</span>
                  )}
                  <div className="admin-branch-list">
                    {(branchesByLineage[lin.id] ?? []).length > 0 ? (
                      branchesByLineage[lin.id].map((br) => (
                        <span key={br.id} className="admin-perm-chip">
                          🌱 {br.name}
                        </span>
                      ))
                    ) : (
                      <span className="admin-muted-text">Салаа хараахан бүртгэгдээгүй</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="admin-muted-text">Одоогоор бүртгэгдсэн удам угсаа алга байна.</p>
          )}
        </div>
      )}

      <PedigreeWizardModal
        familyId={selectedFamilyId}
        people={people}
        marriages={marriages}
        parentChildEdges={parentChildEdges}
        initialAnchorPersonId={wizardAnchorId}
        initialRole={wizardRole}
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={async (_newPerson, msg) => {
          setWizardOpen(false);
          setNotice(msg);
          await Promise.all([loadData(), refreshOverview()]);
        }}
      />

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        busy={actionBusy}
        onConfirm={() => void confirmState.onConfirm()}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
