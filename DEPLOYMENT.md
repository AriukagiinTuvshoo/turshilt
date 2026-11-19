# Гуулингийнхан — Production Байршуулалт ба Ашиглалтын Гарын Авлага

Энэхүү гарын авлага нь **Гуулингийнхан** төслийг орон нутгийн хөгжүүлэлт болон **Production** орчинд аюулгүй, тасралтгүй байршуулах бүх алхмыг тодорхойлно.

---

## 1. Орон нутгийн хөгжүүлэлт (Docker / Local)

```bash
# Орон нутгийн PostgreSQL + FastAPI эхлүүлэх
docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000` · OpenAPI: `/docs`
- Эрүүл мэндийн цэгүүд: `/health`, `/ready`, `/health/ready`

---

## 2. Production орчны заавал шаардлагатай тохиргоонууд

`APP_ENV=production` үед [backend/app/config.py](backend/app/config.py) дараах нөхцөлийг хатуу шалгаж, дутуу бол серверийг эхлүүлэлгүй шууд зогсооно:

| Бүрэлдэхүүн | Заавал шаардах хувьсагчид | Тэмдэглэл |
| :--- | :--- | :--- |
| **PostgreSQL 16** | `DATABASE_URL=postgresql+psycopg://...` | SQLite зөвшөөрөхгүй. Connection pool-ийг `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`-аар тохируулна. |
| **CORS & HTTPS** | `CORS_ORIGINS=https://taны-домайн.mn` | `*` болон `http://` origin хориотой (`Secure; HttpOnly; SameSite=None` cookie тул). |
| **Cloudflare R2 / S3** | `STORAGE_PROVIDER=s3`, `STORAGE_ENDPOINT` (`https://...`), `STORAGE_BUCKET`, `STORAGE_REGION=auto`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | R2 endpoint нь `https://<account_id>.r2.cloudflarestorage.com` хэлбэртэй байна. |
| **Имэйл (SMTP)** | `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `EMAIL_PUBLIC_BASE_URL=https://...`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT=587`, `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, `EMAIL_SMTP_STARTTLS=true` | `STARTTLS` заавал идэвхтэй байна. |
| **Утасны OTP (Twilio)** | `OTP_HASH_SECRET` (`openssl rand -hex 32`), `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Хөгжүүлэлтийн `fake` горим production-д ажиллахгүй. |
| **Google OIDC (Сонголт)** | `GOOGLE_OIDC_ENABLED=true`, `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`, `GOOGLE_OIDC_REDIRECT_URI=https://.../api/v1/auth/google/callback`, `GOOGLE_OIDC_STATE_SECRET` (32+ тэмдэгт) | Google Cloud Console дээр callback URI яг таарсан байна. |
| **Хогийн сав хадгалалт** | `TRASH_RETENTION_DAYS=30` | Устгагдсан бүртгэлийг хэдэн хоног хадгалах хугацаа (`1..365`). |

---

## 3. Deploy хийхийн өмнөх бэлэн байдлын шалгалт (Pre-Flight Check)

Нууц утгуудыг лог руу хэвлэлгүйгээр тохиргоо, PostgreSQL болон S3/R2 холболтыг урьдчилан шалгах комманд:

```bash
cd backend

# 1. Зөвхөн env файлын бүх дүрмийг шалгах
uv run python scripts/check_production_config.py --env-file .env.production

# 2. Live PostgreSQL + Cloudflare R2 / S3 холболтыг хамт шалгах
uv run python scripts/check_production_config.py --env-file .env.production --check-db --check-storage
```

JSON гаралт шаардлагатай бол `--json` нэмнэ. Амжилттай бол `exit code 0` буцаана.

---

## 4. Эрүүл мэндийн шалгалт (`/health`, `/ready`, `/health/ready`)

- `GET /health` → Процесс амьд эсэхийг шалгана (**Liveness probe** — `200 {"status": "ok"}`).
- `GET /ready` болон `GET /health/ready` → PostgreSQL холболтыг `SELECT 1`-ээр шалгана (**Readiness probe** — хэвийн бол `200`, DB унасан бол `503 DATABASE_UNAVAILABLE`). Load balancer / Kubernetes / Railway / Render бүгд `/ready` эсвэл `/health/ready` хаяг руу чиглүүлнэ.

