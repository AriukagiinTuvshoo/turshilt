# Дэлхийн Жишиг Инженерчлэл, Дизайн ба Дижитал Урлагийн Мастер Стандарт (AGENTS.md)

Энэхүү төсөл болон системийн бүх түвшинд аливаа шийдэл гаргах, дизайн хийх, код бичих, 3D/Motion урлах, тестлэх, рефакторинг хийхдээ дараах дэлхийн жишиг (Staff+ Engineer, Principal Designer & Technical Director) стандартыг чанд баримтална:

---

# I ХЭСЭГ: Дэлхийн Жишиг Инженерчлэлийн Стандарт

## 1. Frontend Engineering (React 19, Next.js App Router, TypeScript)
- **Architecture**: Server Components (RSC) болон Client Components (`'use client'`)-ийн үүрэг хариуцлагын заагийг нарийн тусгаарлах. Client bundle хэмжээг хамгийн бага (zero/minimal hydration overhead) түвшинд барих.
- **State & UI**: Local vs Global state-ийг зөв зохион байгуулах, prop drilling үүсгэхгүй байх, Suspense болон ErrorBoundary-г оновчтой ашиглах.
- **Styling**: Responsive, mobile-first, уян хатан CSS/Tailwind бүтэц, тогтвортой design tokens мөрдөх.

## 2. Backend Engineering (FastAPI, Python, Clean Architecture)
- **Domain-Driven Design (DDD)**: Бизнес логик, өгөгдлийн сангийн хүснэгт, API endpoint-үүдийг бие даасан давхаргуудад тусгаарлах.
- **Concurrency & Reliability**: Async/await бүтэц, connection pooling, graceful shutdown, exception handling, background worker аюулгүй байдал.
- **Logging & Observability**: JSON бүтэцтэй structured log, request ID correlation tracing, метрик хяналт.

## 3. Full-Stack Cohesion
- Төгсгөлөөс төгсгөл (End-to-End) хүртэл төрлийн бүрэн бүтэн байдал (Type Safety): Backend Pydantic schema-аас Frontend TypeScript types хүртэл нэгдмэл загварчлах.
- Client-Server хоорондын contract-ийг үнэн зөв хадгалах, өгөгдлийн хэлбэр өөрчлөгдөхөд бүх шатанд синхрончлогдох.

## 4. Software Engineering & Systematic Design
- **SOLID, DRY, KISS, YAGNI** зарчмуудыг амьдралд бодитоор мөрдөх.
- Өргөтгөх боломжтой (Extensible), уншихад ойлгомжтой, modular кодын бүтэц бүрдүүлэх.

## 5. API Development (RESTful & Beyond)
- Стандарт HTTP метод болон статус кодуудыг (200, 201, 204, 400, 401, 403, 404, 409, 422, 429) зориулалтаар нь хэрэглэх.
- Алдааны нэгдсэн бүтэц (RFC 7807 problem details), Idempotency түлхүүрүүд, cursor-based pagination, rate limiting хамгаалалт.

## 6. Database Engineering (PostgreSQL, SQLAlchemy, Alembic)
- **Integrity**: Хүснэгтийн бүрэн нормалчлал, Foreign Key cascades, CHECK constraints, partial/composite indexes.
- **Zero-Drift Migrations**: Модел болон Alembic migration-ийг 100% нийцүүлэх.
- **Performance**: N+1 query-гээс бүрэн сэргийлэх (`selectinload`, `joinedload`), explain analyze хийгдсэн index design.

## 7. Web Performance & Optimization
- **Core Web Vitals**: LCP (Largest Contentful Paint), INP (Interaction to Next Paint), CLS (Cumulative Layout Shift) үзүүлэлтүүдийг дээд зэргээр оновчлох.
- Олон түвшний кэшлэлт (HTTP Cache-Control, Stale-While-Revalidate, CDN/Edge).
- Зураг болон медиа файлуудыг шахах, WebP/AVIF формат, lazy-loading.

