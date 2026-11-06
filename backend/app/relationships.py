from collections import defaultdict
from collections.abc import Iterable
from uuid import UUID


class RelationshipError(ValueError):
    """A family relationship would violate a graph invariant."""


def canonical_pair(person_a: UUID, person_b: UUID) -> tuple[UUID, UUID]:
    if person_a == person_b:
        raise RelationshipError("Хүн өөртэйгөө гэр бүлийн холбоо үүсгэж болохгүй.")
    return tuple(sorted((person_a, person_b), key=str))  # type: ignore[return-value]


def assert_parent_child_is_acyclic(
    existing_edges: Iterable[tuple[UUID, UUID]], parent_id: UUID, child_id: UUID
) -> None:
    """Reject self-parenting and any edge that closes a directed ancestry cycle."""
    if parent_id == child_id:
        raise RelationshipError("Хүн өөрөө өөрийнхөө эцэг эх байж болохгүй.")

    children: dict[UUID, set[UUID]] = defaultdict(set)
    for parent, child in existing_edges:
        children[parent].add(child)

    # A new parent -> child edge cycles only if child already reaches parent.
    pending = [child_id]
    visited: set[UUID] = set()
    while pending:
        current = pending.pop()
        if current == parent_id:
            raise RelationshipError("Энэ холбоо ургийн модонд тойрог үүсгэнэ.")
        if current in visited:
            continue
        visited.add(current)
        pending.extend(children[current] - visited)


def assert_date_order(start, end) -> None:
    if start is not None and end is not None and end < start:
        raise RelationshipError("Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.")


def find_ancestors_with_paths(
    parent_edges: Iterable[tuple[UUID, UUID, str | None]],
    target_id: UUID,
) -> dict[UUID, dict]:
    """Find all ancestors of target_id with minimum distance and lineage gender path.

    parent_edges: tuples of (parent_id, child_id, parent_gender)
    Returns: dict[ancestor_id, {"distance": int, "all_male_line": bool}]
    """
    parents_map: dict[UUID, list[tuple[UUID, str | None]]] = defaultdict(list)
    for parent_id, child_id, gender in parent_edges:
        parents_map[child_id].append((parent_id, gender))

    ancestors: dict[UUID, dict] = {target_id: {"distance": 0, "all_male_line": True}}
    queue: list[tuple[UUID, int, bool]] = [(target_id, 0, True)]

    while queue:
        curr_id, dist, is_male_line = queue.pop(0)
        for p_id, p_gender in parents_map.get(curr_id, []):
            next_dist = dist + 1
            next_is_male = is_male_line and (p_gender == "male")
            if p_id not in ancestors or next_dist < ancestors[p_id]["distance"]:
                ancestors[p_id] = {"distance": next_dist, "all_male_line": next_is_male}
                queue.append((p_id, next_dist, next_is_male))

    return ancestors


