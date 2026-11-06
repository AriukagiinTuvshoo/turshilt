# Дэлхийн Жишиг DevOps, Cloud, SRE, Platform & Infrastructure Стандарт

Энэхүү систем болон төслүүдэд дэд бүтэц, үүлэн технологи, автоматжуулалт, найдвартай ажиллагааг хангахдаа дараах дэлхийн жишиг (Staff+ Platform/DevOps Engineer & Principal SRE) стандартыг чанд мөрдөнө:

## 1. DevOps & CI/CD Engineering
- **Trunk-Based Development**: Богино хугацаат feature branch, жижиг PR, автомат шалгалт (Automated Lint, Test, Security Scan).
- **Zero-Downtime Deployment**: Blue/Green, Canary, Rolling deployments ашиглаж, хэрэглэгчийн үйлчилгээг тасалдуулахгүйгээр шинэ хувилбар гаргах.
- **Fail-Fast & Auto-Rollback**: Health check унасан үед автоматаар өмнөх тогтвортой хувилбар руу буцах (automated rollback).

## 2. Cloud Engineering & Multi-Cloud (AWS, GCP, Azure)
- **Cloud-Native Architecture**: Монолитээс үүлэн дэд бүтцийн давуу талыг бүрэн ашигласан stateless services, managed queues, object storage, serverless functions.
- **Least Privilege IAM**: Аюулгүй байдлын үүднээс аливаа сервис, хэрэглэгчид зөвхөн шаардлагатай эрхийг хамгийн бага түвшинд олгох (Zero-Trust Security).

## 3. Cloud Architecture & Well-Architected Framework
- **5 Pillars of Cloud Architecture**:
  1. *Operational Excellence*: Кодоор удирдах дэд бүтэц, тогтмол сайжруулалт.
  2. *Security*: Бүх өгөгдлийг дамжих (in-transit) болон хадгалагдах (at-rest) үед шифрлэх.
  3. *Reliability*: Олон бүсэд хуваарилагдсан (Multi-AZ) өндөр бэлэн байдал (High Availability).
  4. *Performance Efficiency*: Ачааллаас хамаарч автоматаар өсөх/буурах (Auto-scaling).
  5. *Cost Optimization*: Сул зогсож буй нөөцийг зогсоох, rightsizing, reservation/savings plans.

## 4. Site Reliability Engineering (SRE)
- **SLI, SLO & SLA Framework**: Хэмжигдэхүйц Service Level Indicators (амжилттай хүсэлтийн хувь, latency), тодорхой SLO (99.9% uptime), алдааны төсөв (Error Budget).
- **Incident Response & Blameless Postmortems**: Осол, саатлын дараа хүнийг буруутгахгүйгээр системийн сул талыг олж засварлах, дахин давтагдахаас сэргийлэх RCA (Root Cause Analysis).
- **Chaos Engineering & Resilience**: Дэд бүтцийн гэнэтийн уналтад систем хэрхэн тэсвэрлэхийг тогтмол турших.

## 5. Linux & Systems Administration
- **Hardened OS & Kernel Tuning**: SSH root login хаах, public key auth мөрдөх, ulimit, sysctl сокет параметруудыг ачаалалд тохируулах.
- **systemd & Service Isolation**: Background service-үүдийг cgroups, isolated namespaces дотор хязгаарлагдмал эрхээр ажиллуулах.

## 6. Network Engineering & High-Speed Traffic
- **Modern Protocols**: TLS 1.3, HTTP/2, HTTP/3 (QUIC) дэмжлэг, хүчинтэй SSL/TLS сертификатын автомат сунгалт (Let's Encrypt / Cloudflare).
- **VPC & Subnet Isolation**: Өгөгдлийн санг зөвхөн Private Subnet-д байршуулж, нийтийн интернэтээс хатуу тусгаарлах. Reverse proxy (Nginx, Traefik, Envoy, Cloudflare Edge)-ээр ачаалал хуваарилах (Load Balancing).

## 7. Platform Engineering & Developer Experience (IDP)
- **Container Orchestration (Kubernetes & Docker)**: Мульти-стейж Dockerfile, Distroless/Alpine жижиг бөгөөд аюулгүй контейнерүүд, k8s Pod Resource Limits (requests/limits).
- **GitOps (ArgoCD / Flux)**: Дэд бүтцийн хүссэн төлөвийг Git репозитортоос автоматаар синхрончлох.

## 8. Infrastructure as Code (IaC)
- **Terraform / OpenTofu / Pulumi**: Дэд бүтцийн тохиргоог гараар хэзээ ч хийхгүй (No ClickOps). Бүх серверийг код хэлбэрээр илэрхийлж, Remote State Lock (S3+DynamoDB / GCS) ашиглах.
- **Drift Detection**: Кодоос гадуур өөрчлөгдсөн дэд бүтцийн зөрүүг тогтмол илрүүлж арилгах.

## 9. Build, Release & Supply Chain Security
- **Artifact Registry**: Docker image, npm package, python wheel-үүдийг хувилбаржуулан найдвартай бүртгэлд хадгалах.
- **Software Supply Chain Security**: Container скан хийх (Trivy, Grype), хамаарлын CVE эмзэг байдлыг шалгах, SBOM (Software Bill of Materials) бүрдүүлэх.

## 10. Database Administration (DBA) & High Availability
- **Automated Backups & PITR**: Өгөгдлийн сангийн өдөр тутмын бүрэн хуулбар болон Point-In-Time Recovery (WAL archiving) тохируулах.
- **Connection Pooling & HA**: PgBouncer ашиглан холболтын түгжрэлээс сэргийлэх, Read-Replica ашиглан унших ачааллыг хуваарилах.