## 8. Accessibility (a11y)
- **WCAG 2.2 Level AA/AAA** стандартын дагуу семантик HTML tags (`<main>`, `<nav>`, `<article>`, `<button>`, `<dialog>` гэх мэт) ашиглах.
- Дэлгэц уншигч (Screen Reader) болон зөвхөн гараар (Keyboard navigation/Focus management) бүрэн ашиглах боломжийг хангах.
- Өнгөний тохироо (Color contrast ratio >= 4.5:1).

## 9. Web Security Engineering (Defense in Depth)
- **OWASP Top 10** хамгаалалт: SQL Injection, XSS, CSRF, IDOR-оос 100% сэргийлэх.
- Нууцлал: Нууц үгийг найдвартай hash-лах, токен HMAC-SHA256, Secure + HttpOnly + SameSite cookies.
- Зөвшөөрлийн хяналт (Role-Based & Resource-Based Access Control).

## 10. Continuous Learning & Industry Benchmarking
- Дэлхийн нээлттэй эхийн шилдэг төслүүд, алдартай инженерүүдийн туршлага, real-world high-scale архитектурын сургамжаас байнга суралцаж, кодын шийдлийг дээд түвшинд хүргэх.

---

# II ХЭСЭГ: Дэлхийн Жишиг UI/UX, Бүтээгдэхүүн ба Визуал Дизайны Стандарт

Гуулингийнхан төслийн интерфейс, зураглал, бичвэр, харилцан үйлчлэл (interaction)-ийг дэлхийн шилдэг бүтээгдэхүүнүүдийн түвшинд урлахын тулд дараах 8 чиглэлийн дизайны стандартыг чанд мөрдөнө:

## 1. UI (User Interface) & Layout Design
- **Visual Hierarchy**: Мэдээллийн ач холбогдлын дарааллыг хэмжээ, зай, өнгө, тодотголоор тодорхой илэрхийлэх (F-pattern, Z-pattern уншилтын загвар).
- **Spatial System (8pt Grid)**: Бүх padding, margin, element хэмжээг 4px/8px-ийн хатуу тор (grid)-д нийцүүлэх. Тогтмол spacing tokens (`space-2`, `space-4`, `space-8`).
- **Responsive & Fluid Layout**: Mobile (360px), Tablet (768px), Desktop (1024px+), Ultra-wide дэлгэцүүдэд эвдрэлгүй, уян хатан, fluid typography болон adaptive components хэрэглэх.

## 2. UX (User Experience) & Product Design
- **Cognitive Load Reduction (Miller's Law / Hick's Law)**: Нэг дэлгэц дээрх хэрэглэгчийн тархинд ирэх ачааллыг хамгийн бага байлгах; ургийн мод, олон үеийн өгөгдлийг шат дараатай дэлгэх (Progressive Disclosure).
- **Intuitive Flow**: Бүртгүүлэхээс эхлээд өвөг дээдсээ нэмэх, гэр бүлээ урих хүртэлх алхам бүр үрэлтгүй (frictionless), таамаглахуйц, энгийн байх.
- **Mental Model Alignment**: Монгол гэр бүлийн уламжлалт ургийн бичиг, удмын ухааны сэтгэлгээний хэв маягийг орчин үеийн дижитал бүтээгдэхүүний өгөгдлийн загварт төгс буулгах.

## 3. Interaction & Motion Design
- **Micro-interactions**: Товч дарах, модны мөчир нээгдэх, карт hover хийх үйлдлүүдэд 150-250ms үргэлжлэх, байгалийн физик хуульд нийцсэн (cubic-bezier easing) хариу үйлдэл үзүүлэх.
- **State Feedback**: Hover, Active, Focus, Loading, Skeleton, Empty, Error, Success төлөв бүр visual тодорхой ялгаатай байх. Хэрэглэгчийг хэзээ ч "юу болж байгааг мэдэхгүй" хоосон төлөвт орхихгүй байх.

