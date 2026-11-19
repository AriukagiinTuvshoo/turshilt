import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculateMongolianKinship, type KinshipPerson, type KinshipEdge, type KinshipMarriage } from '../lib/kinship.ts';
import { exportToGedcom, parseGedcom } from '../lib/gedcom.ts';
import { findDuplicatePeople, getUpcomingFamilyReminders } from '../lib/duplicates.ts';
import { buildAdvancedTreeLayout } from '../lib/tree-layout.ts';

describe('Mongolian Traditional Kinship Calculator (lib/kinship.ts)', () => {
  const people: KinshipPerson[] = [
    { id: 'gf', first_name: 'Дорж', last_name: 'Боржигон', gender: 'male' },
    { id: 'gm', first_name: 'Дулам', last_name: 'Хөх', gender: 'female' },
    { id: 'father', first_name: 'Бат', last_name: 'Дорж', gender: 'male' },
    { id: 'mother', first_name: 'Цэцэг', last_name: 'Болд', gender: 'female' },
    { id: 'paternal_uncle', first_name: 'Төмөр', last_name: 'Дорж', gender: 'male' },
    { id: 'ego', first_name: 'Тэмүүлэн', last_name: 'Бат', gender: 'male' },
    { id: 'sister', first_name: 'Номин', last_name: 'Бат', gender: 'female' },
    { id: 'wife', first_name: 'Саруул', last_name: 'Эрдэнэ', gender: 'female' },
    { id: 'son', first_name: 'Анар', last_name: 'Тэмүүлэн', gender: 'male' },
    { id: 'daughter', first_name: 'Мишээл', last_name: 'Тэмүүлэн', gender: 'female' },
    { id: 'grandson_pat', first_name: 'Билгүүн', last_name: 'Анар', gender: 'male' },
    { id: 'grandchild_mat', first_name: 'Энхжин', last_name: 'Мишээл', gender: 'female' },
    { id: 'cousin_pat', first_name: 'Ганзориг', last_name: 'Төмөр', gender: 'male' },
  ];

  const edges: KinshipEdge[] = [
    { parent_id: 'gf', child_id: 'father' },
    { parent_id: 'gm', child_id: 'father' },
    { parent_id: 'gf', child_id: 'paternal_uncle' },
    { parent_id: 'gm', child_id: 'paternal_uncle' },
    { parent_id: 'father', child_id: 'ego' },
    { parent_id: 'mother', child_id: 'ego' },
    { parent_id: 'father', child_id: 'sister' },
    { parent_id: 'mother', child_id: 'sister' },
    { parent_id: 'ego', child_id: 'son' },
    { parent_id: 'wife', child_id: 'son' },
    { parent_id: 'ego', child_id: 'daughter' },
    { parent_id: 'wife', child_id: 'daughter' },
    { parent_id: 'son', child_id: 'grandson_pat' },
    { parent_id: 'daughter', child_id: 'grandchild_mat' },
    { parent_id: 'paternal_uncle', child_id: 'cousin_pat' },
  ];

  const marriages: KinshipMarriage[] = [
    { person_1_id: 'gf', person_2_id: 'gm' },
    { person_1_id: 'father', person_2_id: 'mother' },
    { person_1_id: 'ego', person_2_id: 'wife' },
  ];

  it('correctly identifies direct ancestors (Аав, Ээж, Өвөө)', () => {
    const fatherRel = calculateMongolianKinship('ego', 'father', people, edges, marriages);
    assert.ok(fatherRel);
    assert.match(fatherRel.relationshipName, /Аав/i);

    const gfRel = calculateMongolianKinship('ego', 'gf', people, edges, marriages);
    assert.ok(gfRel);
    assert.match(gfRel.relationshipName, /Өвөө/i);
  });

  it('distinguishes Ач (son’s child) vs Зээ (daughter’s child)', () => {
    const ach = calculateMongolianKinship('ego', 'grandson_pat', people, edges, marriages);
    assert.ok(ach);
    assert.match(ach.relationshipName, /Ач/);

    const zee = calculateMongolianKinship('ego', 'grandchild_mat', people, edges, marriages);
    assert.ok(zee);
    assert.match(zee.relationshipName, /Зээ/);
  });

  it('identifies Авга (paternal uncle) and Үеэл (first cousin)', () => {
    const avga = calculateMongolianKinship('ego', 'paternal_uncle', people, edges, marriages);
    assert.ok(avga);
    assert.match(avga.relationshipName, /Авга/);

    const uyeel = calculateMongolianKinship('ego', 'cousin_pat', people, edges, marriages);
    assert.ok(uyeel);
    assert.match(uyeel.relationshipName, /үеэл/i);
  });

  it('identifies spouse (Хань / Гэргий)', () => {
    const spouse = calculateMongolianKinship('ego', 'wife', people, edges, marriages);
    assert.ok(spouse);
    assert.equal(spouse.lineageType, 'spouse');
    assert.equal(spouse.nineGenerationsRuleViolated, false);
  });

  it('handles self and unrelated people accurately', () => {
    const selfRel = calculateMongolianKinship('ego', 'ego', people, edges, marriages);
    assert.equal(selfRel.lineageType, 'self');

    const outsider: KinshipPerson = { id: 'stranger', first_name: 'Гадны', last_name: 'Хүн', gender: 'male' };
    const unrelated = calculateMongolianKinship('ego', 'stranger', [...people, outsider], edges, marriages);
    assert.equal(unrelated.lineageType, 'unrelated');
    assert.equal(unrelated.nineGenerationsRuleViolated, false);
  });

  it('enforces 9-generation rule warning for blood relatives', () => {
    const cousin = calculateMongolianKinship('ego', 'cousin_pat', people, edges, marriages);
    assert.equal(cousin.nineGenerationsRuleViolated, true);
  });
});

