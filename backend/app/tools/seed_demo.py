"""Seed demo account and rich 3-generation family tree for local testing and development."""

from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select

from app.auth import _password_hash
from app.db import SessionLocal
from app.models import (
    Biography,
    Branch,
    Family,
    FamilyMember,
    FamilyPerson,
    LifeEvent,
    Lineage,
    LoginIdentity,
    Marriage,
    Memory,
    ParentChildRelationship,
    Person,
    Story,
    StoryPerson,
    User,
    UserPersonLink,
)


def seed():
    db = SessionLocal()
    try:
        now = datetime.now(UTC)
        print("Starting demo seeding...")

        # 1. Demo User
        demo_email = "demo@guulin.mn"
        existing_user = db.scalar(select(User).where(User.email == demo_email))
        if existing_user:
            print("Demo user already exists. Cleaning up old demo data...")
            # Remove old family created by this user
            old_families = db.scalars(select(Family).where(Family.created_by == existing_user.id)).all()
            for f in old_families:
                db.delete(f)
            db.delete(existing_user)
            db.flush()

        password_hash = _password_hash("Password123!")
        user = User(
            id=uuid4(),
            email=demo_email,
            display_name="Батболд (Дэмо хэрэглэгч)",
            password_hash=password_hash,
            email_verified_at=now,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        db.flush()

        identity = LoginIdentity(
            id=uuid4(),
            user_id=user.id,
            provider="email",
            normalized_identifier=demo_email,
            display_identifier=demo_email,
            verified_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(identity)

        # 2. Demo Family
        family = Family(
            id=uuid4(),
            name="Гуулингийнхан",
            description="Завхан аймгийн Ургамал сумын Гуулингийнхны ургийн бичиг ба өв соёл",
            created_by=user.id,
            created_at=now,
        )
        db.add(family)
        db.flush()

        # Family member: owner
        member = FamilyMember(
            id=uuid4(),
            family_id=family.id,
            user_id=user.id,
            role="owner",
            joined_at=now,
        )
        db.add(member)

        # Lineage & Branch
        lineage = Lineage(
            id=uuid4(),
            family_id=family.id,
            name="Хөх Монгол — Гуулин овог",
            description="Ургамал сумын гол салбар ураг",
            created_at=now,
            updated_at=now,
        )
        db.add(lineage)
        db.flush()

        branch = Branch(
            id=uuid4(),
            lineage_id=lineage.id,
            name="Ахмад салбар",
            description="Дамдиндоржийн Гуулингийн үр хойчис",
            created_at=now,
            updated_at=now,
        )
        db.add(branch)
        db.flush()

        # 3. Persons (3 Generations)
        # Gen 1: Өвөө, Эмээ
        p_guulin = Person(
            id=uuid4(),
            first_name="Гуулин",
            last_name="Дамдиндорж",
            gender="male",
            birth_date=date(1925, 5, 12),
            birth_place="Завхан аймаг, Ургамал сум",
            is_alive=False,
            death_date=date(1998, 11, 20),
            death_place="Улаанбаатар хот",
            short_description="Малын их эмч, ахмад дайчин, Гуулин овгийн тэргүүн",
            visibility="family",
            search_first_name="гуулин",
            search_last_name="дамдиндорж",
            created_by=user.id,
            created_at=now,
            updated_at=now,
        )
        p_dolgor = Person(
            id=uuid4(),
            first_name="Долгор",
            last_name="Цэвэгмид",
            gender="female",
            birth_date=date(1928, 8, 15),
            birth_place="Завхан аймаг, Ургамал сум",
            is_alive=False,
            death_date=date(2005, 3, 10),
            death_place="Улаанбаатар хот",
            short_description="Бага ангийн гавьяат багш, олон хүүхдийн энэрэлт ээж",
            visibility="family",
            search_first_name="долгор",
            search_last_name="цэвэгмид",
            created_by=user.id,
            created_at=now,
            updated_at=now,
        )

        # Gen 2: Аав, Ээж, Авга ах
        p_batbayar = Person(
            id=uuid4(),
            first_name="Батбаяр",
            last_name="Гуулин",
            gender="male",
            birth_date=date(1952, 6, 20),
            birth_place="Завхан аймаг, Ургамал сум",
            is_alive=True,
            short_description="Уулын инженер, эрдэм шинжилгээний ажилтан",
            visibility="family",
            search_first_name="батбаяр",
            search_last_name="гуулин",
            created_by=user.id,
            created_at=now,
            updated_at=now,
        )
        p_oyunchimeg = Person(
            id=uuid4(),
            first_name="Оюунчимэг",
            last_name="Цэрэн",
            gender="female",
            birth_date=date(1955, 10, 4),
            birth_place="Улаанбаатар хот",
            is_alive=True,
            short_description="Хүний их эмч, клиникийн профессор",
            visibility="family",
            search_first_name="оюунчимэг",
            search_last_name="цэрэн",
            created_by=user.id,
            created_at=now,
            updated_at=now,
        )
        p_batsukh = Person(
            id=uuid4(),
            first_name="Батсүх",
            last_name="Гуулин",
            gender="male",
            birth_date=date(1956, 12, 1),
            birth_place="Завхан аймаг, Ургамал сум",
            is_alive=True,
            short_description="Тээврийн жолооч, ахмад тээвэрчин",
            visibility="family",
            search_first_name="батсүх",
            search_last_name="гуулин",
            created_by=user.id,
            created_at=now,
            updated_at=now,
        )

        # Gen 3: Хүү (Demo User), Охин
        p_batbold = Person(
            id=uuid4(),
            first_name="Батболд",
            last_name="Батбаяр",
            gender="male",
            birth_date=date(1982, 3, 14),
            birth_place="Улаанбаатар хот",
            is_alive=True,
            short_description="Программ хангамжийн ахлах инженер, Гуулингийнхны төслийг үүсгэн санаачлагч",
            visibility="family",
            search_first_name="батболд",
            search_last_name="батбаяр",
            created_by=user.id,
            created_at=now,
            updated_at=now,
        )
        p_bolormaa = Person(
            id=uuid4(),
            first_name="Болормаа",
            last_name="Батбаяр",
            gender="female",
            birth_date=date(1986, 9, 25),
            birth_place="Улаанбаатар хот",
            is_alive=True,
            short_description="Эдийн засагч, санхүүгийн шинжээч",
            visibility="family",
            search_first_name="болормаа",
            search_last_name="батбаяр",
            created_by=user.id,
            created_at=now,
            updated_at=now,
        )

        all_persons = [p_guulin, p_dolgor, p_batbayar, p_oyunchimeg, p_batsukh, p_batbold, p_bolormaa]
        for p in all_persons:
            db.add(p)
            db.flush()
            db.add(FamilyPerson(
                id=uuid4(),
                family_id=family.id,
                person_id=p.id,
                added_by=user.id,
                created_at=now,
            ))

        # Link user to p_batbold
        db.add(UserPersonLink(
            id=uuid4(),
            user_id=user.id,
            person_id=p_batbold.id,
            linked_by=user.id,
            linked_at=now,
        ))

        # 4. Marriages (Note: person_1_id < person_2_id strictly required by constraint)
        def add_marriage(p1, p2, start_date, location, desc):
            c1, c2 = (p1, p2) if p1.id < p2.id else (p2, p1)
            db.add(Marriage(
                id=uuid4(),
                person_1_id=c1.id,
                person_2_id=c2.id,
                status="married",
                start_date=start_date,
                location=location,
                description=desc,
                created_by=user.id,
                created_at=now,
            ))

        add_marriage(p_guulin, p_dolgor, date(1948, 7, 10), "Завхан аймаг", "Гэр бүл болсон")
        add_marriage(p_batbayar, p_oyunchimeg, date(1978, 6, 18), "Улаанбаатар хот", "Гэр бүл болсон")

        # 5. Parent-Child Relationships
        def add_child(parent, child):
            db.add(ParentChildRelationship(
                id=uuid4(),
                parent_id=parent.id,
                child_id=child.id,
                relationship_type="biological",
                created_by=user.id,
                created_at=now,
            ))

        # Guulin & Dolgor -> Batbayar, Batsukh
        add_child(p_guulin, p_batbayar)
        add_child(p_dolgor, p_batbayar)
        add_child(p_guulin, p_batsukh)
        add_child(p_dolgor, p_batsukh)

        # Batbayar & Oyunchimeg -> Batbold, Bolormaa
        add_child(p_batbayar, p_batbold)
        add_child(p_oyunchimeg, p_batbold)
        add_child(p_batbayar, p_bolormaa)
        add_child(p_oyunchimeg, p_bolormaa)

        # 6. Biographies & Life Events
        db.add(Biography(
            id=uuid4(),
            person_id=p_guulin.id,
            body="Дамдиндоржийн Гуулин нь 1925 онд Завхан аймгийн Ургамал суманд төрсөн. 1943 онд ХААИС-ийг малын их эмч мэргэжлээр төгсөж, нутаг орныхоо мал сүргийг эрүүлжүүлэх үйлсэд насан туршдаа зүтгэсэн эрхэм билээ.",
            updated_by=user.id,
            updated_at=now,
        ))
        db.add(Biography(
            id=uuid4(),
            person_id=p_batbold.id,
            body="Батбаярын Батболд нь 1982 онд Улаанбаатар хотод төрсөн. 2004 онд ШУТИС-ийг Программ хангамжийн инженер мэргэжлээр дүүргэсэн. Гуулингийнхны ургийн цахим санг санаачлан хөгжүүлэгч.",
            updated_by=user.id,
            updated_at=now,
        ))

        events = [
            (p_guulin.id, "birth", date(1925, 5, 12), "Төрсөн", "Завхан аймаг, Ургамал сум"),
            (p_guulin.id, "school", date(1943, 6, 1), "ХААИС төгссөн", "Улаанбаатар хот"),
            (p_guulin.id, "work", date(1948, 8, 15), "Малын их эмчээр ажиллаж эхэлсэн", "Завхан аймаг"),
            (p_guulin.id, "award", date(1975, 7, 11), "Алтан гадас одон хүртсэн", "Улаанбаатар хот"),
            (p_guulin.id, "death", date(1998, 11, 20), "Таалал төгссөн", "Улаанбаатар хот"),
            (p_batbold.id, "birth", date(1982, 3, 14), "Төрсөн", "Улаанбаатар хот"),
            (p_batbold.id, "school", date(2004, 6, 25), "ШУТИС-ийг амжилттай төгссөн", "Улаанбаатар хот"),
            (p_batbold.id, "work", date(2005, 1, 10), "Инженерээр ажиллаж эхэлсэн", "Улаанбаатар хот"),
        ]
        for pid, etype, edate, title, loc in events:
            db.add(LifeEvent(
                id=uuid4(),
                person_id=pid,
                event_type=etype,
                event_date=edate,
                title=title,
                location=loc,
                created_by=user.id,
            ))

        # 7. Demo Memory / Story
        story = Story(
            id=uuid4(),
            family_id=family.id,
            title="Өвөөгийн маань залуу нас ба нутгийн дурсамж",
            body="Өвөө маань дайны жилүүдэд болон дараа нь Завханы хөдөө нутгаар мал сүргийг эрүүлжүүлэхээр өдөр шөнөгүй мориор явж эмчилдэг байсан тухай аав маань үргэлж бахархан ярьдаг байв. Гуулин өвөөгийнхөө ажилч хичээнгүй, шулуун шудрага занг бид өнөөдөр ч бахархан дурсаж байна.",
            created_by=user.id,
            event_date=date(1950, 1, 1),
            place="Завхан аймаг",
            visibility="family",
            created_at=now,
            updated_at=now,
        )
        db.add(story)
        db.flush()

        db.add(StoryPerson(
            id=uuid4(),
            story_id=story.id,
            family_id=family.id,
            person_id=p_guulin.id,
        ))

        # Demo Memory
        memory = Memory(
            id=uuid4(),
            family_id=family.id,
            title="Гуулингийнхны 1970-аад оны гэр бүлийн цугларалт",
            description="Ургамал сумын төвд бүх ах дүү, үр хүүхдүүд цугларсан түүхэн өдөр.",
            created_by=user.id,
            memory_date=date(1975, 7, 12),
            visibility="family",
            created_at=now,
            updated_at=now,
        )
        db.add(memory)

        db.commit()
        print("Demo seeding completed successfully!")
        print(f"User: {demo_email}")
        print("Password: Password123!")
        print(f"Family ID: {family.id}")
        print(f"Persons count: {len(all_persons)}")

    except Exception as e:
        db.rollback()
        print(f"Error seeding demo data: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed()