## 4. Design System & UX Engineering
- **Unified Design Tokens**: Өнгө (`color-primary`, `color-surface`, `color-text-muted`), үсгийн хэмжээ, радиус (`rounded-lg`), сүүдэр (`shadow-sm`, `shadow-md`)-ийг нэгдсэн эх сурвалжаас удирдах.
- **Reusable Component Architecture**: UI-ийн component-үүд бие даасан, prop-driven, variant-based (CVA / Tailwind Variants), өргөтгөх боломжтой загварчлагдах.
- **Design-to-Code Fidelity**: Дизайн дахь pixel-perfect мэдрэмж, хөдөлгөөн код дээр 100% бодит биеллээ олох.

## 5. Visual, Brand & Heritage Aesthetics
- **Cultural Resonance & Modernity**: Өв уламжлал, түүхийн хүндэтгэлтэй эрхэм чанарыг орчин үеийн цэвэр минимал (clean modern minimalism) дижитал хэв маягтай уялдуулах.
- **Color Palette & Contrast**: Гол өнгө, дэвсгэр, туслах өнгөнүүд сэтгэл зүйд тайван, түүх өгүүлсэн мэдрэмж төрүүлэх бөгөөд WCAG 4.5:1 contrast стандартыг хангах.

## 6. Typography & Iconography
- **Typography Excellence**: Уншихад хамгийн тухтай үсгийн фонт сонголт (Монгол кирилл тэмдэгтүүдийн хэлбэр төгс дэмжигдсэн), line-height (1.5-1.6x), letter-spacing, paragraph hierarchy.
- **Cohesive Iconography**: Lucide React болон тусгай дүрс тэмдгүүд нь нэг ижил stroke-width, corner-radius, visual weight-тэй байх.

## 7. UX Writing & Microcopy
- **Clear & Respectful Language**: Аппын товч, заавар, алдааны мэдэгдэл, баталгаажуулах текстийг ойлгомжтой, төөрөгдөлгүй, хүндэтгэсэн найруулгатай бичих.
- **Action-Oriented Labels**: "Тийм/Үгүй" гэхийн оронд "Хадгалах", "Ургийн модонд нэмэх", "Урилга цуцлах" зэрэг тухайн үйлдлийг шууд илэрхийлсэн үг хэллэг хэрэглэх.

## 8. UX Research & Continuous User-Centric Evolution
- Бодит хэрэглэгчдийн зан төлөв, санал сэтгэгдэл, алдааны аналитикт тулгуурлан UI/UX-ийг тасралтгүй туршиж, хамгийн төгс хэрэглэгдэхүүн болгон сайжруулах.

---

# III ХЭСЭГ: Дэлхийн Жишиг Motion, 3D, Video, VFX & Game/Technical Art Стандарт

Дижитал бүтээгдэхүүн, интерактив орчин, 3D дүрслэл, хөдөлгөөнт медиа урлахад дараах дэлхийн жишиг стандартуудыг мөрдөнө:

## 1. Motion Design & Motion Graphics
- **Physics-Based Animation**: Хөдөлгөөн бүр байгалийн физик инерци, mass, tension, friction (Spring physics, cubic-bezier) хуулиудад нийцсэн байх.
- **Narrative Motion**: Хөдөлгөөн нь зөвхөн гоёл бус, хэрэглэгчийн анхаарлыг чиглүүлэх (Focal direction), мэдээллийн учир шалтгааныг ойлгуулах зорилготой байх.
- **Typography & Kinetic Motion**: Текст, дүрс, өгөгдлийн графикийг ойлгомжтой, хэмнэлтэй (rhythm & pacing), 60fps/120fps smooth хөдөлгөөнд оруулах.

## 2. 3D Art & Modeling (Topology & Optimization)
- **Clean Quad Topology**: Бүх 3D объектын торон бүтэц (topology) цэвэр, non-manifold geometry-гүй, sub-division болон deformation-д алдаагүй байх.
- **PBR Texturing & Shading**: Бодит физикт нийцсэн материал (Physically Based Rendering — Albedo, Roughness, Metallic, Normal, Ambient Occlusion).
- **LOD (Level of Detail)**: Вэб/бодит цагийн системд зориулсан полигоны тоог оновчлох, baking (High-poly-оос Low-poly руу normal map буулгах).

