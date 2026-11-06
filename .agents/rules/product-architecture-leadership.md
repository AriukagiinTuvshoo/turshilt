# Дэлхийн Жишиг Product Management, Architecture, Leadership & Analysis Стандарт

Энэхүү систем болон төслүүдэд бүтээгдэхүүн тодорхойлох, архитектур шийдвэрлэх, баг зохион байгуулах, техникийн шийдэл зөвлөхдөө дараах дэлхийн жишиг (Principal Product Manager, Chief Architect & Director of Engineering) стандартыг чанд мөрдөнө:

## 1. Product Management & Strategy (PM & PO)
- **Problem-First Discovery**: Шийдэл рүү яарахын өмнө хэрэглэгчийн бодит өвдөлт (pain point), зах зээлийн хэрэгцээг нарийвчлан тодорхойлох.
- **Data-Driven Prioritization**: RICE (Reach, Impact, Confidence, Effort) болон MoSCoW матриц ашиглан backlog-ийн ажлуудыг эрэмбэлэх.
- **Product Requirements Document (PRD)**: Зорилго, хэрэглэгчийн түүх (User Stories), амжилтын хэмжүүр (North Star metric, KPIs), Acceptance Criteria (Gherkin: Given-When-Then)-ийг эргэлзээгүй тодорхой бичих.

## 2. Business & Systems Analysis (BA & SA)
- **Business to Technical Translation**: Бизнесийн логикийг техникийн нарийн функциональ болон функциональ бус шаардлага (NFR: Latency, Throughput, Security, Scalability) болгон хөрвүүлэх.
- **Process & Data Flow Modeling**: BPMN 2.0 процессийн урсгал, Sequence Diagrams, Data Flow Diagrams (DFD)-ээр системийн хил хязгаарыг алдаагүй зураглах.

## 3. Agile, Scrum & Project Delivery
- **Iterative Value Delivery**: 1-2 долоо хоногийн Sprint бүрт хэрэглэгчид бодит үнэ цэн өгөх ажилладаг бүтээгдэхүүний өсөлт (Increment) гаргах.
- **Continuous Flow & Blocker Removal**: Спринт төлөвлөлт, Retrospective, Daily Standup-ийг үр дүнтэй удирдан, багийн саад тотгорыг (blockers) нэн даруй арилгах.

## 4. Software & Solutions Architecture
- **Architecture Decision Records (ADR)**: Архитектурын чухал шийдвэр бүрийг контекст, сонгосон шалтгаан, үүсэх сөрөг тал/үр дагавар (trade-offs)-тай нь ADR хэлбэрээр баримтжуулах.
- **C4 Model Visual Architecture**: Системийг 4 түвшинд (Context, Containers, Components, Code) загварчилж, техникийн болон бизнесийн бүх талуудад ойлгомжтой байлгах.
- **Solutions Consulting & Fit**: Байгууллагын одоогийн систем, төсөв, аюулгүй байдлын шаардлагад хамгийн өндөр ROI (Return on Investment), хамгийн бага TCO (Total Cost of Ownership) авчрах шийдлийг санал болгох.

## 5. Technical Leadership & Engineering Management
- **High-Bar Code Standards**: Цэвэр код, автомат тест, архитектурын нийцлийг хангасан peer review соёл бүрдүүлэх.
- **Blameless Culture & Psychological Safety**: Алдаа гарах үед хүнийг биш системийг сайжруулах blameless соёл тогтоох, инженерийн багийг тасралтгүй өсгөх.
- **Technical Debt Management**: Шинэ боломж хөгжүүлэх болон техникийн өрийг (tech debt) барагдуулах хоорондын эрүүл тэнцвэрийг (80/20 дүрэм) хадгалах.

## 6. Technical Writing & Living Documentation
- **Diátaxis Documentation Framework**: Баримт бичгийг 4 үндсэн зорилгоор ангилан бичих:
  1. *Tutorials*: Анхлан суралцагчдад зориулсан алхам алхмаар хөтлөх заавар.
  2. *How-To Guides*: Тодорхой нэг асуудлыг шийдэх бодит заавар.
  3. *Reference*: API specs (OpenAPI/Swagger), өгөгдлийн схем, тохиргооны лавлах.
  4. *Explanation*: Архитектур, сонгосон зарчмын гүн тайлбар.
- **Docs-as-Code**: Баримт бичгийг кодын хамт Markdown форматаар Git репозитор дотор хадгалж, код өөрчлөгдөх бүрт шинэчилж байх.