describe('GEDCOM 5.5.1 Export & Parse Round-Trip (lib/gedcom.ts)', () => {
  it('exports valid GEDCOM 5.5.1 and parses it back without losing people or links', () => {
    const people = [
      { id: 'p1', first_name: 'Баяр', last_name: 'Боржигон', gender: 'male', birth_date: '1965-03-14', is_alive: true },
      { id: 'p2', first_name: 'Оюун', last_name: 'Тайж', gender: 'female', birth_date: '1968-07-22', is_alive: true },
      { id: 'p3', first_name: 'Зориг', last_name: 'Баяр', gender: 'male', birth_date: '1995-11-05', is_alive: true },
    ];
    const rels = [
      { parent_id: 'p1', child_id: 'p3' },
      { parent_id: 'p2', child_id: 'p3' },
    ];
    const marriages = [{ person_1_id: 'p1', person_2_id: 'p2', start_date: '1992-06-01', status: 'married' }];

    const gedText = exportToGedcom('Гуулингийнхан', people, rels, marriages);
    assert.ok(gedText.includes('0 HEAD'));
    assert.ok(gedText.includes('2 VERS 5.5.1'));
    assert.ok(gedText.includes('1 NAME Баяр /Боржигон/'));

    const parsed = parseGedcom(gedText);
    assert.equal(parsed.people.length, 3);
    assert.equal(parsed.parent_child_relationships.length, 2);
    assert.equal(parsed.marriages.length, 1);
    assert.equal(parsed.people[0].first_name, 'Баяр');
    assert.equal(parsed.people[0].last_name, 'Боржигон');
  });
});

