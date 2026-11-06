# Дэлхийн Жишиг QA, SDET, Performance Testing & Cybersecurity Стандарт

Энэхүү систем болон төслүүдэд програм хангамжийн чанарыг шалгах, тест автоматжуулах, эмзэг байдал илрүүлэх, кибер аюулгүй байдлыг хангахдаа дараах дэлхийн жишиг (Staff+ SDET & Principal Security Architect) стандартыг чанд мөрдөнө:

## 1. Quality Assurance & Test Strategy
- **Test Pyramid Integrity**: 70% Unit (хурдан, найдвартай), 20% Integration/Contract, 10% End-to-End (E2E) тэнцвэрийг хатуу барих.
- **Defect Lifecycle & RCA**: Аливаа илэрсэн алдааны Root Cause Analysis (RCA)-г хийж, давтан гарахаас сэргийлсэн автомат регрессийн тест нэмэх.

## 2. Manual & Exploratory Testing
- **Session-Based Exploratory Testing**: Хэрэглэгчийн таамаглаагүй үйлдлүүд, сөрөг (negative scenarios), хилийн утгууд (Boundary Value Analysis), эквивалент ангилал (Equivalence Partitioning)-аар турших.
- **Edge & Corner Cases**: Сүлжээний тасалдал, сервер хоцролттой үеийн UI feedback, давхар click, хязгаарын өгөгдлийн шалгалт.

## 3. Automation QA & SDET (Software Development Engineer in Test)
- **Hermetic & Deterministic Testing**: Тестүүд гадаад сүлжээ, гуравдагч системээс хамааралгүй (Mock/Stub), бие даасан, зэрэгцээ (parallel) ажиллах боломжтой байх.
- **Modern Frameworks**: Playwright / Cypress (Web E2E), Pytest / Vitest / Jest (Unit & Integration), Pact (Consumer-Driven Contract Testing).
- **Flaky-Test Elimination**: Тогтворгүй, санамсаргүй унадаг (flaky) тестүүдийг хатуу хориглож, зөв explicit wait, network interception ашиглах.

## 4. Performance & Load Testing
- **Load, Stress & Spike Testing**: k6, Locust ашиглан системийн даах дээд хязгаар (Capacity limit), гэнэтийн ачааллын огцом өсөлт (Spike test), урт хугацааны тэсвэрийг (Soak test) шалгах.
- **Bottleneck Diagnosis**: CPU saturation, Memory leak, Database connection starvation, slow queries, thread contention-ийг метрикээр илрүүлэх.

## 5. Security Architecture & Threat Modeling
- **STRIDE Threat Modeling**: Архитектурын түвшинд Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege эрсдэлийг тооцоолох.
- **Zero Trust & Defense in Depth**: Дотоод сүлжээнд ч итгэхгүй байх (Never trust, always verify). Олон давхаргат хамгаалалттай ажиллах.

## 6. Penetration Testing & Ethical Hacking
- **Offensive Security Testing**: OWASP Top 10 (Injection, Broken Auth, SSRF, IDOR, Security Misconfiguration), API Security Top 10 дагуу симуляци халдлага хийх.
- **Fuzzing & Payload Injection**: Оролтын талбаруудад тусгай тэмдэгт, урт текст, buffer overflow, SQL/Command injection payload явуулж шалгах.

## 7. Application Security (AppSec) & DevSecOps
- **Shift-Left Security**: Аюулгүй байдлын шалгалтыг deployment-ийн өмнө CI/CD хоолойд автоматаар хийх:
  - *SAST (Static Analysis)*: Кодоос нууц түлхүүр, сул код илрүүлэх (Semgrep, SonarQube).
  - *SCA (Software Composition Analysis)*: Гуравдагч сангуудын CVE эмзэг байдлыг шалгах (Trivy, Dependabot, Snyk).
  - *DAST (Dynamic Analysis)*: Ажиллаж буй серверийг гаднаас скан хийх (OWASP ZAP).
- **Secrets Detection**: Git репозитор руу API түлхүүр, password орохоос pre-commit hook (Gitleaks, TruffleHog)-оор сэргийлэх.

## 8. SOC (Security Operations Center) & Defensive Monitoring
- **Centralized Audit Trails**: Системийн нэвтрэлт, эрх өөрчлөлт, чухал өгөгдөлд хандсан бүх үйлдлийг өөрчлөх боломжгүй (tamper-proof) аудитын логт бүртгэх.
- **Anomaly Detection & Incident Playbooks**: Хэвийн бус олон тооны амжилтгүй нэвтрэлт, ер бусын байршлаас хандсан хүсэлтийг бодит цагт илрүүлж автоматаар block хийх.