---

## 5. Production-д байршуулах аргууд

### Сонголт А: Нэг сервер дээр Docker Compose (`docker-compose.prod.yml`)

```bash
# 1. Тохиргооны файлуудыг бэлтгэх
cp .env.production.example .env
cp backend/.env.example backend/.env.production
# -> .env болон backend/.env.production доторх бодит нууц үг, R2, SMTP, Twilio утгуудыг бөглөнө

# 2. Тохиргоог урьдчилан шалгах
cd backend && uv run python scripts/check_production_config.py --env-file .env.production && cd ..

# 3. db + api (auto alembic migration) + web (Next.js standalone) + maintenance (өдөр бүрийн cron) асаах
docker compose -f docker-compose.prod.yml up -d --build
```

Reverse proxy (Nginx / Caddy / Cloudflare Tunnel) нь `https://taны-домайн.mn` → `127.0.0.1:3000`, `https://api.taны-домайн.mn` → `127.0.0.1:8000` руу чиглүүлнэ.

### Сонголт Б: Vercel (Frontend) + Railway / Render (Backend + Postgres)

1. **Frontend (Vercel)**: Root directory `.` — заавал `NEXT_PUBLIC_API_BASE_URL=https://api.taны-домайн.mn/api/v1` тохируулна (`scripts/verify-production-env.mjs` шалгана).
2. **Backend (Railway / Render)**: `backend/Dockerfile`-ийг ашиглан deploy хийнэ (`alembic upgrade head` автоматаар ажиллана). Readiness probe-ийг `/ready` болгоно.

---

## 6. Хогийн савны 30 хоногийн автомат цэвэрлэгч ба Арын засвар үйлчилгээ (Maintenance CLI / Cron)

[`backend/app/maintenance.py`](backend/app/maintenance.py) нь дараах 4 цэвэрлэгээг нэг transaction-аар гүйцэтгэнэ:
1. `TRASH_RETENTION_DAYS` (анхдагчаар 30 хоног)-оос хэтэрсэн `FamilyTrashRecord` бүртгэлийг устгаж, ямар ч гэр бүл/хэрэглэгчтэй холбогдоогүй өнчин (`orphan`) `Person` мөрүүдийг цэвэрлэнэ.
2. Хугацаа дууссан `UserSession`, `EmailVerificationToken`, `PasswordResetToken` болон 24+ цаг хэтэрсэн `PhoneOtpChallenge` мөрүүдийг устгана.
3. Бүх гэр бүлийн `deletion_pending` эсвэл 15 минутаас удсан `uploading` зургуудыг Object Storage-аас цэвэрлэнэ.

### Гар ажиллагаа ба Dry-Run тест

```bash
cd backend

# Устгах зүйлсийг устгалгүйгээр зөвхөн тоолж харах (Dry-Run)
uv run python scripts/run_maintenance.py --dry-run --json

# Бодитоор гүйцэтгэх
uv run python scripts/run_maintenance.py --json
```

### Автомат хуваарь (Cron) тохируулах
- **Docker Compose Prod**: `maintenance` сервис автоматаар 24 цаг тутам ажиллана.
- **Linux Cron** (өдөр бүрийн 03:00 цагт):
  ```cron
  0 3 * * * cd /srv/guulin/backend && uv run python scripts/run_maintenance.py --json >> /var/log/guulin-maintenance.log 2>&1
  ```
- **Railway / Render Cron Job**: Өдрийн 1 удаа `uv run python scripts/run_maintenance.py --json` комманд өгнө.

---

## 7. Нөөцлөлт (Backup) ба Сэргээлт (Restore Runbook)

1. **Managed PostgreSQL** дээр өдөр тутмын snapshot, **Cloudflare R2 / S3** bucket дээр Object Versioning идэвхжүүлнэ.
2. **Migration дүрэм**: Production орчинд schema ухраах (`alembic downgrade`) хийхгүй; алдаа гарвал forward-fix migration эсвэл DB snapshot-аас сэргээнэ.
3. **Сэргээлт шалгах дараалал**: Snapshot сэргээх → `alembic current && alembic upgrade head` → `GET /ready` `200` → нэвтрэлт + гэр бүлийн мод + хувийн зураг унших smoke test хийж баталгаажуулна.