describe('Duplicate Detection & Reminders (lib/duplicates.ts)', () => {
  it('flags probable duplicate people with identical or near-identical names and birth years', () => {
    const list = [
      { id: '1', first_name: 'Батбаяр', last_name: 'Боржигон', gender: 'male', birth_date: '1980-04-10' },
      { id: '2', first_name: 'Батбаяр', last_name: 'Боржигон', gender: 'male', birth_date: '1980-01-01' },
      { id: '3', first_name: 'Сүхбаатар', last_name: 'Хөх', gender: 'male', birth_date: '1950-05-05' },
    ];
    const dups = findDuplicatePeople(list);
    assert.equal(dups.length, 1);
    assert.equal(dups[0].personA.id, '1');
    assert.equal(dups[0].personB.id, '2');
    assert.ok(dups[0].similarityScore >= 90);
  });

  it('computes upcoming birthdays and memorial days within window', () => {
    const refDate = new Date(2026, 4, 1); // May 1, 2026
    const list = [
      { id: '1', first_name: 'Тэмүүлэн', last_name: 'Бат', is_alive: true, birth_date: '1996-05-10' },
      { id: '2', first_name: 'Өвөө', last_name: 'Дорж', is_alive: false, birth_date: '1930-01-01', death_date: '2016-05-20' },
    ];
    const reminders = getUpcomingFamilyReminders(list, refDate, 30);
    assert.equal(reminders.length, 2);
    assert.equal(reminders[0].kind, 'birthday');
    assert.equal(reminders[0].daysUntil, 9);
    assert.equal(reminders[1].kind, 'memorial');
    assert.equal(reminders[1].daysUntil, 19);
  });

  it('does not flag namesakes across different generations as duplicates', () => {
    const list = [
      { id: '1', first_name: 'Бат', last_name: 'Боржигон', gender: 'male', birth_date: '1945-03-10' },
      { id: '2', first_name: 'Бат', last_name: 'Боржигон', gender: 'male', birth_date: '2005-07-22' },
    ];
    const dups = findDuplicatePeople(list);
    assert.equal(dups.length, 0);
  });
});

describe('Advanced Tree Layout Engine (lib/tree-layout.ts)', () => {
  it('returns an empty layout cleanly when tree has no people', () => {
    const layout = buildAdvancedTreeLayout({
      persons: [],
      parent_child_relationships: [],
      marriages: [],
    });
    assert.equal(layout.nodes.length, 0);
    assert.equal(layout.unions.length, 0);
  });

  it('places parents strictly above children with valid non-overlapping coordinates', () => {
    const layout = buildAdvancedTreeLayout({
      persons: [
        { id: 'p1', first_name: 'Дорж', last_name: 'Боржигон', middle_name: null, gender: 'male', birth_date: '1960-01-01', is_alive: true, death_date: null },
        { id: 'p2', first_name: 'Дулам', last_name: 'Хөх', middle_name: null, gender: 'female', birth_date: '1962-01-01', is_alive: true, death_date: null },
        { id: 'c1', first_name: 'Тэмүүлэн', last_name: 'Дорж', middle_name: null, gender: 'male', birth_date: '1990-01-01', is_alive: true, death_date: null },
        { id: 'c2', first_name: 'Номин', last_name: 'Дорж', middle_name: null, gender: 'female', birth_date: '1993-01-01', is_alive: true, death_date: null },
      ],
      parent_child_relationships: [
        { id: 'r1', parent_id: 'p1', child_id: 'c1', relationship_type: 'biological' },
        { id: 'r2', parent_id: 'p2', child_id: 'c1', relationship_type: 'biological' },
        { id: 'r3', parent_id: 'p1', child_id: 'c2', relationship_type: 'biological' },
        { id: 'r4', parent_id: 'p2', child_id: 'c2', relationship_type: 'biological' },
      ],
      marriages: [
        { id: 'm1', person_1_id: 'p1', person_2_id: 'p2', status: 'married', start_date: '1988-06-01', end_date: null },
      ],
      root_person_id: 'p1',
    });

    assert.equal(layout.nodes.length, 4);
    assert.equal(layout.unions.length, 1);

    const p1 = layout.nodeById.get('p1')!;
    const p2 = layout.nodeById.get('p2')!;
    const c1 = layout.nodeById.get('c1')!;
    const c2 = layout.nodeById.get('c2')!;

    assert.equal(p1.y, p2.y);
    assert.ok(p1.y < c1.y, 'Parent must render strictly above child');
    assert.equal(c1.y, c2.y);
    assert.notEqual(c1.x, c2.x, 'Siblings must not overlap horizontally');
  });
});