## 3. 3D Animation & Rigging
- **12 Principles of Animation**: Сонгодог 12 зарчим (Squash & stretch, Anticipation, Staging, Follow-through, Ease-in/out, Arc, Secondary action, Timing, Exaggeration, Solid drawing, Appeal)-ийг 3D дүр болон объект бүрт бүрэн шингээх.
- **Modular & Clean Rigging**: Хялбар удирдах боломжтой IK/FK switch, spine twist, face blendshapes бүхий хөдөлгөөний араг яс угсрах.

## 4. Video Editing & Cinematography
- **Rhythmic Pacing & Cut Precision**: Видео эвлүүлгийн хэмнэл, өгүүлэмжийн оргил үе, J-cut, L-cut, match-cut ашиглан үзэгчийн сэтгэл хөдлөлийг хөтлөх.
- **Color Grading & ACES Workflow**: Өнгөний стандарт (Rec.709, Rec.2020, ACES), contrast, mood болон narrative grading-ийг нарийн тохируулах.
- **Sound Design & Audio Mixing**: Хөдөлгөөн бүрд тохирох sound effect (foley), ambiances, voiceover болон арын хөгжмийн dynamic range, LUFS стандартыг барих.

## 5. VFX (Visual Effects) & Compositing
- **Photorealistic Integration**: Гэрэл, сүүдэр, grain, depth of field, motion blur-ийг бодит бичлэг эсвэл 3D орчинтой төгс уусгах (compositing).
- **Procedural Particle & Simulation**: Утаа, гал, ус, тоосонцор, динамик хэлбэрүүдийг физикийн хуульд нийцүүлэн симуляци хийх.

## 6. Game Art & Interactive 3D
- **Real-Time Rendering Budget**: Draw calls, shader complexity, texture memory footprint-ийг тооцоолж, вэб (Three.js, WebGL, WebGPU) болон game engine (Unreal, Unity)-д өндөр FPS үзүүлэлттэй байлгах.
- **Spatial Audio & Environmental Storytelling**: Орчны гэрэлтүүлэг, тусгал, орон зайн дуугаар дамжуулан тоглогчид ертөнцийг мэдрүүлэх.

## 7. Technical Art (The Bridge between Art & Code)
- **Shader Programming & Math**: GLSL, HLSL, WebGPU WGSL болон vector/matrix математикт тулгуурлан өвөрмөц visual shader, procedural effect бүтээх.
- **Pipeline Automation**: 3D болон график хөрөнгийг кодод автоматаар бэлтгэх (glTF/GLB compression, Draco/Meshopt compression, WebP/KTX2 textures) скрипт, toolchain бүтээх.


---

# IV ХЭСЭГ: Дэлхийн Жишиг AI, Autonomous Agents, Data Science & MLOps Стандарт

Интеллект систем, хиймэл оюун ухаан, өгөгдлийн инженерийн шийдлүүдийг боловсруулахдаа дараах дэлхийн жишиг стандартуудыг мөрдөнө:

## 1. AI Engineering & Application Architecture
- **Production-Grade GenAI**: LLM дуудлагуудад тодорхой timeout, exponential backoff бүхий retry логик, fallback models тохируулах.
- **Structured Output & Schema Enforcement**: Pydantic / Zod schema-аар AI-ийн гаралтыг хатуу хэвшүүлэн баталгаажуулж, parsing алдаанаас 100% сэргийлэх.
- **RAG (Retrieval-Augmented Generation)**: Chunking оновчлол (semantic chunking, sliding window), hybrid search (Dense vector + Sparse BM25), re-ranking (Cross-encoder) болон context relevance metric-үүдийг баримтлах.
- **Cost & Latency Optimization**: Prompt caching, semantic response caching, token usage budgeting, streaming UI integration.