def analyze_kinship_relation(
    person_1_id: UUID,
    person_2_id: UUID,
    parent_edges: Iterable[tuple[UUID, UUID, str | None]],
    marriage_pairs: Iterable[tuple[UUID, UUID]] | None = None,
) -> dict:
    """Compute Lowest Common Ancestors, genealogical distance, relationship title and 9-gen rule."""
    if person_1_id == person_2_id:
        return {
            "relationship_type": "self",
            "relationship_title": "Өөрөө (Нэг хүн)",
            "degree": 0,
            "coefficient": 1.0,
            "is_blood_related": True,
            "within_9_generations": True,
            "lineage_type": "self",
            "common_ancestor_ids": [str(person_1_id)],
            "description": "Нэг ижил хүний мэдээлэл.",
        }

    # Check marriage first if provided
    if marriage_pairs:
        for p1, p2 in marriage_pairs:
            if (p1 == person_1_id and p2 == person_2_id) or (p1 == person_2_id and p2 == person_1_id):
                pass  # note: can still calculate blood relationship even if married!

    anc_1 = find_ancestors_with_paths(parent_edges, person_1_id)
    anc_2 = find_ancestors_with_paths(parent_edges, person_2_id)

    common_ancestors = set(anc_1.keys()) & set(anc_2.keys())

    if not common_ancestors:
        # Check if they are married
        is_married = False
        if marriage_pairs:
            for p1, p2 in marriage_pairs:
                if (p1 == person_1_id and p2 == person_2_id) or (p1 == person_2_id and p2 == person_1_id):
                    is_married = True
                    break

        return {
            "relationship_type": "spouse" if is_married else "unrelated",
            "relationship_title": "Гэр бүлийн хос (Эхнэр/Нөхөр)" if is_married else "Цусны холбоогүй",
            "degree": None,
            "coefficient": 0.0,
            "is_blood_related": False,
            "within_9_generations": False,
            "lineage_type": "unrelated",
            "common_ancestor_ids": [],
            "description": (
                "Энэ хоёр хүний хооронд бүртгэгдсэн ураг төрлийн дундын өвөг байхгүй байна."
                if not is_married
                else "Гэрлэлтийн холбоотой, цусны дундын өвөг бүртгэгдээгүй."
            ),
        }

    # Find LCAs that minimize L1 + L2
    min_sum = min(anc_1[a]["distance"] + anc_2[a]["distance"] for a in common_ancestors)
    lcas = [a for a in common_ancestors if anc_1[a]["distance"] + anc_2[a]["distance"] == min_sum]

    # Calculate coefficient of relationship r = sum((1/2)^(L1 + L2)) across minimal common ancestors
    # (avoiding counting both parents and their ancestors repeatedly)
    coefficient = sum((0.5) ** (anc_1[a]["distance"] + anc_2[a]["distance"]) for a in lcas)

    first_lca = lcas[0]
    l1 = anc_1[first_lca]["distance"]
    l2 = anc_2[first_lca]["distance"]

    # Determine paternal vs maternal
    is_paternal = anc_1[first_lca]["all_male_line"] and anc_2[first_lca]["all_male_line"]
    lineage_type = "paternal" if is_paternal else "maternal"
    lineage_label = "Ясан төрөл (Эцгийн тал)" if is_paternal else "Цусан төрөл (Эхийн/Нагацын тал)"

    # Mongolian traditional 9-generation terminology
    title = "Төрөл садан"
    desc = ""
    within_9 = (l1 <= 8 and l2 <= 8)

    if l1 == 0 and l2 > 0:
        titles_child = {
            1: "Үр хүүхэд (Хүү / Охин)",
            2: "Ач / Зээ",
            3: "Жич",
            4: "Тач",
            5: "Бүч",
            6: "Түмбүч",
        }
        title = titles_child.get(l2, f"{l2}-р үеийн үр хойч")
        desc = f"1-р хүн нь 2-р хүний {title} болно."
    elif l2 == 0 and l1 > 0:
        titles_parent = {
            1: "Эцэг / Эх",
            2: "Өвөг эцэг / Эмэг эх",
            3: "Элэнц өвөг / Элэнц эмэг",
            4: "Хуланц өвөг / Хуланц эмэг",
            5: "Өнөө өвөг",
            6: "Дөрвөнц өвөг",
            7: "Таванц өвөг",
            8: "Хулланц өвөг",
        }
        title = titles_parent.get(l1, f"{l1}-р үеийн өвөг дээдэс")
        desc = f"2-р хүн нь 1-р хүний {title} болно."
    elif l1 == 1 and l2 == 1:
        title = "Төрсөн ах / эгч / дүү"
        desc = "Нэг эцэг, эхээс төрсөн төрсөн ах дүүс."
    elif (l1 == 2 and l2 == 1) or (l1 == 1 and l2 == 2):
        if l1 > l2:
            title = "Авга / Нагац ах, эгч" if is_paternal else "Нагац ах, эгч"
            desc = "Нэг үеийн өмнөх авга/нагац төрөл."
        else:
            title = "Үеэл дүү / Ач, зээ дүү"
            desc = "Ах, эгчийн үр хүүхэд (ач, зээ дүү)."
    elif l1 == 2 and l2 == 2:
        title = "Үеэл (Авга үеэл / Бөрт)" if is_paternal else "Үеэл (Нагац үеэл)"
        desc = "Өвөө, эмээ нэгтэй үеэл ах дүүс."
    elif l1 == 3 and l2 == 3:
        title = "Дэд үеэл / Хаяал"
        desc = "Элэнц өвөг нэгтэй хаяал ах дүүс."
    elif l1 == 4 and l2 == 4:
        title = "Садан / Годон"
        desc = "Хуланц өвөг нэгтэй годон садан."
    else:
        title = f"{max(l1, l2)}-р үеийн садан төрөл"
        desc = f"Дундын өвгөөс тооцвол {l1} ба {l2} үеийн зайтай садан."

    inbreeding_warning = ""
    if within_9:
        inbreeding_warning = (
            "⚠️ Анхаар: Монгол уламжлалт 9 үеийн доторх цусан төрөл байна. "
            "Халхын ёс заншлаар 9 үе дотор ураг холбох, гэрлэхийг цээрлэнэ."
        )
    else:
        inbreeding_warning = "✅ 9 үеэс хэтэрсэн, хол төрлийн садан байна. Ураг холбох хориогүй."

    return {
        "relationship_type": "blood_relative",
        "relationship_title": title,
        "lineage_type": lineage_type,
        "lineage_label": lineage_label,
        "degree": min_sum,
        "generations_person_1": l1,
        "generations_person_2": l2,
        "coefficient": round(coefficient, 4),
        "is_blood_related": True,
        "within_9_generations": within_9,
        "common_ancestor_ids": [str(a) for a in lcas],
        "description": desc,
        "inbreeding_warning": inbreeding_warning,
    }
