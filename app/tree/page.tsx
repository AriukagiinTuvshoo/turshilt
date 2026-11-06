'use client';

import Link from 'next/link';
import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  api,
  Family,
  Marriage,
  Person,
  PersonSearchPage,
  personName,
  TreeData,
  TreePerson,
  KinshipResult,
} from '../../lib/api';
import {
  AdvancedTreeLayout,
  buildAdvancedTreeLayout,
  TREE_NODE_WIDTH,
  TREE_NODE_HEIGHT,
  LayoutNode,
} from '../../lib/tree-layout';
import { TreeDrawer } from './tree-drawer';
import { TreeExportModal } from '../../components/tree-export-modal';
import { PedigreeWizardModal, RelativeRole } from '../../components/pedigree-wizard-modal';

type RelationKind = 'parent' | 'child' | 'spouse';
export type BloodlineMode = 'none' | 'all' | 'paternal' | 'maternal' | 'descendants';

interface BloodlineHighlight {
  ancestorIds: Set<string>;
  descendantIds: Set<string>;
  paternalIds: Set<string>;
  maternalIds: Set<string>;
  spouseIds: Set<string>;
  activeIds: Set<string>;
}

const EMPTY_TREE: TreeData = {
  persons: [],
  parent_child_relationships: [],
  marriages: [],
};

function initials(person: Pick<TreePerson, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function lifeSummary(person: TreePerson) {
  const birth = person.birth_date?.slice(0, 4);
  const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return birth + ' – ' + death;
  if (birth) return person.is_alive ? birth + ' – одоо' : birth + ' – ?';
  return 'Огноо тодорхойгүй';
}

function generationLabel(generation: number) {
  return generation === 0 ? 'Төв үе' : generation < 0 ? Math.abs(generation) + ' үеийн өмнө' : generation + ' үеийн үргэлжлэл';
}

function treeFriendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай. Дахин нэвтэрнэ үү.';
    if (cause.status === 403) return 'Энэ удмын модонд хандах эрхгүй байна.';
    if (cause.status === 404) return 'Удмын мод эсвэл сонгосон хүн олдсонгүй.';
    if (cause.status === 409) return 'Энэ үйлдэл одоогоор зөрчилтэй байна. Дахин оролдоно уу.';
    if (cause.status === 422) return 'Удмын модны хүсэлт буруу байна. Дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон хүсэлт байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 503) return 'Удмын модны үйлчилгээ түр боломжгүй байна. Дараа дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}

function relationshipStatusLabel(status: Marriage['status']) {
  if (status === 'married') return 'Идэвхтэй';
  if (status === 'divorced') return 'Салсан';
  return 'Бэлэвсэн';
}

function marriagePartnerId(marriage: Marriage, personId: string) {
  return marriage.person_1_id === personId ? marriage.person_2_id : marriage.person_1_id;
}

function TreePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedFamilyId = searchParams.get('family') ?? '';
  const requestedPersonId = searchParams.get('person') ?? '';

  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [tree, setTree] = useState<TreeData | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [depth, setDepth] = useState(3);
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noFamily, setNoFamily] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [searchPage, setSearchPage] = useState<PersonSearchPage | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchPageNumber, setSearchPageNumber] = useState(1);
  const [relation, setRelation] = useState<RelationKind | null>(null);
  const [relationError, setRelationError] = useState('');

  // Kinship Modal State
  const [kinshipOpen, setKinshipOpen] = useState(false);
  const [kinshipPerson1Id, setKinshipPerson1Id] = useState('');
  const [kinshipPerson2Id, setKinshipPerson2Id] = useState('');
  const [kinshipLoading, setKinshipLoading] = useState(false);
  const [kinshipError, setKinshipError] = useState('');
  const [kinshipResult, setKinshipResult] = useState<KinshipResult | null>(null);

  // Bloodline Highlight & Interaction States
  const [bloodlineMode, setBloodlineMode] = useState<BloodlineMode>('none');
  const [isDraggingActive, setIsDraggingActive] = useState(false);

  // Vector Print & Export Modal State
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // Pedigree Wizard Modal State
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAnchorId, setWizardAnchorId] = useState<string | null>(null);
  const [wizardRole, setWizardRole] = useState<RelativeRole>('son');

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  const loadSequence = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const persistSelected = useCallback(
    (personId: string) => {
      setSelectedId(personId);
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      if (personId) params.set('person', personId);
      else params.delete('person');
      window.history.replaceState(null, '', '/tree?' + params.toString());
    },
    [],
  );

  const loadTree = useCallback(
    async (id: string, preferredPersonId?: string, nextDepth = 3) => {
      const sequence = ++loadSequence.current;
      loadAbort.current?.abort();
      const controller = new AbortController();
      loadAbort.current = controller;

      setLoading(true);
      setError('');
      setNotice('');
      setFamilyId(id);
      setFamily(null);
      setTree(null);
      setSelectedId('');
      setSearchPage(null);
      setRelation(null);

      try {
        const familyData = await api<Family>('/families/' + encodeURIComponent(id), {
          signal: controller.signal,
        });
        if (sequence !== loadSequence.current) return;

        let treeData: TreeData;
        const treeBase = '/families/' + encodeURIComponent(id) + '/tree?depth=' + String(nextDepth);
        try {
          const query = preferredPersonId
            ? treeBase + '&person_id=' + encodeURIComponent(preferredPersonId)
            : treeBase;
          treeData = await api<TreeData>(query, { signal: controller.signal });
        } catch (cause) {
          if (
            preferredPersonId &&
            cause instanceof ApiError &&
            (cause.status === 404 || cause.status === 422) &&
            sequence === loadSequence.current
          ) {
            treeData = await api<TreeData>(treeBase, { signal: controller.signal });
          } else {
            throw cause;
          }
        }

        if (sequence !== loadSequence.current || controller.signal.aborted) return;

        setFamily(familyData);
        setTree(treeData);
        const preferredIsAvailable =
          Boolean(preferredPersonId) &&
          treeData.persons.some((person) => person.id === preferredPersonId);
        const backendRootIsAvailable =
          Boolean(treeData.root_person_id) &&
          treeData.persons.some((person) => person.id === treeData.root_person_id);

        // Never substitute an unrelated Person when a requested Person is unavailable.
        // Only the backend-provided root is eligible as the initial selection.
        const nextSelectedId = preferredPersonId
          ? preferredIsAvailable
            ? preferredPersonId
            : ''
          : backendRootIsAvailable
            ? treeData.root_person_id ?? ''
            : '';

        persistSelected(nextSelectedId);
      } catch (cause) {
        if (sequence !== loadSequence.current || controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(treeFriendlyError(cause, 'Удмын модыг ачаалж чадсангүй.'));
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [persistSelected, router],
  );

  useEffect(() => {
    let active = true;

    if (requestedFamilyId) {
      void loadTree(requestedFamilyId, requestedPersonId || undefined);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError('');
    setNoFamily(false);

    api<Family[]>('/families')
      .then((families) => {
        if (!active) return;
        if (!families.length) {
          setFamilyId('');
          setFamily(null);
          setTree(EMPTY_TREE);
          setSelectedId('');
          setNoFamily(true);
          setLoading(false);
          return;
        }
        const nextFamilyId = families[0].id;
        router.replace('/tree?family=' + encodeURIComponent(nextFamilyId));
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(treeFriendlyError(cause, 'Гэр бүлийн орчныг ачаалж чадсангүй.'));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadTree, requestedFamilyId, requestedPersonId, router]);

  useEffect(() => {
    return () => {
      loadAbort.current?.abort();
      searchAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    const query = search.trim();
    searchAbort.current?.abort();

    if (!familyId || !query) {
      searchSequence.current += 1;
      setSearchPage(null);
      setSearchBusy(false);
      return;
    }

    const sequence = ++searchSequence.current;
    const controller = new AbortController();
    searchAbort.current = controller;

    const timer = window.setTimeout(() => {
      setSearchBusy(true);
      api<PersonSearchPage>(
        '/families/' +
          encodeURIComponent(familyId) +
          '/persons/search?q=' +
          encodeURIComponent(query) +
          '&page=1&page_size=25',
        { signal: controller.signal },
      )
        .then((result) => {
          if (sequence !== searchSequence.current || controller.signal.aborted) return;
          setSearchPage(result);
          setSearchPageNumber(1);
        })
        .catch((cause) => {
          if (sequence !== searchSequence.current || controller.signal.aborted) return;
          if (cause instanceof ApiError && cause.status === 401) {
            router.replace('/login');
            return;
          }
          setError(treeFriendlyError(cause, 'Хайлт хийхэд алдаа гарлаа.'));
        })
        .finally(() => {
          if (sequence === searchSequence.current) setSearchBusy(false);
        });
    }, 260);

    return () => window.clearTimeout(timer);
  }, [familyId, router, search]);

  const layout: AdvancedTreeLayout = useMemo(
    () => buildAdvancedTreeLayout(tree ?? EMPTY_TREE),
    [tree],
  );

  const nodeById = layout.nodeById;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.tree-person-card, button, a, select, input, label')) {
      return;
    }
    isDragging.current = true;
    setIsDraggingActive(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({
      x: Math.round(panStart.current.x + dx),
      y: Math.round(panStart.current.y + dy),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) {
      isDragging.current = false;
      setIsDraggingActive(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      setZoom((prev) => Math.max(0.4, Math.min(2.0, Number((prev + delta).toFixed(2)))));
    }
  };

  const resetView = () => {
    setZoom(0.9);
    setPan({ x: 0, y: 0 });
  };

  const centerOnPerson = (personId: string) => {
    const node = layout.nodeById.get(personId);
    if (node && scrollRef.current) {
      const container = scrollRef.current;
      const targetX = -(node.x + node.width / 2) * zoom + container.clientWidth / 2;
      const targetY = -(node.y + node.height / 2) * zoom + container.clientHeight / 2;
      setPan({ x: Math.round(targetX), y: Math.round(targetY) });
    }
  };

  const calculateKinship = async () => {
    if (!familyId || !kinshipPerson1Id || !kinshipPerson2Id) return;
    setKinshipLoading(true);
    setKinshipError('');
    setKinshipResult(null);
    try {
      const res = await api<KinshipResult>(
        `/families/${encodeURIComponent(familyId)}/kinship?person_1_id=${encodeURIComponent(kinshipPerson1Id)}&person_2_id=${encodeURIComponent(kinshipPerson2Id)}`,
      );
      setKinshipResult(res);
    } catch (err) {
      setKinshipError(treeFriendlyError(err, 'Ураг төрлийн хамаарлыг тооцоолоход алдаа гарлаа.'));
    } finally {
      setKinshipLoading(false);
    }
  };

  const selectedPerson = selectedId
    ? tree?.persons.find((person) => person.id === selectedId) ?? null
    : null;

  const hasBackendRoot =
    Boolean(tree?.root_person_id) &&
    Boolean(tree?.persons.some((person) => person.id === tree.root_person_id));

  useEffect(() => {
    if (!selectedId || !tree || loading) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById('tree-person-' + selectedId);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, selectedId, tree]);

  const relationCounts = useMemo(() => {
    const parents = new Map<string, number>();
    const children = new Map<string, number>();
    const spouses = new Map<string, number>();

    for (const edge of tree?.parent_child_relationships ?? []) {
      parents.set(edge.child_id, (parents.get(edge.child_id) ?? 0) + 1);
      children.set(edge.parent_id, (children.get(edge.parent_id) ?? 0) + 1);
    }

    for (const marriage of tree?.marriages ?? []) {
      spouses.set(
        marriage.person_1_id,
        (spouses.get(marriage.person_1_id) ?? 0) + 1,
      );
      spouses.set(
        marriage.person_2_id,
        (spouses.get(marriage.person_2_id) ?? 0) + 1,
      );
    }

    return { parents, children, spouses };
  }, [tree]);

  const bloodline = useMemo<BloodlineHighlight>(() => {
    const result: BloodlineHighlight = {
      ancestorIds: new Set(),
      descendantIds: new Set(),
      paternalIds: new Set(),
      maternalIds: new Set(),
      spouseIds: new Set(),
      activeIds: new Set(),
    };

    if (!tree || !selectedId || bloodlineMode === 'none') {
      return result;
    }

    const childToParents = new Map<string, string[]>();
    const parentToChildren = new Map<string, string[]>();
    const personMap = new Map<string, TreePerson>();

    for (const p of tree.persons) {
      personMap.set(p.id, p);
    }

    for (const rel of tree.parent_child_relationships) {
      const pList = childToParents.get(rel.child_id) ?? [];
      pList.push(rel.parent_id);
      childToParents.set(rel.child_id, pList);

      const cList = parentToChildren.get(rel.parent_id) ?? [];
      cList.push(rel.child_id);
      parentToChildren.set(rel.parent_id, cList);
    }

    for (const m of tree.marriages) {
      if (m.person_1_id === selectedId) result.spouseIds.add(m.person_2_id);
      if (m.person_2_id === selectedId) result.spouseIds.add(m.person_1_id);
    }

    // BFS Ancestors
    const queueAncestors = [...(childToParents.get(selectedId) ?? [])];
    while (queueAncestors.length > 0) {
      const cur = queueAncestors.shift()!;
      if (!result.ancestorIds.has(cur)) {
        result.ancestorIds.add(cur);
        const nextParents = childToParents.get(cur) ?? [];
        for (const np of nextParents) queueAncestors.push(np);
      }
    }

    // BFS Descendants
    const queueDescendants = [...(parentToChildren.get(selectedId) ?? [])];
    while (queueDescendants.length > 0) {
      const cur = queueDescendants.shift()!;
      if (!result.descendantIds.has(cur)) {
        result.descendantIds.add(cur);
        const nextChildren = parentToChildren.get(cur) ?? [];
        for (const nc of nextChildren) queueDescendants.push(nc);
      }
    }

    // Paternal Line (Эцгийн ураг)
    let currFather: string | undefined = childToParents
      .get(selectedId)
      ?.find((pid) => personMap.get(pid)?.gender === 'male');
    while (currFather) {
      result.paternalIds.add(currFather);
      currFather = childToParents
        .get(currFather)
        ?.find((pid) => personMap.get(pid)?.gender === 'male');
    }
    for (const d of result.descendantIds) {
      result.paternalIds.add(d);
    }

    // Maternal Line (Эхийн тал)
    const directMother = childToParents
      .get(selectedId)
      ?.find((pid) => personMap.get(pid)?.gender === 'female');
    if (directMother) {
      result.maternalIds.add(directMother);
      const qM = [directMother];
      while (qM.length > 0) {
        const cur = qM.shift()!;
        for (const pid of childToParents.get(cur) ?? []) {
          if (!result.maternalIds.has(pid)) {
            result.maternalIds.add(pid);
            qM.push(pid);
          }
        }
      }
    }

    // Combine into activeIds based on chosen mode
    if (bloodlineMode === 'all') {
      result.activeIds.add(selectedId);
      result.ancestorIds.forEach((id) => result.activeIds.add(id));
      result.descendantIds.forEach((id) => result.activeIds.add(id));
      result.spouseIds.forEach((id) => result.activeIds.add(id));
    } else if (bloodlineMode === 'paternal') {
      result.activeIds.add(selectedId);
      result.paternalIds.forEach((id) => result.activeIds.add(id));
    } else if (bloodlineMode === 'maternal') {
      result.activeIds.add(selectedId);
      result.maternalIds.forEach((id) => result.activeIds.add(id));
    } else if (bloodlineMode === 'descendants') {
      result.activeIds.add(selectedId);
      result.descendantIds.forEach((id) => result.activeIds.add(id));
    }

    return result;
  }, [tree, selectedId, bloodlineMode]);

  const selectedMarriages = useMemo(
    () =>
      tree?.marriages.filter(
        (marriage) =>
          marriage.person_1_id === selectedId || marriage.person_2_id === selectedId,
      ) ?? [],
    [selectedId, tree],
  );

  const selectedParents =
    tree?.parent_child_relationships.filter((edge) => edge.child_id === selectedId) ?? [];
  const selectedChildren =
    tree?.parent_child_relationships.filter((edge) => edge.parent_id === selectedId) ?? [];

  const spouseNames = useMemo(() => {
    if (!tree || !selectedId) return [];
    return selectedMarriages
      .map((marriage) => tree.persons.find((person) => person.id === marriagePartnerId(marriage, selectedId)))
      .filter((person): person is TreePerson => Boolean(person))
      .map((person) => personName(person));
  }, [selectedId, selectedMarriages, tree]);

  function selectPerson(personId: string) {
    if (!tree?.persons.some((person) => person.id === personId)) return;
    persistSelected(personId);
  }

  function profileHref(personId: string) {
    return (
      '/profile?family=' +
      encodeURIComponent(familyId) +
      '&person=' +
      encodeURIComponent(personId)
    );
  }

  function focusSelected() {
    if (!selectedId) return;
    const element = document.getElementById('tree-person-' + selectedId);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }

  async function loadMoreSearch() {
    if (!searchPage?.has_next || !familyId || searchBusy) return;

    const sequence = ++searchSequence.current;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const nextPage = searchPageNumber + 1;
    setSearchBusy(true);

    try {
      const next = await api<PersonSearchPage>(
        '/families/' +
          encodeURIComponent(familyId) +
          '/persons/search?q=' +
          encodeURIComponent(search.trim()) +
          '&page=' +
          String(nextPage) +
          '&page_size=25',
        { signal: controller.signal },
      );
      if (sequence !== searchSequence.current || controller.signal.aborted) return;
      setSearchPage((current) =>
        current ? { ...next, items: [...current.items, ...next.items] } : next,
      );
      setSearchPageNumber(nextPage);
    } catch (cause) {
      if (sequence !== searchSequence.current || controller.signal.aborted) return;
      setError(treeFriendlyError(cause, 'Хайлтын үр дүнг ачаалж чадсангүй.'));
    } finally {
      if (sequence === searchSequence.current) setSearchBusy(false);
    }
  }

  async function selectSearchResult(personId: string) {
    if (!familyId) return;
    setSearchPage(null);
    setSearch('');
    await loadTree(familyId, personId, depth);
  }

  async function addRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!relation || !selectedId || !familyId) return;

    setRelationError('');
    setError('');
    const form = new FormData(event.currentTarget);
    const existingId = String(form.get('existing') ?? '');

    try {
      let relatedId = existingId;
      if (!relatedId) {
        const fullName = String(form.get('name') ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const created = await api<Person>(
          '/families/' + encodeURIComponent(familyId) + '/persons',
          {
            method: 'POST',
            body: JSON.stringify({
              first_name: fullName.at(-1) ?? '',
              last_name: fullName.slice(0, -1).join(' '),
              gender: form.get('gender'),
              visibility: 'family',
            }),
          },
        );
        relatedId = created.id;
      }

      if (relation === 'spouse') {
        await api(
          '/families/' + encodeURIComponent(familyId) + '/marriages',
          {
            method: 'POST',
            body: JSON.stringify({
              person_1_id: selectedId,
              person_2_id: relatedId,
              status: 'married',
              start_date: form.get('start_date') || null,
            }),
          },
        );
      } else {
        await api(
          '/families/' +
            encodeURIComponent(familyId) +
            '/relationships/parent-child',
          {
            method: 'POST',
            body: JSON.stringify({
              parent_id: relation === 'parent' ? relatedId : selectedId,
              child_id: relation === 'parent' ? selectedId : relatedId,
              relationship_type: form.get('relationship_type'),
            }),
          },
        );
      }

      setRelation(null);
      setNotice('Гэр бүлийн холбоо хадгалагдлаа.');
      await loadTree(familyId, selectedId, depth);
    } catch (cause) {
      setRelationError(
        cause instanceof Error
          ? cause.message
          : 'Холбоог хадгалж чадсангүй.',
      );
    }
  }

  async function divorce(marriageId: string) {
    if (!familyId || !selectedId) return;
    const endDate = window.prompt(
      'Салсан огноо (YYYY-MM-DD). Мэдэхгүй бол хоосон үлдээнэ үү.',
    );
    if (endDate === null) return;

    try {
      await api(
        '/families/' +
          encodeURIComponent(familyId) +
          '/marriages/' +
          encodeURIComponent(marriageId),
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'divorced',
            end_date: endDate || null,
          }),
        },
      );
      setNotice('Гэрлэлтийн мэдээлэл шинэчлэгдлээ.');
      await loadTree(familyId, selectedId, depth);
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Гэрлэлтийн мэдээллийг шинэчилж чадсангүй.'));
    }
  }

  if (noFamily) {
    return (
      <main className="tree-page">
        <section className="tree-state tree-state--empty">
          <div className="tree-state-mark" aria-hidden="true">🌳</div>
          <p className="tree-eyebrow">ГУУЛИНГИЙНХАН · УДМЫН МОД</p>
          <h1>Гэр бүлийн орчин олдсонгүй.</h1>
          <p>Таны эрхтэй гэр бүл байхгүй тул удмын модыг нээх боломжгүй байна.</p>
          <Link className="tree-button tree-button--primary" href="/families">Гэр бүлүүд</Link>
        </section>
      </main>
    );
  }

  if (loading && !tree) {
    return (
      <main className="tree-page">
        <section className="tree-shell">
          <div className="tree-page-header tree-skeleton-header" aria-hidden="true">
            <div className="tree-skeleton tree-skeleton--title" />
            <div className="tree-skeleton tree-skeleton--control" />
          </div>
          <div className="tree-loading-scene" role="status" aria-live="polite">
            <div className="tree-loading-tree" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <strong>Удмын модыг ачаалж байна…</strong>
            <small>Гэр бүлийн зөвшөөрөгдсөн хүмүүс болон холбоосуудыг татаж байна.</small>
          </div>
        </section>
      </main>
    );
  }

  if (error && !tree) {
    return (
      <main className="tree-page">
        <section className="tree-state tree-state--empty">
          <div className="tree-state-mark" aria-hidden="true">!</div>
          <p className="tree-eyebrow">ГУУЛИНГИЙНХАН · УДМЫН МОД</p>
          <h1>Удмын модыг ачаалж чадсангүй.</h1>
          <p>{error}</p>
          <button
            type="button"
            className="tree-button tree-button--primary"
            onClick={() => {
              const retryFamilyId = requestedFamilyId || familyId;
              if (retryFamilyId) {
                void loadTree(retryFamilyId, requestedPersonId || selectedId || undefined, depth);
                return;
              }
              api<Family[]>('/families')
                .then((families) => {
                  const nextFamilyId = families[0]?.id;
                  if (!nextFamilyId) {
                    setNoFamily(true);
                    setLoading(false);
                    return;
                  }
                  router.replace('/tree?family=' + encodeURIComponent(nextFamilyId));
                })
                .catch((cause) => {
                  setError(treeFriendlyError(cause, 'Гэр бүлийн орчныг ачаалж чадсангүй.'));
                });
            }}
          >
            Дахин оролдох
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="tree-page">
      <section className="tree-shell">
        <header className="tree-page-header">
          <div>
            <Link className="tree-back-link" href={'/dashboard?family=' + encodeURIComponent(familyId)}>
              ← Гэр бүлийн тойм
            </Link>
            <p className="tree-eyebrow">
              <span className="tree-mongolian-script" style={{ fontFamily: 'Georgia, serif', color: '#d4af37', marginRight: '8px', fontSize: '13px', letterSpacing: '1px' }}>
                ᠮᠣᠩᠭᠣᠯ ᠤᠷᠤᠭ ᠤᠨ ᠪᠢᠴᠢᠭ
              </span>
              ГУУЛИНГИЙНХАН · УДМЫН МОД
            </p>
            <h1>{family?.name ?? 'Удмын мод'}</h1>
            <p className="tree-lede">
              Удам, гэрлэлт, үеийн холбоосыг зөвхөн таны хандах эрхтэй бодит гэр бүлийн мэдээллээр харуулна.
            </p>
          </div>

          <div className="tree-header-actions">
            {Boolean(family && (family.role === 'owner' || family.role === 'editor')) && (
              <button
                type="button"
                className="tree-button tree-button--primary"
                onClick={() => {
                  setWizardAnchorId(selectedPerson?.id || null);
                  setWizardRole(selectedPerson ? 'son' : 'standalone');
                  setWizardOpen(true);
                }}
                style={{
                  background: 'linear-gradient(135deg, #059669, #047857)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(5, 150, 105, 0.28)',
                }}
              >
                🌿 + Хүн / Ураг нэмэх
              </button>
            )}
            <button
              type="button"
              className="tree-button tree-button--primary tree-export-trigger-btn"
              onClick={() => setExportModalOpen(true)}
              style={{
                background: 'linear-gradient(135deg, #d97706, #b45309)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(217, 119, 6, 0.28)',
              }}
            >
              🖨️ Хананд хэвлэх (Вектор / PDF)
            </button>
            <Link
              className="tree-button tree-button--secondary"
              href={'/people?family=' + encodeURIComponent(familyId)}
            >
              Хүмүүс
            </Link>
            <button type="button" className="tree-button tree-button--secondary" onClick={focusSelected} disabled={!selectedId}>
              Сонгосон хүнийг төвд
            </button>
          </div>
        </header>

        {error && (
          <div className="tree-alert tree-alert--error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadTree(familyId, selectedId || undefined, depth)}>
              Дахин оролдох
            </button>
          </div>
        )}

        {notice && (
          <div className="tree-alert tree-alert--success" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Мэдэгдлийг хаах">×</button>
          </div>
        )}

        <section className="tree-workspace" aria-label="Удмын модны ажлын хэсэг">
          <div className="tree-workspace-top">
            <div className="tree-stats" aria-live="polite">
              <strong>{tree?.persons.length ?? 0}</strong><span>хүн</span>
              <i aria-hidden="true">·</i>
              <strong>{tree?.marriages.length ?? 0}</strong><span>гэрлэлт</span>
              {tree?.meta?.truncated ? <em>Хэсэгчлэн ачаалсан</em> : null}
            </div>

            <div className="tree-controls">
              <label className="tree-bloodline-select" title="Сонгосон хүний удам угсаа, үр садыг онцлон тодруулах">
                <span>✨ Удам</span>
                <select
                  value={bloodlineMode}
                  onChange={(event) => setBloodlineMode(event.target.value as BloodlineMode)}
                  disabled={!selectedId}
                  aria-label="Удам угсаа гэрэлтүүлэх горим"
                >
                  <option value="none">Энгийн горим</option>
                  <option value="all">🌟 Бүх шугам (Удам + Үр сад)</option>
                  <option value="paternal">👑 Эцгийн ураг (Ясан төрөл)</option>
                  <option value="maternal">🌸 Эхийн тал (Цусан төрөл)</option>
                  <option value="descendants">🌱 Үр удам (Хүүхдүүд, ач нар)</option>
                </select>
              </label>

              {bloodlineMode !== 'none' && selectedPerson && (
                <span className="tree-bloodline-status" title="Гэрэлтэж буй хүний тоо">
                  <strong>{bloodline.activeIds.size}</strong> хүн
                </span>
              )}

              <label>
                <span>Хүрээ</span>
                <select
                  value={depth}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setDepth(next);
                    void loadTree(familyId, selectedId || undefined, next);
                  }}
                >
                  <option value={1}>1 үе</option>
                  <option value={2}>2 үе</option>
                  <option value={3}>3 үе</option>
                  <option value={4}>4 үе</option>
                  <option value={5}>5 үе</option>
                </select>
              </label>

              <div className="tree-zoom" aria-label="Модны хэмжээ">
                <button
                  type="button"
                  onClick={() => setZoom((value) => Math.max(0.4, Number((value - 0.1).toFixed(2))))}
                  aria-label="Жижигрүүлэх"
                >
                  −
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((value) => Math.min(2.0, Number((value + 0.1).toFixed(2))))}
                  aria-label="Томруулах"
                >
                  +
                </button>
                <button type="button" onClick={resetView}>Тэгшлэх</button>
                {selectedId && (
                  <button type="button" onClick={() => centerOnPerson(selectedId)}>Төвлөрөх</button>
                )}
                <button
                  type="button"
                  onClick={() => setIsFullscreen((prev) => !prev)}
                  title={isFullscreen ? 'Цонхыг хэвийн болгох' : 'Дэлгэц дүүргэх'}
                  style={{
                    padding: '0 10px',
                    borderLeft: '1px solid #e0d7c6',
                    background: isFullscreen ? '#fef3c7' : 'transparent',
                    color: isFullscreen ? '#92400e' : '#53655b',
                    fontWeight: 600,
                  }}
                >
                  {isFullscreen ? '🗗 Буцах' : '⛶ Бүтэн дэлгэц'}
                </button>
                <button
                  type="button"
                  style={{
                    marginLeft: '8px',
                    padding: '0 14px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #d97706, #b45309)',
                    color: '#ffffff',
                    fontWeight: 600,
                    border: 'none',
                    boxShadow: '0 2px 6px rgba(217, 119, 6, 0.25)',
                  }}
                  onClick={() => {
                    if (selectedId) setKinshipPerson1Id(selectedId);
                    setKinshipOpen(true);
                  }}
                >
                  🧬 Ураг холбоо шалгах
                </button>
              </div>
            </div>
          </div>

          <div className="tree-search-wrap">
            <label className="tree-search">
              <span>Гэр бүлийн хүн хайх</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Нэрээр хайх…"
                autoComplete="off"
                spellCheck={false}
                aria-label="Гэр бүлийн хүн хайх"
              />
            </label>

            {searchBusy && <span className="tree-search-status" role="status">Хайж байна…</span>}

            {search.trim() && searchPage && (
              <section className="tree-search-results" aria-label="Хайлтын үр дүн">
                <div className="tree-search-results-head">
                  <strong>{searchPage.total} үр дүн</strong>
                  <button type="button" onClick={() => { setSearch(''); setSearchPage(null); }}>Хаах</button>
                </div>
                {searchPage.items.length === 0 ? (
                  <p>Тохирох хүн олдсонгүй.</p>
                ) : (
                  <div className="tree-search-result-list">
                    {searchPage.items.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => void selectSearchResult(item.id)}
                      >
                        <span className="tree-mini-avatar" aria-hidden="true">
                          {item.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.birth_year ? item.birth_year + ' · Модонд харах' : 'Модонд харах'}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {searchPage.has_next && (
                  <button
                    type="button"
                    className="tree-search-more"
                    onClick={() => void loadMoreSearch()}
                    disabled={searchBusy}
                  >
                    {searchBusy ? 'Ачаалж байна…' : 'Дараагийн үр дүн'}
                  </button>
                )}
              </section>
            )}
          </div>

          {tree?.persons.length && !hasBackendRoot ? (
            <section className="tree-state tree-state--empty tree-state--in-shell" role="status">
              <div className="tree-state-mark" aria-hidden="true">!</div>
              <h2>Удмын мод бүрэн бэлэн болоогүй байна.</h2>
              <p>Энэ гэр бүлийн модонд backend-ээс баталгаатай төв хүн ирээгүй тул буруу холбоос таамаглан харуулахгүй.</p>
              <Link className="tree-button tree-button--primary" href={'/people?family=' + encodeURIComponent(familyId)}>
                Хүмүүс рүү очих
              </Link>
            </section>
          ) : !tree?.persons.length ? (
            <section className="tree-state tree-state--empty tree-state--in-shell">
              <div className="tree-state-mark" aria-hidden="true">🌳</div>
              <h2>Удмын мод одоогоор хоосон байна.</h2>
              <p>Энэ гэр бүлийн зөвшөөрөгдсөн орчинд одоогоор хүн эсвэл холбоос алга байна.</p>
              <Link className="tree-button tree-button--primary" href={'/people?family=' + encodeURIComponent(familyId)}>
                Хүмүүс рүү очих
              </Link>
            </section>
          ) : (
            <div className="tree-map-layout">
              <div
                ref={scrollRef}
                className={'tree-map-scroll ' + (isFullscreen ? 'is-fullscreen' : '')}
                tabIndex={0}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
                style={{ cursor: isDragging.current ? 'grabbing' : 'grab', userSelect: 'none' }}
                aria-label="Удмын модны зөөврийн зураглал. Хулганаар чирч шилжүүлэх болон томруулж жижигрүүлж харна."
              >
                {isFullscreen && (
                  <button
                    type="button"
                    className="tree-floating-fullscreen-close"
                    onClick={() => setIsFullscreen(false)}
                    aria-label="Бүтэн дэлгэцийн горимоос гарах"
                  >
                    ✕ Буцах
                  </button>
                )}
                <div
                  className="tree-map-space"
                  style={{
                    width: layout.width * zoom,
                    height: layout.height * zoom,
                  }}
                >
                  <div
                    className={'tree-map-stage ' + (bloodlineMode !== 'none' ? 'has-bloodline-active' : '')}
                    style={{
                      width: layout.width,
                      height: layout.height,
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: '0 0',
                      transition: isDraggingActive ? 'none' : 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    <div className="tree-map-scenery" aria-hidden="true" />
                    <div className="tree-map-veil" aria-hidden="true" />

                    <svg
                      className="tree-connectors"
                      width={layout.width}
                      height={layout.height}
                      viewBox={'0 0 ' + layout.width + ' ' + layout.height}
                      aria-hidden="true"
                    >
                      {/* Mongolian Generation Labels & Division Lines */}
                      {layout.generationHeaders.map((hdr) => (
                        <g key={'gen-' + hdr.generation} className="tree-gen-divider">
                          <line
                            x1={20}
                            y1={hdr.y + 14}
                            x2={layout.width - 20}
                            y2={hdr.y + 14}
                            stroke="rgba(217, 184, 93, 0.40)"
                            strokeDasharray="4 6"
                            strokeWidth="1.5"
                          />
                          <rect
                            x={24}
                            y={hdr.y}
                            width={230}
                            height={26}
                            rx={13}
                            fill="#ffffff"
                            stroke="#d4b26f"
                            strokeWidth="1.5"
                          />
                          <text
                            x={38}
                            y={hdr.y + 17}
                            fill="#78591f"
                            fontSize="11"
                            fontWeight="700"
                          >
                            {hdr.label}
                          </text>
                        </g>
                      ))}

                      {/* Sibling Orthogonal Bus Connectors (No criss-cross spaghetti!) */}
                      {layout.buses.map((bus) => {
                        const isBusParentsActive = bloodlineMode !== 'none' && bus.parents.some((pid) => bloodline.activeIds.has(pid));
                        const isBusAnyChildActive = bloodlineMode !== 'none' && bus.children.some((c) => bloodline.activeIds.has(c.id));
                        const isBusStemActive = isBusParentsActive && isBusAnyChildActive;
                        const isBusDimmed = bloodlineMode !== 'none' && !isBusStemActive;

                        return (
                          <g key={bus.id} className={'tree-connector-bus ' + (isBusStemActive ? 'is-bloodline-active ' : isBusDimmed ? 'is-dimmed ' : '')}>
                            {/* Vertical drop from parents midpoint / union to horizontal bus bar */}
                            <line
                              x1={bus.sourceX}
                              y1={bus.sourceY}
                              x2={bus.sourceX}
                              y2={bus.busY}
                              className={'tree-connector tree-connector--parent ' + (isBusStemActive ? 'is-bloodline-active' : isBusDimmed ? 'is-dimmed' : '')}
                            />
                            {/* Horizontal bus line connecting all children */}
                            <line
                              x1={bus.minChildX}
                              y1={bus.busY}
                              x2={bus.maxChildX}
                              y2={bus.busY}
                              className={'tree-connector tree-connector--parent ' + (isBusStemActive ? 'is-bloodline-active' : isBusDimmed ? 'is-dimmed' : '')}
                            />
                            {/* Drops into top center of each child */}
                            {bus.children.map((child) => {
                              const isChildActive = isBusParentsActive && bloodline.activeIds.has(child.id);
                              const isChildDimmed = bloodlineMode !== 'none' && !isChildActive;
                              return (
                                <line
                                  key={'child-drop-' + child.id}
                                  x1={child.x}
                                  y1={bus.busY}
                                  x2={child.x}
                                  y2={child.y}
                                  className={'tree-connector tree-connector--parent ' + (isChildActive ? 'is-bloodline-active' : isChildDimmed ? 'is-dimmed' : '')}
                                />
                              );
                            })}
                          </g>
                        );
                      })}

                      {/* Single Parent direct curves */}
                      {layout.singleParentEdges.map((edge) => {
                        const isEdgeActive = bloodlineMode !== 'none' && bloodline.activeIds.has(edge.parentId) && bloodline.activeIds.has(edge.childId);
                        const isEdgeDimmed = bloodlineMode !== 'none' && !isEdgeActive;
                        return (
                          <path
                            key={edge.id}
                            d={edge.path}
                            className={'tree-connector tree-connector--parent ' + (isEdgeActive ? 'is-bloodline-active' : isEdgeDimmed ? 'is-dimmed' : '')}
                          />
                        );
                      })}

                      {/* Marriage lines and central dots between spouses */}
                      {layout.unions.map((union) => {
                        const p1 = nodeById.get(union.person1Id);
                        const p2 = nodeById.get(union.person2Id);
                        if (!p1 || !p2) return null;
                        const x1 = p1.x + nodeP1Width(p1);
                        const x2 = p2.x;
                        const y = union.y;
                        const isHistorical = union.status !== 'married';

                        function nodeP1Width(node: LayoutNode) {
                          return node.width;
                        }

                        const isUnionActive = bloodlineMode !== 'none' && bloodline.activeIds.has(union.person1Id) && bloodline.activeIds.has(union.person2Id);
                        const isUnionDimmed = bloodlineMode !== 'none' && !isUnionActive;

                        return (
                          <g key={union.id} className={isUnionActive ? 'is-bloodline-active' : isUnionDimmed ? 'is-dimmed' : ''}>
                            <line
                              x1={x1}
                              y1={y}
                              x2={x2}
                              y2={y}
                              className={'tree-connector tree-connector--spouse ' + (isHistorical ? 'is-history ' : '') + (isUnionActive ? 'is-bloodline-active' : isUnionDimmed ? 'is-dimmed' : '')}
                            />
                            <circle
                              cx={union.x}
                              cy={union.y}
                              r="7"
                              className={'tree-marriage-dot ' + (isHistorical ? 'is-history ' : '') + (isUnionActive ? 'is-bloodline-active' : isUnionDimmed ? 'is-dimmed' : '')}
                            />
                          </g>
                        );
                      })}
                    </svg>

                    {layout.nodes.map((node) => {
                      const person = node.person;
                      const selected = person.id === selectedId;
                      const parentCount = relationCounts.parents.get(person.id) ?? 0;
                      const childCount = relationCounts.children.get(person.id) ?? 0;
                      const spouseCount = relationCounts.spouses.get(person.id) ?? 0;
                      const isMale = person.gender === 'male';
                      const isFemale = person.gender === 'female';

                      const isHighlighted = bloodlineMode !== 'none' && bloodline.activeIds.has(person.id);
                      const isDimmed = bloodlineMode !== 'none' && !isHighlighted;
                      const isAncestor = bloodline.ancestorIds.has(person.id);
                      const isDescendant = bloodline.descendantIds.has(person.id);
                      const isSpouse = bloodline.spouseIds.has(person.id);

                      return (
                        <article
                          key={person.id}
                          id={'tree-person-' + person.id}
                          data-person-id={person.id}
                          className={
                            'tree-person-card ' +
                            (selected ? 'is-selected ' : '') +
                            (isMale ? 'is-male ' : isFemale ? 'is-female ' : '') +
                            (person.is_alive ? 'is-alive ' : 'is-deceased ') +
                            (isHighlighted ? 'is-in-bloodline ' : '') +
                            (isDimmed ? 'is-dimmed ' : '') +
                            (isAncestor ? 'is-bloodline-ancestor ' : '') +
                            (isDescendant ? 'is-bloodline-descendant ' : '') +
                            (isSpouse ? 'is-bloodline-spouse ' : '')
                          }
                          style={{
                            left: node.x,
                            top: node.y,
                            width: node.width,
                            height: node.height,
                          }}
                        >
                          {isHighlighted && (
                            <span className="tree-bloodline-tag" aria-label="Удам угсааны үүрэг">
                              {selected ? '👑 Төв хүн' : isAncestor ? '⭐ Дээдэс' : isDescendant ? '🌱 Үр сад' : isSpouse ? '💍 Хань' : '✨ Ураг'}
                            </span>
                          )}
                          <button
                            type="button"
                            className="tree-person-select"
                            aria-pressed={selected}
                            aria-label={personName(person) + ' хүнийг сонгох'}
                            onClick={() => selectPerson(person.id)}
                          >
                            <div className="tree-person-avatar-wrap">
                              <span className="tree-person-avatar" aria-hidden="true">
                                {initials(person)}
                              </span>
                              {person.is_alive ? (
                                <span className="tree-alive-beacon" title="Амьд сэрүүн" />
                              ) : (
                                <span className="tree-deceased-beacon" title="Мөнхөрсөн">🕊️</span>
                              )}
                            </div>
                            <strong className="tree-person-name">{personName(person) || 'Нэргүй хүн'}</strong>
                            <span className="tree-person-dates">{lifeSummary(person)}</span>
                            <em className="tree-person-gen">{generationLabel(node.generation)}</em>
                          </button>

                          <div className="tree-person-meta">
                            <span>{parentCount} эцэг/эх</span>
                            <span>{childCount} хүүхэд</span>
                            <span>{spouseCount} хань</span>
                          </div>

                          {(person.lineage_name || person.branch_name) && (
                            <div className="tree-person-tags">
                              {person.lineage_name ? <span>{person.lineage_name}</span> : null}
                              {person.branch_name ? <span>{person.branch_name}</span> : null}
                            </div>
                          )}

                          {/* Quick Action buttons */}
                          <div className="tree-card-quick-actions">
                            <button
                              type="button"
                              className="tree-quick-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectPerson(person.id);
                                setRelation('child');
                              }}
                              title="Үр хүүхэд нэмэх"
                            >
                              + Хүүхэд
                            </button>
                            <button
                              type="button"
                              className="tree-quick-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectPerson(person.id);
                                setRelation('spouse');
                              }}
                              title="Хань холбох"
                            >
                              + Хань
                            </button>
                            <Link
                              className="tree-quick-btn is-profile"
                              href={profileHref(person.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={personName(person) + ' дэлгэрэнгүй профайл'}
                            >
                              Профайл →
                            </Link>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>

              <TreeDrawer
                familyId={familyId}
                personId={selectedId}
                person={selectedPerson ?? null}
                allPersons={tree?.persons ?? []}
                marriages={selectedMarriages}
                onSelectRelative={(relId) => {
                  selectPerson(relId);
                  centerOnPerson(relId);
                }}
                onCenterPerson={(pid) => centerOnPerson(pid)}
                onOpenKinship={(pid) => {
                  setKinshipPerson1Id(pid);
                  setKinshipOpen(true);
                }}
                onAddRelation={(type) => {
                  setWizardAnchorId(selectedId);
                  if (type === 'child') setWizardRole('son');
                  else if (type === 'spouse') setWizardRole('spouse');
                  else setWizardRole('father');
                  setWizardOpen(true);
                }}
                onClose={() => setSelectedId('')}
                onDivorce={(mid) => divorce(mid)}
                profileHref={profileHref}
              />
            </div>
          )}
        </section>

        {tree?.meta?.truncated && (
          <p className="tree-truncated-note">
            Энэ мод API-ийн аюулгүй дээд хязгаараас хэтэрсэн тул бүх хүнийг нэг дор харуулахгүй байж болно. Хайлт ашиглан өөр хүнийг төв болгон үргэлжлүүлэн хараарай.
          </p>
        )}

        <footer className="tree-footer-note">
          <span>Удмын холбоосыг зөвхөн backend-ээс зөвшөөрөгдсөн Person болон Relationship өгөгдлөөр зурна.</span>
          <span>Гэрлэлт болон эцэг-эх/хүүхдийн холбоо тусдаа хадгалагдана.</span>
        </footer>
      </section>

      {relation && selectedPerson && (
        <div className="tree-modal-backdrop" role="presentation" onMouseDown={() => setRelation(null)}>
          <section
            className="tree-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tree-relation-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tree-modal-heading">
              <div>
                <p className="tree-eyebrow">ХОЛБОО</p>
                <h2 id="tree-relation-title">
                  {relation === 'parent' ? 'Эцэг/эх нэмэх' : relation === 'child' ? 'Хүүхэд нэмэх' : 'Гэрлэлт нэмэх'}
                </h2>
              </div>
              <button type="button" onClick={() => setRelation(null)} aria-label="Холбооны цонхыг хаах">×</button>
            </div>

            {relationError && <div className="tree-alert tree-alert--error" role="alert">{relationError}</div>}

            <form onSubmit={addRelation} className="tree-modal-form">
              <label>
                <span>Одоо байгаа хүнээс сонгох</span>
                <select name="existing" defaultValue="">
                  <option value="">Шинэ хүн үүсгэх</option>
                  {tree?.persons
                    ?.filter((person) => person.id !== selectedId)
                    .map((person) => (
                      <option value={person.id} key={person.id}>
                        {personName(person)}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                <span>Шинэ хүний нэр</span>
                <input name="name" maxLength={360} placeholder="Нэр Овог" />
              </label>

              <label>
                <span>Хүйс</span>
                <select name="gender" defaultValue="unknown">
                  <option value="unknown">Тодорхойгүй</option>
                  <option value="male">Эрэгтэй</option>
                  <option value="female">Эмэгтэй</option>
                  <option value="other">Бусад</option>
                </select>
              </label>

              {relation === 'spouse' ? (
                <label>
                  <span>Гэрлэсэн огноо</span>
                  <input name="start_date" type="date" />
                </label>
              ) : (
                <label>
                  <span>Холбооны төрөл</span>
                  <select name="relationship_type" defaultValue="biological">
                    <option value="biological">Төрсөн</option>
                    <option value="adoptive">Үрчилсэн</option>
                  </select>
                </label>
              )}

              <div className="tree-modal-actions">
                <button type="button" className="tree-button tree-button--secondary" onClick={() => setRelation(null)}>
                  Болих
                </button>
                <button type="submit" className="tree-button tree-button--primary">
                  Холбоог хадгалах
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {kinshipOpen && (
        <div className="tree-modal-backdrop" role="dialog" aria-modal="true" aria-label="Ураг төрлийн хамаарал шалгах">
          <section className="tree-modal" style={{ maxWidth: '520px', width: '100%' }}>
            <div className="tree-modal-head">
              <h2>🧬 Монгол 9 үеийн ураг холбоо шалгах</h2>
              <button
                type="button"
                className="tree-modal-close"
                onClick={() => setKinshipOpen(false)}
                aria-label="Хаах"
              >
                ✕
              </button>
            </div>

            <div className="tree-modal-form">
              <label>
                <span>Эхний хүн:</span>
                <select
                  value={kinshipPerson1Id}
                  onChange={(e) => setKinshipPerson1Id(e.target.value)}
                >
                  <option value="">-- Хүн сонгох --</option>
                  {tree?.persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {personName(p)} {p.birth_date ? `(${p.birth_date.slice(0, 4)})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Хоёр дахь хүн:</span>
                <select
                  value={kinshipPerson2Id}
                  onChange={(e) => setKinshipPerson2Id(e.target.value)}
                >
                  <option value="">-- Хүн сонгох --</option>
                  {tree?.persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {personName(p)} {p.birth_date ? `(${p.birth_date.slice(0, 4)})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="tree-modal-actions" style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  className="tree-button tree-button--secondary"
                  onClick={() => setKinshipOpen(false)}
                >
                  Хаах
                </button>
                <button
                  type="button"
                  className="tree-button tree-button--primary"
                  onClick={calculateKinship}
                  disabled={!kinshipPerson1Id || !kinshipPerson2Id || kinshipLoading}
                >
                  {kinshipLoading ? 'Тооцоолж байна…' : 'Шалгах'}
                </button>
              </div>

              {kinshipError && (
                <p className="tree-notice tree-notice--error" role="alert" style={{ marginTop: '10px' }}>
                  {kinshipError}
                </p>
              )}

              {kinshipResult && (
                <div
                  style={{
                    marginTop: '16px',
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(7, 50, 40, 0.08)',
                    border: '1px solid rgba(208, 194, 158, 0.4)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <strong style={{ fontSize: '18px', color: '#17372a' }}>
                      {kinshipResult.relationship_title}
                    </strong>
                    {kinshipResult.lineage_label && (
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: kinshipResult.lineage_type === 'paternal' ? '#d9b85d' : '#497c6c',
                          color: '#07241d',
                        }}
                      >
                        {kinshipResult.lineage_label}
                      </span>
                    )}
                  </div>

                  <p style={{ margin: '8px 0 4px', fontSize: '13px', color: '#45584e' }}>
                    {kinshipResult.description}
                  </p>

                  {kinshipResult.coefficient > 0 && (
                    <p style={{ margin: '4px 0', fontSize: '12px', color: '#66776e' }}>
                      Цусны хамаарлын коэффициент (r): <strong>{(kinshipResult.coefficient * 100).toFixed(1)}%</strong>
                    </p>
                  )}

                  {kinshipResult.inbreeding_warning && (
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        lineHeight: '1.5',
                        background: kinshipResult.within_9_generations ? 'rgba(235, 87, 87, 0.12)' : 'rgba(39, 174, 96, 0.12)',
                        color: kinshipResult.within_9_generations ? '#9c1c1c' : '#146333',
                        border: `1px solid ${kinshipResult.within_9_generations ? 'rgba(235, 87, 87, 0.3)' : 'rgba(39, 174, 96, 0.3)'}`,
                      }}
                    >
                      {kinshipResult.inbreeding_warning}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Vector Print & Wall Art Export Modal */}
      <TreeExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        family={family}
        tree={tree}
        layout={layout}
      />

      {/* Pedigree Context Relative Wizard Modal */}
      <PedigreeWizardModal
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        familyId={familyId}
        people={tree?.persons ?? []}
        marriages={tree?.marriages ?? []}
        parentChildEdges={tree?.parent_child_relationships ?? []}
        initialAnchorPersonId={wizardAnchorId}
        initialRole={wizardRole}
        onSuccess={async (newPerson, msg) => {
          setWizardOpen(false);
          setNotice(msg);
          setSelectedId(newPerson.id);
          await loadTree(familyId, newPerson.id, depth);
        }}
      />
    </main>
  );
}


export default function TreePage() {
  return (
    <Suspense
      fallback={
        <main className="tree-page">
          <section className="tree-shell">
            <div className="tree-loading-scene" role="status" aria-live="polite">
              <strong>Удмын модыг ачаалж байна…</strong>
              <small>Гэр бүлийн мэдээллийг бэлтгэж байна.</small>
            </div>
          </section>
        </main>
      }
    >
      <TreePageContent />
    </Suspense>
  );
}