## 2. Autonomous AI Agents & Tool Grounding
- **Agentic Architectures**: ReAct (Reasoning + Acting), Plan-and-Solve, Reflection болон Multi-Agent Collaboration загваруудыг зөв ашиглах.
- **Deterministic Tool Calling**: Агентын багаж хэрэгслийн schema (OpenAPI/JSON Schema)-г алдаагүй тодорхойлж, хэрэгслийн аюулгүй байдлын хязгаарлалт (destructive action confirmation)-ийг хэрэгжүүлэх.
- **State & Memory Management**: Short-term (conversation context), long-term (vector/episodic memory), summarize-on-overflow стратегиудыг зохион байгуулах.
- **Deterministic Evaluation**: Агентын найдвартай байдлыг үнэлэх автомат benchmark, trace logging (LangSmith, Phoenix гэх мэт) мөрдөх.

## 3. LLM Engineering & Model Fine-Tuning
- **Prompt Engineering Excellence**: System prompt clarity, few-shot demonstrations, chain-of-thought (CoT), negative constraints, XML/Markdown boundary formatting.
- **Efficient Fine-Tuning**: PEFT (Parameter-Efficient Fine-Tuning), LoRA, QLoRA, alignment (DPO, RLHF, ORPO) арга барилуудыг оновчтой хэрэглэх.
- **Safety & Guardrails**: Prompt Injection, Jailbreak, Data Leakage-аас сэргийлэх оролт/гаралтын шүүлтүүр (Llama Guard, NeMo Guardrails).

## 4. Machine Learning & Deep Learning (PyTorch, Scikit-Learn)
- **Rigorous Validation**: Data leakage-ээс 100% сэргийлэх (Time-series / Group / Stratified K-Fold splitting), overfitting хяналт.
- **Reproducibility**: Random seed тогтоох, deterministic execution, бүх hyperparameter болон pipeline artifact-ийг бүртгэх.
- **Deep Neural Architecture**: Modern Transformer, CNN, GNN бүтцүүд, зөв weight initialization, gradient clipping, learning rate scheduling (Cosine Annealing).

## 5. Data Engineering & Pipeline Infrastructure
- **Clean ELT/ETL Architecture**: Өгөгдлийг түүхий (Bronze), цэвэрлэсэн (Silver), аналитик бэлэн (Gold) түвшнээр үе шаттай боловсруулах (Medallion Architecture).
- **Idempotent Data Pipelines**: Дахин ажиллуулахад давхардал үүсгэхгүй байх (Idempotency & Deduplication), backfill дэмжлэг.
- **Data Quality & Contracts**: Great Expectations, Soda, DBT tests ашиглан схем болон өгөгдлийн бүрэн бүтэн байдлыг алхам тутамд автоматаар шалгах.

## 6. Data Science & Advanced Analytics
- **Statistical Rigor**: Дүгнэлт гаргахдаа Hypothesis testing (p-value, confidence intervals), A/B testing statistical power calculation, Causal Inference аргуудыг мөрдөх.
- **Actionable Insights & Storytelling**: Тоон өгөгдлийг бизнес болон бүтээгдэхүүний бодит шийдвэр болгон хувиргах өндөр түвшний визуал тайлагнал (EDA).

## 7. MLOps & Production AI Lifecycle
- **Experiment Tracking & Model Registry**: MLflow, Weights & Biases ашиглан сургалтын бүх үр дүнг бүртгэж, хувилбаржуулах (Version Control for Data & Models — DVC).
- **Production Serving**: ONNX, TensorRT, vLLM, Triton Server ашиглан latency-г хамгийн бага түвшинд барьж, auto-scaling deployment хийх.
- **Continuous Monitoring**: Model drift, concept drift, data drift болон latency/throughput-ийг бодит цагт хянах (Evidently, Prometheus).

## 8. Computer Vision & Multimodal AI
- **Image & Video Understanding**: Detection (YOLO, DETR), Segmentation (SAM, Mask R-CNN), Feature Extraction, Multimodal Embeddings (CLIP).
- **Preprocessing & Augmentation**: Бодит орчны өөрчлөлтөд тэсвэртэй дата бэлтгэл (Albumentations), resolution optimization.

## 9. NLP & Speech Processing
- **Text & Audio Processing**: Advanced Tokenization, Named Entity Recognition (NER), Semantic Search, Embeddings, Whisper/TTS speech pipeline.
- **Multilingual Support**: Монгол хэлний өвөрмөц онцлог, кирилл/монгол бичгийн хөрвүүлэлт, морфологийн боловсруулалтыг төгс дэмжих.


---

# V ХЭСЭГ: Дэлхийн Жишиг Mobile, Desktop, Game, Embedded, Robotics & IoT Стандарт

Гар утас, суурин компьютер, тоглоом, суулгагдсан систем, робот болон ухаалаг төхөөрөмжийн шийдэл боловсруулахад дараах дэлхийн жишиг стандартуудыг мөрдөнө:

## 1. Native Mobile Engineering (iOS & Android)
- **iOS (Swift & SwiftUI)**: Apple Human Interface Guidelines, Swift Concurrency (`async/await`, `@MainActor`), Clean Architecture (MVVM/TCA), SwiftData/CoreData offline persistence.
- **Android (Kotlin & Jetpack Compose)**: Material 3, Coroutines/Flow, Hilt dependency injection, Room DB, WorkManager, Edge-to-Edge fluid UI.
- **Lifecycle & Performance**: Background throttling, memory leak prevention, thermal state awareness, push notification power efficiency.

## 2. Cross-Platform Mobile (Flutter & React Native)
- **Flutter**: Dart 3 soundness, BLoC/Riverpod state architecture, Impeller rendering engine, 120Hz smooth scrolling, Platform Channels type-safety.
- **React Native**: New Architecture (Fabric renderer + TurboModules), JSI direct execution, React Native Reanimated (UI thread), Expo EAS.
- **Adaptive Layout**: Утас, таблет, нугардаг (foldable) дэлгэцүүдэд эвдрэлгүй автоматаар зохицох adaptive responsive design.

## 3. Desktop Application Engineering (Tauri, Rust, Electron)
- **Security & Performance (Tauri & Rust)**: Rust backend бүхий жижиг bundle size, санах ойд хэмнэлттэй, аюулгүй sandbox архитектур.
- **OS Native Integration**: Windows, macOS, Linux системийн tray, native menus, global shortcuts, deep-linking, automatic background update.

## 4. Game Development & Interactive Real-Time Tech
- **Core Architecture**: ECS (Entity Component System) загвар, deterministic game loop (fixed time-step physics vs variable render time-step).
- **Engines & Performance**: Unreal Engine (C++/Nanite/Lumen), Unity (DOTS/C# Jobs), Godot, draw-call batching, spatial partitioning (Octree/BVH), memory pooling.

## 5. Embedded Systems & Bare-Metal Engineering
- **Safe & Predictable Code**: Embedded C, Modern C++20, Bare-metal Rust (`no_std`), memory allocation хязгаарлах (static allocation, zero heap fragmentation).
- **Hardware & RTOS**: ARM Cortex-M, ESP32, STM32, FreeRTOS / Zephyr үйлдлийн систем, hardware interrupt (ISR) latency оновчлол, watchdog timer хамгаалалт.

## 6. Robotics Engineering & Cyber-Physical Systems
- **ROS 2 (Robot Operating System)**: Node architecture, DDS (Data Distribution Service) QoS тохиргоо, real-time micro-ROS.
- **Kinematics & Spatial Computing**: Forward/Inverse Kinematics, SLAM, Nav2 motion planning, sensor fusion (Extended Kalman Filter for IMU/LiDAR).

## 7. IoT & Edge Systems
- **IoT Protocols & Reliability**: MQTT 5.0 (QoS levels), CoAP, BLE 5.x mesh, LoRaWAN, offline message queueing.
- **Edge Security & Firmware OTA**: Hardware crypto-element (secure boot, hardware keystore, TLS 1.3), A/B partition atomic OTA firmware updates.
