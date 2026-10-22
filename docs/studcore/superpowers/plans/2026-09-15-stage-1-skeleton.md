# StudCore, этап 1 «Скелет» — план реализации

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОД-НАВЫК: используйте
> superpowers:subagent-driven-development (рекомендуется) или
> superpowers:executing-plans для выполнения плана задача за задачей.
> Шаги размечены чекбоксами (`- [ ]`) для отслеживания.

**Цель:** пустое, но целиком работающее приложение — вход по паролю, изоляция
арендаторов на уровне PostgreSQL, миграции, вертикальный срез через все слои на
справочнике подразделений, CI и воспроизводимый деплой.

**Архитектура:** модульный монолит на Go. HTTP-слой на стандартном `net/http`
(маршрутизация по методу и пути появилась в Go 1.22, внешний роутер не нужен).
Доступ к данным — `pgx/v5` напрямую, без ORM. Изоляция арендаторов обеспечивается
Row Level Security: каждый запрос к доменным таблицам выполняется в транзакции,
где установлен `app.tenant_id`, и политика PostgreSQL физически не отдаёт чужие
строки. Фронтенд — отдельное SPA на Vite, в разработке ходит на API через прокси.

**Стек:** Go 1.26.6, PostgreSQL 16, pgx/v5, goose (встроенный в бинарник),
argon2id, React 19 + TypeScript + Vite, TanStack Query, testcontainers-go,
GitHub Actions, Docker Compose + Caddy.

**Спека:** `docs/superpowers/specs/2026-09-15-studcore-design.md`

## Глобальные ограничения

- **Путь модуля:** `github.com/serz/studcore`. Если аккаунт GitHub другой —
  поменять **до задачи 1**, дальше он зафиксирован во всех импортах.
- **Go 1.26.6**, **Node 24.16**, **PostgreSQL 16**. В `go.mod` директива версии — `go 1.26.0`: это каноническая форма, которую пишет сам тулчейн, и `go mod tidy` возвращает её обратно. Сокращённая запись `go 1.26` ломает сборку.
- **Язык кода — английский, язык сообщений пользователю и ошибок — русский.**
  Спека §6: технические коды пользователю не показываются, текст ошибки называет
  причину и способ исправления.
- **Мультиарендность:** каждая доменная таблица содержит `tenant_id NOT NULL` и
  находится под RLS с `ENABLE` и `FORCE ROW LEVEL SECURITY` (спека §4).
- **Физическое удаление не применяется** — только `deleted_at` (спека §4).
- **Приложение подключается ролью `studcore_app`**, которая не владеет таблицами
  и не имеет `BYPASSRLS`. Владелец таблиц используется только для миграций.
- **Секреты не попадают в репозиторий.** Пароль роли приложения выдаётся
  отдельным шагом (`make db-login` локально, runbook в проде).
- **Каждая задача заканчивается коммитом** с сообщением на русском языке.

## Границы этапа

**Входит:** каркас, вход/выход, сессии, арендаторы, RLS, миграции, справочник
подразделений как вертикальный срез, CI, контейнеризация, деплой.

**Не входит:** регистрация пользователей через интерфейс (первый пользователь
создаётся командой), восстановление пароля, роли сложнее `admin`/`staff`,
оформление интерфейса (Tailwind и shadcn/ui приходят на этапе 2 вместе с
настоящими экранами), журнал доступа (этап 6).

---

## Структура файлов

```
studcore/
├── cmd/
│   ├── api/main.go              точка входа сервиса
│   ├── migrate/main.go          накат миграций (отдельный бинарник)
│   └── createuser/main.go       создание первого пользователя арендатора
├── internal/
│   ├── config/config.go         чтение конфигурации из окружения
│   ├── app/router.go            сборка маршрутов (появляется в задаче 5)
│   ├── httpx/
│   │   ├── json.go              чтение и запись JSON
│   │   └── errors.go            формат ошибки для пользователя
│   ├── db/
│   │   ├── pool.go              пул соединений, транзакции
│   │   └── tenant.go            транзакция в контексте арендатора
│   ├── migrate/
│   │   ├── migrate.go           goose поверх встроенной FS
│   │   └── sql/0001_init.sql    схема, роль приложения, политики RLS
│   ├── identity/
│   │   ├── password.go          argon2id
│   │   ├── store.go             чтение пользователей, запись сессий
│   │   ├── service.go           вход, выход, проверка сессии
│   │   ├── principal.go         текущий пользователь в контексте запроса
│   │   └── handler.go           /auth/login, /auth/logout, /me
│   ├── departments/
│   │   ├── store.go             запросы к departments
│   │   ├── service.go           правила справочника
│   │   └── handler.go           /departments
│   └── testsupport/
│       └── postgres.go          контейнер с PostgreSQL для тестов
├── web/                         SPA на Vite
├── deploy/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── Caddyfile
├── docs/runbook.md
├── .github/workflows/ci.yml
└── Makefile
```

Разделение store / service / handler выдержано во всех модулях: `store` знает SQL,
`service` знает правила, `handler` знает HTTP. Модуль обращается к чужим данным
только через экспортированные функции соседа (спека §3).

---

## Задача 1: Каркас репозитория и проверка живости

**Файлы:**
- Создать: `go.mod`, `Makefile`, `.gitignore`
- Создать: `cmd/api/main.go`
- Создать: `internal/config/config.go`
- Создать: `internal/httpx/json.go`, `internal/httpx/errors.go`, `internal/httpx/router.go`
- Тест: `internal/httpx/router_test.go`

**Интерфейсы:**
- Потребляет: ничего.
- Производит: `config.Load() (config.Config, error)`;
  `httpx.JSON(w http.ResponseWriter, status int, v any)`;
  `httpx.Fail(w http.ResponseWriter, status int, code, message string)`;
  `httpx.FailField(w http.ResponseWriter, status int, code, message, field string)`;
  `httpx.Decode(r *http.Request, dst any) error`;
  `httpx.NewRouter() http.Handler`.

- [ ] **Шаг 1: Установить среду контейнеров**

```bash
brew install orbstack
open -a OrbStack
docker info --format '{{.ServerVersion}}'
```

Ожидается: печатается версия сервера. Без этого не пройдут интеграционные тесты
начиная с задачи 2.

- [ ] **Шаг 2: Завести модуль и зависимости**

```bash
cd ~/projects/studcore
go mod init github.com/serz/studcore
go get github.com/jackc/pgx/v5@latest
go get github.com/google/uuid@latest
go get golang.org/x/crypto@latest
go get github.com/pressly/goose/v3@latest
go get github.com/testcontainers/testcontainers-go@latest
go get github.com/testcontainers/testcontainers-go/modules/postgres@latest
```

- [ ] **Шаг 3: Создать `.gitignore`**

```gitignore
/bin/
/web/node_modules/
/web/dist/
.env
*.log
.DS_Store
```

- [ ] **Шаг 4: Написать падающий тест**

Файл `internal/httpx/router_test.go`:

```go
package httpx_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/serz/studcore/internal/httpx"
)

func TestHealthzReturnsOK(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	httpx.NewRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("код ответа = %d, ожидался %d", rec.Code, http.StatusOK)
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("разбор тела ответа: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status = %q, ожидался \"ok\"", body.Status)
	}
}

func TestUnknownRouteReturnsJSONError(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/no-such-route", nil)
	rec := httptest.NewRecorder()

	httpx.NewRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("код ответа = %d, ожидался %d", rec.Code, http.StatusNotFound)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, ожидался JSON", ct)
	}
}
```

- [ ] **Шаг 5: Запустить тест и убедиться, что он падает**

Запустить: `go test ./internal/httpx/ -run TestHealthz -v`
Ожидается: FAIL — пакет `httpx` не существует.

- [ ] **Шаг 6: Реализовать формат ошибки**

Файл `internal/httpx/errors.go`:

```go
package httpx

import "net/http"

// ErrorBody — единственный формат ошибки, который видит клиент.
// Message пишется на русском языке и объясняет, что делать (спека §6).
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func Fail(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, ErrorBody{Code: code, Message: message})
}

// FailField дополнительно указывает поле формы, к которому относится ошибка,
// чтобы интерфейс мог подсветить его и поставить курсор.
func FailField(w http.ResponseWriter, status int, code, message, field string) {
	JSON(w, status, ErrorBody{Code: code, Message: message, Field: field})
}
```

- [ ] **Шаг 7: Реализовать работу с JSON**

Файл `internal/httpx/json.go`:

```go
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

const maxBodyBytes = 1 << 20 // 1 МБ

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	_ = json.NewEncoder(w).Encode(v)
}

// ErrBadJSON возвращается, когда тело запроса не разобралось.
var ErrBadJSON = errors.New("некорректное тело запроса")

func Decode(r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return ErrBadJSON
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return ErrBadJSON
	}
	return nil
}
```

- [ ] **Шаг 8: Реализовать маршрутизатор**

Файл `internal/httpx/router.go`:

```go
package httpx

import "net/http"

func NewRouter() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Неизвестный маршрут отвечает в том же формате, что и остальные ошибки,
	// иначе фронтенд получит HTML там, где ждёт JSON.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		Fail(w, http.StatusNotFound, "not_found", "Запрошенный адрес не существует")
	})

	return mux
}
```

- [ ] **Шаг 9: Запустить тесты и убедиться, что они проходят**

Запустить: `go test ./internal/httpx/ -v`
Ожидается: PASS обоих тестов.

- [ ] **Шаг 10: Реализовать конфигурацию**

Файл `internal/config/config.go`:

```go
package config

import (
	"errors"
	"os"
	"time"
)

type Config struct {
	Addr         string
	DatabaseURL  string
	SessionTTL   time.Duration
	CookieSecure bool
}

func Load() (Config, error) {
	c := Config{
		Addr:         env("SC_ADDR", ":8080"),
		DatabaseURL:  os.Getenv("SC_DATABASE_URL"),
		SessionTTL:   12 * time.Hour,
		CookieSecure: os.Getenv("SC_COOKIE_SECURE") == "1",
	}
	if c.DatabaseURL == "" {
		return Config{}, errors.New("переменная окружения SC_DATABASE_URL не задана")
	}
	return c, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Шаг 11: Реализовать точку входа**

Файл `cmd/api/main.go`:

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/serz/studcore/internal/config"
	"github.com/serz/studcore/internal/httpx"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		log.Error("конфигурация", "err", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpx.NewRouter(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Info("сервис запущен", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("сервер остановлен с ошибкой", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("остановка сервера", "err", err)
	}
	log.Info("сервис остановлен")
}
```

- [ ] **Шаг 12: Создать Makefile**

```makefile
.PHONY: test lint run build migrate

DB ?= postgres://studcore_app:app@localhost:5432/studcore?sslmode=disable

test:
	go test ./... -count=1

lint:
	go vet ./...

build:
	go build -o bin/api ./cmd/api
	go build -o bin/migrate ./cmd/migrate

run:
	SC_DATABASE_URL="$(DB)" go run ./cmd/api
```

Цели `migrate`, `db-login` и `createuser` добавляются в задачах 2 и 5.

- [ ] **Шаг 13: Проверить сборку целиком**

Запустить: `go build ./... && go test ./... -count=1`
Ожидается: сборка без ошибок, тесты проходят.

- [ ] **Шаг 14: Коммит**

```bash
git add go.mod go.sum .gitignore Makefile cmd internal
git commit -m "Завести каркас сервиса с проверкой живости"
```

---

## Задача 2: Миграции, схема и политики RLS

**Файлы:**
- Создать: `internal/migrate/migrate.go`
- Создать: `internal/migrate/sql/0001_init.sql`
- Создать: `cmd/migrate/main.go`
- Создать: `internal/testsupport/postgres.go`
- Тест: `internal/migrate/migrate_test.go`
- Изменить: `Makefile`

**Интерфейсы:**
- Потребляет: ничего из задачи 1.
- Производит: `migrate.Up(ctx context.Context, dsn string) error`;
  `migrate.Down(ctx context.Context, dsn string) error`;
  `testsupport.Postgres(t *testing.T) string` — поднимает контейнер,
  накатывает миграции, выдаёт DSN под ролью `studcore_app`;
  `testsupport.AdminDSN(t *testing.T) string` — DSN владельца схемы.

- [ ] **Шаг 1: Написать падающий тест**

Файл `internal/migrate/migrate_test.go`:

```go
package migrate_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/serz/studcore/internal/testsupport"
)

// Все доменные таблицы обязаны быть под RLS. Список исключений закрыт:
// tenants читается до установления арендатора, users и sessions обслуживают
// вход, goose_db_version — служебная таблица миграций.
var withoutRLS = map[string]bool{
	"tenants":           true,
	"users":             true,
	"sessions":          true,
	"goose_db_version":  true,
}

func TestEveryDomainTableHasRLS(t *testing.T) {
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testsupport.AdminDSN(t))
	if err != nil {
		t.Fatalf("подключение: %v", err)
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
		SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind = 'r'
	`)
	if err != nil {
		t.Fatalf("запрос таблиц: %v", err)
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		var enabled, forced bool
		if err := rows.Scan(&name, &enabled, &forced); err != nil {
			t.Fatalf("чтение строки: %v", err)
		}
		if withoutRLS[name] {
			continue
		}
		if !enabled || !forced {
			t.Errorf("таблица %s: RLS enabled=%v forced=%v, ожидалось true/true", name, enabled, forced)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("обход строк: %v", err)
	}
}

func TestMigrationsAreReversible(t *testing.T) {
	ctx := context.Background()
	dsn := testsupport.AdminDSN(t)

	if err := migrateDown(ctx, dsn); err != nil {
		t.Fatalf("откат миграций: %v", err)
	}

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("подключение: %v", err)
	}
	defer conn.Close(ctx)

	var exists bool
	err = conn.QueryRow(ctx, `SELECT to_regclass('public.departments') IS NOT NULL`).Scan(&exists)
	if err != nil {
		t.Fatalf("проверка таблицы: %v", err)
	}
	if exists {
		t.Fatal("после отката таблица departments всё ещё существует")
	}
}
```

Вспомогательная функция `migrateDown` появится в шаге 4 этой задачи; тест
временно не компилируется — это ожидаемо.

- [ ] **Шаг 2: Запустить тест и убедиться, что он падает**

Запустить: `go test ./internal/migrate/ -v`
Ожидается: FAIL — пакеты `migrate` и `testsupport` не существуют.

- [ ] **Шаг 3: Написать миграцию**

Файл `internal/migrate/sql/0001_init.sql`:

```sql
-- +goose Up

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Роль приложения. Создаётся без права входа: пароль выдаётся отдельным шагом
-- (make db-login локально, runbook в проде), чтобы секрет не жил в репозитории.
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studcore_app') THEN
        CREATE ROLE studcore_app NOLOGIN;
    END IF;
END
$$;
-- +goose StatementEnd

CREATE TABLE tenants (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       text NOT NULL UNIQUE,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants (id),
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    full_name     text NOT NULL,
    role          text NOT NULL DEFAULT 'staff',
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_tenant_idx ON users (tenant_id);

CREATE TABLE sessions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Справочник подразделений: вертикальный срез этапа 1 и одновременно
-- настоящая сущность продукта — код подразделения входит в маску номера
-- выдаваемого документа (спека §4).
CREATE TABLE departments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    code       text NOT NULL,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (tenant_id, code)
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;

-- nullif нужен, чтобы незаданный или пустой app.tenant_id давал NULL,
-- а не ошибку приведения типа. NULL не совпадает ни с одной строкой —
-- поведение по умолчанию «не видно ничего».
CREATE POLICY tenant_isolation ON departments
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA public TO studcore_app;
GRANT SELECT, INSERT, UPDATE ON tenants, users, sessions, departments TO studcore_app;
GRANT DELETE ON sessions TO studcore_app;

-- +goose Down

DROP TABLE departments;
DROP TABLE sessions;
DROP TABLE users;
DROP TABLE tenants;
```

- [ ] **Шаг 4: Реализовать накат миграций**

Файл `internal/migrate/migrate.go`:

```go
package migrate

import (
	"context"
	"database/sql"
	"embed"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed sql/*.sql
var files embed.FS

func open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("открытие подключения: %w", err)
	}
	goose.SetBaseFS(files)
	if err := goose.SetDialect("postgres"); err != nil {
		db.Close()
		return nil, fmt.Errorf("диалект goose: %w", err)
	}
	return db, nil
}

// Up накатывает все миграции. Выполняется владельцем схемы, не ролью приложения.
func Up(ctx context.Context, dsn string) error {
	db, err := open(dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := goose.UpContext(ctx, db, "sql"); err != nil {
		return fmt.Errorf("накат миграций: %w", err)
	}
	return nil
}

// Down откатывает одну миграцию назад. Используется в тестах и при разборе аварий.
func Down(ctx context.Context, dsn string) error {
	db, err := open(dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := goose.DownContext(ctx, db, "sql"); err != nil {
		return fmt.Errorf("откат миграции: %w", err)
	}
	return nil
}
```

- [ ] **Шаг 5: Дописать вспомогательную функцию в тест**

Добавить в конец `internal/migrate/migrate_test.go`:

```go
func migrateDown(ctx context.Context, dsn string) error {
	return migrate.Down(ctx, dsn)
}
```

и импорт `"github.com/serz/studcore/internal/migrate"`.

- [ ] **Шаг 6: Реализовать помощник для тестов**

Файл `internal/testsupport/postgres.go`:

```go
package testsupport

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/serz/studcore/internal/migrate"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

const appPassword = "app"

var (
	once     sync.Once
	adminDSN string
	appDSN   string
	setupErr error
)

// Контейнер поднимается один раз на весь тестовый бинарник: старт PostgreSQL
// занимает секунды, поднимать его на каждый тест недопустимо долго.
func start(t *testing.T) {
	t.Helper()
	once.Do(func() {
		ctx := context.Background()

		container, err := tcpostgres.Run(ctx, "postgres:16-alpine",
			tcpostgres.WithDatabase("studcore"),
			tcpostgres.WithUsername("owner"),
			tcpostgres.WithPassword("owner"),
			testcontainers.WithWaitStrategy(
				wait.ForListeningPort("5432/tcp").WithStartupTimeout(60*time.Second)),
		)
		if err != nil {
			setupErr = err
			return
		}
		testcontainers.CleanupContainer(t, container)

		adminDSN, err = container.ConnectionString(ctx, "sslmode=disable")
		if err != nil {
			setupErr = err
			return
		}

		if err := migrate.Up(ctx, adminDSN); err != nil {
			setupErr = err
			return
		}

		// Роль создана миграцией без права входа — выдаём пароль здесь,
		// ровно как это делается в проде отдельным шагом runbook.
		conn, err := pgx.Connect(ctx, adminDSN)
		if err != nil {
			setupErr = err
			return
		}
		defer conn.Close(ctx)
		if _, err := conn.Exec(ctx, `ALTER ROLE studcore_app LOGIN PASSWORD '`+appPassword+`'`); err != nil {
			setupErr = err
			return
		}

		host, err := container.Host(ctx)
		if err != nil {
			setupErr = err
			return
		}
		port, err := container.MappedPort(ctx, "5432/tcp")
		if err != nil {
			setupErr = err
			return
		}
		appDSN = "postgres://studcore_app:" + appPassword + "@" + host + ":" + port.Port() +
			"/studcore?sslmode=disable"
	})
	if setupErr != nil {
		t.Fatalf("подготовка PostgreSQL: %v", setupErr)
	}
}

// Postgres выдаёт DSN под ролью приложения — с включённым RLS.
func Postgres(t *testing.T) string {
	t.Helper()
	start(t)
	return appDSN
}

// AdminDSN выдаёт DSN владельца схемы — для проверок структуры и подготовки данных.
func AdminDSN(t *testing.T) string {
	t.Helper()
	start(t)
	return adminDSN
}
```

- [ ] **Шаг 7: Реализовать бинарник миграций**

Файл `cmd/migrate/main.go`:

```go
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/serz/studcore/internal/migrate"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	dsn := os.Getenv("SC_MIGRATE_DATABASE_URL")
	if dsn == "" {
		log.Error("переменная окружения SC_MIGRATE_DATABASE_URL не задана")
		os.Exit(1)
	}

	if err := migrate.Up(context.Background(), dsn); err != nil {
		log.Error("миграции не накатились", "err", err)
		os.Exit(1)
	}
	log.Info("миграции накачены")
}
```

- [ ] **Шаг 8: Запустить тесты и убедиться, что они проходят**

Запустить: `go test ./internal/migrate/ -v`
Ожидается: PASS обоих тестов. Первый запуск дольше — скачивается образ
`postgres:16-alpine`.

- [ ] **Шаг 9: Дополнить Makefile**

Добавить в `Makefile`:

```makefile
MIGRATE_DB ?= postgres://$(USER)@localhost:5432/studcore?sslmode=disable

.PHONY: db-create migrate db-login

db-create:
	createdb studcore || true

migrate:
	SC_MIGRATE_DATABASE_URL="$(MIGRATE_DB)" go run ./cmd/migrate

db-login:
	psql "$(MIGRATE_DB)" -c "ALTER ROLE studcore_app LOGIN PASSWORD 'app'"
```

- [ ] **Шаг 10: Проверить на локальной базе**

Запустить: `make db-create migrate db-login`
Ожидается: `миграции накачены`, затем `ALTER ROLE`.
Проверить: `psql studcore -c '\d departments'` показывает таблицу.

- [ ] **Шаг 11: Коммит**

```bash
git add internal/migrate internal/testsupport cmd/migrate Makefile
git commit -m "Добавить схему БД, роль приложения и политики изоляции арендаторов"
```

---

## Задача 3: Пул соединений и транзакция в контексте арендатора

**Файлы:**
- Создать: `internal/db/pool.go`
- Создать: `internal/db/tenant.go`
- Тест: `internal/db/tenant_test.go`

**Интерфейсы:**
- Потребляет: `testsupport.Postgres(t)`, `testsupport.AdminDSN(t)` из задачи 2.
- Производит: `db.Open(ctx context.Context, dsn string) (*db.Pool, error)`;
  `(*db.Pool).Close()`;
  `(*db.Pool).Tx(ctx context.Context, fn func(pgx.Tx) error) error` — транзакция
  без арендатора, для входа и служебных операций;
  `(*db.Pool).WithTenant(ctx context.Context, tenantID uuid.UUID, fn func(pgx.Tx) error) error`
  — транзакция, в которой RLS отдаёт только строки арендатора.

- [ ] **Шаг 1: Написать падающий тест**

Файл `internal/db/tenant_test.go`:

```go
package db_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/serz/studcore/internal/db"
	"github.com/serz/studcore/internal/testsupport"
)

func openPool(t *testing.T) *db.Pool {
	t.Helper()
	pool, err := db.Open(context.Background(), testsupport.Postgres(t))
	if err != nil {
		t.Fatalf("открытие пула: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func createTenant(t *testing.T, pool *db.Pool, slug string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.Tx(context.Background(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(),
			`INSERT INTO tenants (slug, name) VALUES ($1, $1) RETURNING id`, slug).Scan(&id)
	})
	if err != nil {
		t.Fatalf("создание арендатора %s: %v", slug, err)
	}
	return id
}

func insertDepartment(t *testing.T, pool *db.Pool, tenant uuid.UUID, code string) {
	t.Helper()
	err := pool.WithTenant(context.Background(), tenant, func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(),
			`INSERT INTO departments (tenant_id, code, name) VALUES ($1, $2, $2)`, tenant, code)
		return err
	})
	if err != nil {
		t.Fatalf("вставка подразделения %s: %v", code, err)
	}
}

func countDepartments(t *testing.T, pool *db.Pool, tenant uuid.UUID) int {
	t.Helper()
	var n int
	err := pool.WithTenant(context.Background(), tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT count(*) FROM departments`).Scan(&n)
	})
	if err != nil {
		t.Fatalf("подсчёт подразделений: %v", err)
	}
	return n
}

func TestTenantSeesOnlyOwnRows(t *testing.T) {
	pool := openPool(t)
	a := createTenant(t, pool, "vuz-a")
	b := createTenant(t, pool, "vuz-b")

	insertDepartment(t, pool, a, "A-1")
	insertDepartment(t, pool, a, "A-2")
	insertDepartment(t, pool, b, "B-1")

	if got := countDepartments(t, pool, a); got != 2 {
		t.Errorf("арендатор A видит %d строк, ожидалось 2", got)
	}
	if got := countDepartments(t, pool, b); got != 1 {
		t.Errorf("арендатор B видит %d строк, ожидалось 1", got)
	}
}

func TestWithoutTenantNothingIsVisible(t *testing.T) {
	pool := openPool(t)
	a := createTenant(t, pool, "vuz-c")
	insertDepartment(t, pool, a, "C-1")

	var n int
	err := pool.Tx(context.Background(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT count(*) FROM departments`).Scan(&n)
	})
	if err != nil {
		t.Fatalf("запрос без арендатора: %v", err)
	}
	if n != 0 {
		t.Errorf("без установленного арендатора видно %d строк, ожидалось 0", n)
	}
}

func TestCannotInsertRowOfAnotherTenant(t *testing.T) {
	pool := openPool(t)
	a := createTenant(t, pool, "vuz-d")
	b := createTenant(t, pool, "vuz-e")

	err := pool.WithTenant(context.Background(), a, func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(),
			`INSERT INTO departments (tenant_id, code, name) VALUES ($1, $2, $2)`, b, "X-1")
		return err
	})
	if err == nil {
		t.Fatal("вставка строки чужого арендатора прошла, ожидалась ошибка политики")
	}
}

func TestTenantSettingDoesNotLeakBetweenTransactions(t *testing.T) {
	pool := openPool(t)
	a := createTenant(t, pool, "vuz-f")
	insertDepartment(t, pool, a, "F-1")

	// Прогоняем достаточно транзакций, чтобы пул переиспользовал соединения.
	for i := 0; i < 20; i++ {
		if got := countDepartments(t, pool, a); got != 1 {
			t.Fatalf("итерация %d: видно %d строк, ожидалась 1", i, got)
		}
		var n int
		err := pool.Tx(context.Background(), func(tx pgx.Tx) error {
			return tx.QueryRow(context.Background(), `SELECT count(*) FROM departments`).Scan(&n)
		})
		if err != nil {
			t.Fatalf("итерация %d: %v", i, err)
		}
		if n != 0 {
			t.Fatalf("итерация %d: арендатор протёк в транзакцию без контекста, видно %d строк", i, n)
		}
	}
}
```

- [ ] **Шаг 2: Запустить тест и убедиться, что он падает**

Запустить: `go test ./internal/db/ -v`
Ожидается: FAIL — пакет `db` не существует.

- [ ] **Шаг 3: Реализовать пул**

Файл `internal/db/pool.go`:

```go
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Pool struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, dsn string) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("разбор строки подключения: %w", err)
	}
	cfg.MaxConns = 10

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("создание пула: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("проверка подключения к базе: %w", err)
	}
	return &Pool{pool: pool}, nil
}

func (p *Pool) Close() { p.pool.Close() }

// Tx выполняет fn в транзакции без контекста арендатора. Применяется только там,
// где арендатор ещё не известен: вход в систему и служебные операции.
func (p *Pool) Tx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("начало транзакции: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("фиксация транзакции: %w", err)
	}
	return nil
}
```

- [ ] **Шаг 4: Реализовать транзакцию арендатора**

Файл `internal/db/tenant.go`:

```go
package db

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// WithTenant выполняет fn в транзакции, где установлен app.tenant_id.
// Политики RLS в этом состоянии отдают и принимают только строки арендатора.
//
// set_config с третьим аргументом true действует до конца транзакции, поэтому
// значение не переживает возврат соединения в пул — это проверяется тестом
// TestTenantSettingDoesNotLeakBetweenTransactions.
func (p *Pool) WithTenant(ctx context.Context, tenantID uuid.UUID, fn func(pgx.Tx) error) error {
	if tenantID == uuid.Nil {
		return fmt.Errorf("арендатор не задан")
	}
	return p.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`SELECT set_config('app.tenant_id', $1, true)`, tenantID.String()); err != nil {
			return fmt.Errorf("установка контекста арендатора: %w", err)
		}
		return fn(tx)
	})
}
```

- [ ] **Шаг 5: Запустить тесты и убедиться, что они проходят**

Запустить: `go test ./internal/db/ -v`
Ожидается: PASS всех пяти тестов. Если падает
`TestCannotInsertRowOfAnotherTenant` — проверить, что в миграции у политики есть
`WITH CHECK`, а не только `USING`.

- [ ] **Шаг 6: Коммит**

```bash
git add internal/db
git commit -m "Добавить пул соединений и транзакцию в контексте арендатора"
```

---

## Задача 4: Хеширование паролей

**Файлы:**
- Создать: `internal/identity/password.go`
- Тест: `internal/identity/password_test.go`

**Интерфейсы:**
- Потребляет: ничего.
- Производит: `identity.HashPassword(plain string) (string, error)` — строка
  формата PHC `$argon2id$v=19$m=65536,t=3,p=2$<соль>$<хеш>`;
  `identity.VerifyPassword(encoded, plain string) (bool, error)`.

- [ ] **Шаг 1: Написать падающий тест**

Файл `internal/identity/password_test.go`:

```go
package identity_test

import (
	"strings"
	"testing"

	"github.com/serz/studcore/internal/identity"
)

func TestHashAndVerify(t *testing.T) {
	hash, err := identity.HashPassword("правильный-пароль")
	if err != nil {
		t.Fatalf("хеширование: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$") {
		t.Fatalf("неожиданный формат хеша: %q", hash)
	}

	ok, err := identity.VerifyPassword(hash, "правильный-пароль")
	if err != nil {
		t.Fatalf("проверка: %v", err)
	}
	if !ok {
		t.Error("верный пароль не принят")
	}

	ok, err = identity.VerifyPassword(hash, "неправильный-пароль")
	if err != nil {
		t.Fatalf("проверка: %v", err)
	}
	if ok {
		t.Error("неверный пароль принят")
	}
}

func TestHashIsSaltedPerCall(t *testing.T) {
	first, err := identity.HashPassword("один-и-тот-же")
	if err != nil {
		t.Fatalf("хеширование: %v", err)
	}
	second, err := identity.HashPassword("один-и-тот-же")
	if err != nil {
		t.Fatalf("хеширование: %v", err)
	}
	if first == second {
		t.Error("два хеша одного пароля совпали — соль не случайна")
	}
}

func TestVerifyRejectsMalformedHash(t *testing.T) {
	for _, bad := range []string{
		"",
		"не-хеш",
		"$argon2i$v=19$m=65536,t=3,p=2$c29sdA$aGFzaA",
		"$argon2id$v=19$m=65536,t=3$c29sdA$aGFzaA",
	} {
		if _, err := identity.VerifyPassword(bad, "любой"); err == nil {
			t.Errorf("хеш %q принят, ожидалась ошибка формата", bad)
		}
	}
}
```

- [ ] **Шаг 2: Запустить тест и убедиться, что он падает**

Запустить: `go test ./internal/identity/ -v`
Ожидается: FAIL — пакет `identity` не существует.

- [ ] **Шаг 3: Реализовать хеширование**

Файл `internal/identity/password.go`:

```go
package identity

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Параметры подобраны так, чтобы проверка занимала десятки миллисекунд:
// вход в систему происходит редко, а перебор украденной базы должен быть дорогим.
const (
	argonTime    = 3
	argonMemory  = 64 * 1024 // КиБ
	argonThreads = 2
	argonKeyLen  = 32
	argonSaltLen = 16
)

var errBadHashFormat = errors.New("неизвестный формат хеша пароля")

func HashPassword(plain string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("генерация соли: %w", err)
	}
	key := argon2.IDKey([]byte(plain), salt, argonTime, argonMemory, argonThreads, argonKeyLen)

	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func VerifyPassword(encoded, plain string) (bool, error) {
	parts := strings.Split(encoded, "$")
	// Строка начинается с '$', поэтому первый элемент пустой.
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errBadHashFormat
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, errBadHashFormat
	}

	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false, errBadHashFormat
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, errBadHashFormat
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false, errBadHashFormat
	}

	got := argon2.IDKey([]byte(plain), salt, time, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
```

- [ ] **Шаг 4: Запустить тесты и убедиться, что они проходят**

Запустить: `go test ./internal/identity/ -v`
Ожидается: PASS всех трёх тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add internal/identity
git commit -m "Добавить хеширование паролей по argon2id"
```

---

## Задача 5: Вход, сессии и защита маршрутов

**Файлы:**
- Создать: `internal/identity/principal.go`
- Создать: `internal/identity/store.go`
- Создать: `internal/identity/service.go`
- Создать: `internal/identity/handler.go`
- Создать: `internal/app/router.go`
- Создать: `cmd/createuser/main.go`
- Удалить: `internal/httpx/router.go`
- Переместить: `internal/httpx/router_test.go` → `internal/app/router_test.go`
- Тест: `internal/identity/service_test.go`
- Изменить: `cmd/api/main.go`, `Makefile`

**Интерфейсы:**
- Потребляет: `db.Open`, `(*db.Pool).Tx`, `(*db.Pool).WithTenant` (задача 3);
  `identity.HashPassword`, `identity.VerifyPassword` (задача 4);
  `httpx.JSON`, `httpx.Fail`, `httpx.FailField`, `httpx.Decode` (задача 1);
  `config.Load` (задача 1).
- Производит:
  `identity.Principal{UserID, TenantID uuid.UUID; Email, FullName, Role string}`;
  `identity.FromContext(ctx context.Context) (Principal, bool)`;
  `identity.NewStore(pool *db.Pool) *Store`;
  `identity.NewService(store *Store, ttl time.Duration) *Service`;
  `(*Service).Login(ctx, email, password string) (string, Principal, error)`;
  `(*Service).Authenticate(ctx, token string) (Principal, error)`;
  `(*Service).Logout(ctx, token string) error`;
  `(*Service).CreateUser(ctx context.Context, tenantID uuid.UUID, email, password, fullName, role string) (uuid.UUID, error)`;
  `identity.NewHandler(svc *Service, secureCookie bool, ttl time.Duration) *Handler`;
  `(*Handler).Register(mux *http.ServeMux)`;
  `(*Handler).RequireAuth(next http.Handler) http.Handler`;
  `app.Deps{Identity *identity.Handler}` и `app.NewRouter(d Deps) http.Handler`.

**Замечание по структуре:** маршрутизатор переезжает из `internal/httpx` в новый
пакет `internal/app`. Причина: `identity` импортирует `httpx` ради JSON-ответов,
поэтому `httpx` не может импортировать `identity` — получился бы цикл. `httpx`
остаётся листовым пакетом без зависимостей на модули, `app` собирает всё вместе.

- [ ] **Шаг 1: Написать падающий тест**

Файл `internal/identity/service_test.go`:

```go
package identity_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/serz/studcore/internal/db"
	"github.com/serz/studcore/internal/identity"
	"github.com/serz/studcore/internal/testsupport"
)

func newService(t *testing.T) (*identity.Service, *db.Pool) {
	t.Helper()
	pool, err := db.Open(context.Background(), testsupport.Postgres(t))
	if err != nil {
		t.Fatalf("открытие пула: %v", err)
	}
	t.Cleanup(pool.Close)
	return identity.NewService(identity.NewStore(pool), time.Hour), pool
}

func newTenant(t *testing.T, pool *db.Pool, slug string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.Tx(context.Background(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(),
			`INSERT INTO tenants (slug, name) VALUES ($1, $1) RETURNING id`, slug).Scan(&id)
	})
	if err != nil {
		t.Fatalf("создание арендатора: %v", err)
	}
	return id
}

func TestLoginIssuesSessionAndAuthenticates(t *testing.T) {
	ctx := context.Background()
	svc, pool := newService(t)
	tenant := newTenant(t, pool, "login-a")

	if _, err := svc.CreateUser(ctx, tenant, "anna@vuz.ru", "секрет-пароль", "Анна Петрова", "admin"); err != nil {
		t.Fatalf("создание пользователя: %v", err)
	}

	token, principal, err := svc.Login(ctx, "anna@vuz.ru", "секрет-пароль")
	if err != nil {
		t.Fatalf("вход: %v", err)
	}
	if token == "" {
		t.Fatal("вход не выдал токен сессии")
	}
	if principal.TenantID != tenant {
		t.Errorf("арендатор в сессии = %s, ожидался %s", principal.TenantID, tenant)
	}
	if principal.FullName != "Анна Петрова" {
		t.Errorf("имя = %q, ожидалось \"Анна Петрова\"", principal.FullName)
	}

	got, err := svc.Authenticate(ctx, token)
	if err != nil {
		t.Fatalf("проверка сессии: %v", err)
	}
	if got.UserID != principal.UserID {
		t.Errorf("сессия вернула пользователя %s, ожидался %s", got.UserID, principal.UserID)
	}
}

func TestLoginRejectsWrongPassword(t *testing.T) {
	ctx := context.Background()
	svc, pool := newService(t)
	tenant := newTenant(t, pool, "login-b")

	if _, err := svc.CreateUser(ctx, tenant, "boris@vuz.ru", "секрет-пароль", "Борис Иванов", "staff"); err != nil {
		t.Fatalf("создание пользователя: %v", err)
	}

	if _, _, err := svc.Login(ctx, "boris@vuz.ru", "другой-пароль"); !errors.Is(err, identity.ErrInvalidCredentials) {
		t.Fatalf("ошибка = %v, ожидалась ErrInvalidCredentials", err)
	}
}

func TestLoginRejectsUnknownEmail(t *testing.T) {
	ctx := context.Background()
	svc, _ := newService(t)

	if _, _, err := svc.Login(ctx, "нет-такого@vuz.ru", "любой"); !errors.Is(err, identity.ErrInvalidCredentials) {
		t.Fatalf("ошибка = %v, ожидалась ErrInvalidCredentials", err)
	}
}

func TestLogoutInvalidatesSession(t *testing.T) {
	ctx := context.Background()
	svc, pool := newService(t)
	tenant := newTenant(t, pool, "login-c")

	if _, err := svc.CreateUser(ctx, tenant, "vera@vuz.ru", "секрет-пароль", "Вера Сидорова", "staff"); err != nil {
		t.Fatalf("создание пользователя: %v", err)
	}
	token, _, err := svc.Login(ctx, "vera@vuz.ru", "секрет-пароль")
	if err != nil {
		t.Fatalf("вход: %v", err)
	}

	if err := svc.Logout(ctx, token); err != nil {
		t.Fatalf("выход: %v", err)
	}
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, identity.ErrNoSession) {
		t.Fatalf("ошибка = %v, ожидалась ErrNoSession", err)
	}
}

func TestExpiredSessionIsRejected(t *testing.T) {
	ctx := context.Background()
	pool, err := db.Open(ctx, testsupport.Postgres(t))
	if err != nil {
		t.Fatalf("открытие пула: %v", err)
	}
	t.Cleanup(pool.Close)

	// Отрицательный срок жизни: сессия выдаётся уже просроченной.
	svc := identity.NewService(identity.NewStore(pool), -time.Minute)
	tenant := newTenant(t, pool, "login-d")

	if _, err := svc.CreateUser(ctx, tenant, "grigory@vuz.ru", "секрет-пароль", "Григорий Ким", "staff"); err != nil {
		t.Fatalf("создание пользователя: %v", err)
	}
	token, _, err := svc.Login(ctx, "grigory@vuz.ru", "секрет-пароль")
	if err != nil {
		t.Fatalf("вход: %v", err)
	}

	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, identity.ErrNoSession) {
		t.Fatalf("ошибка = %v, ожидалась ErrNoSession", err)
	}
}
```

- [ ] **Шаг 2: Запустить тест и убедиться, что он падает**

Запустить: `go test ./internal/identity/ -run TestLogin -v`
Ожидается: FAIL — `identity.NewService` не определён.

- [ ] **Шаг 3: Реализовать носителя сессии в контексте**

Файл `internal/identity/principal.go`:

```go
package identity

import (
	"context"

	"github.com/google/uuid"
)

// Principal — кто выполняет текущий запрос. Кладётся в контекст middleware
// RequireAuth и читается обработчиками доменных модулей.
type Principal struct {
	UserID   uuid.UUID `json:"user_id"`
	TenantID uuid.UUID `json:"tenant_id"`
	Email    string    `json:"email"`
	FullName string    `json:"full_name"`
	Role     string    `json:"role"`
}

type principalKey struct{}

func withPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}
```

- [ ] **Шаг 4: Реализовать хранилище**

Файл `internal/identity/store.go`:

```go
package identity

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/serz/studcore/internal/db"
)

var ErrNotFound = errors.New("запись не найдена")

type Store struct {
	pool *db.Pool
}

func NewStore(pool *db.Pool) *Store { return &Store{pool: pool} }

type user struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	Email        string
	PasswordHash string
	FullName     string
	Role         string
}

// userByEmail ищет пользователя до того, как арендатор известен, поэтому
// выполняется вне контекста арендатора. Таблица users намеренно оставлена
// без RLS — см. комментарий к списку исключений в тесте миграций.
func (s *Store) userByEmail(ctx context.Context, email string) (user, error) {
	var u user
	err := s.pool.Tx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, email, password_hash, full_name, role
			FROM users
			WHERE email = $1 AND is_active
		`, email).Scan(&u.ID, &u.TenantID, &u.Email, &u.PasswordHash, &u.FullName, &u.Role)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return user{}, ErrNotFound
	}
	if err != nil {
		return user{}, fmt.Errorf("поиск пользователя: %w", err)
	}
	return u, nil
}

func (s *Store) createUser(ctx context.Context, tenantID uuid.UUID, email, hash, fullName, role string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.Tx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO users (tenant_id, email, password_hash, full_name, role)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id
		`, tenantID, email, hash, fullName, role).Scan(&id)
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("создание пользователя: %w", err)
	}
	return id, nil
}

func (s *Store) createSession(ctx context.Context, userID, tenantID uuid.UUID, tokenHash []byte, expiresAt time.Time) error {
	err := s.pool.Tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO sessions (user_id, tenant_id, token_hash, expires_at)
			VALUES ($1, $2, $3, $4)
		`, userID, tenantID, tokenHash, expiresAt)
		return err
	})
	if err != nil {
		return fmt.Errorf("создание сессии: %w", err)
	}
	return nil
}

func (s *Store) principalByToken(ctx context.Context, tokenHash []byte) (Principal, error) {
	var p Principal
	err := s.pool.Tx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT u.id, u.tenant_id, u.email, u.full_name, u.role
			FROM sessions s
			JOIN users u ON u.id = s.user_id
			WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active
		`, tokenHash).Scan(&p.UserID, &p.TenantID, &p.Email, &p.FullName, &p.Role)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrNotFound
	}
	if err != nil {
		return Principal{}, fmt.Errorf("поиск сессии: %w", err)
	}
	return p, nil
}

func (s *Store) deleteSession(ctx context.Context, tokenHash []byte) error {
	err := s.pool.Tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
		return err
	})
	if err != nil {
		return fmt.Errorf("удаление сессии: %w", err)
	}
	return nil
}
```

- [ ] **Шаг 5: Реализовать сервис**

Файл `internal/identity/service.go`:

```go
package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

var (
	ErrInvalidCredentials = errors.New("неверная почта или пароль")
	ErrNoSession          = errors.New("сессия недействительна")
)

// Хеш заведомо несуществующего пароля. Проверяется, когда пользователь не найден,
// чтобы время ответа не выдавало, заведена ли такая почта в системе.
const dummyHash = "$argon2id$v=19$m=65536,t=3,p=2$AAAAAAAAAAAAAAAAAAAAAA$" +
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

type Service struct {
	store *Store
	ttl   time.Duration
}

func NewService(store *Store, ttl time.Duration) *Service {
	return &Service{store: store, ttl: ttl}
}

func (s *Service) CreateUser(ctx context.Context, tenantID uuid.UUID, email, password, fullName, role string) (uuid.UUID, error) {
	hash, err := HashPassword(password)
	if err != nil {
		return uuid.Nil, err
	}
	return s.store.createUser(ctx, tenantID, email, hash, fullName, role)
}

// Login проверяет пару почта/пароль и выдаёт токен сессии.
// Возвращаемый токен показывается клиенту один раз; в базе лежит только его хеш,
// поэтому кража дампа базы не даёт войти под чужой сессией.
func (s *Service) Login(ctx context.Context, email, password string) (string, Principal, error) {
	u, err := s.store.userByEmail(ctx, email)
	if errors.Is(err, ErrNotFound) {
		_, _ = VerifyPassword(dummyHash, password)
		return "", Principal{}, ErrInvalidCredentials
	}
	if err != nil {
		return "", Principal{}, err
	}

	ok, err := VerifyPassword(u.PasswordHash, password)
	if err != nil {
		return "", Principal{}, fmt.Errorf("проверка пароля: %w", err)
	}
	if !ok {
		return "", Principal{}, ErrInvalidCredentials
	}

	token, hash, err := newToken()
	if err != nil {
		return "", Principal{}, err
	}
	if err := s.store.createSession(ctx, u.ID, u.TenantID, hash, time.Now().Add(s.ttl)); err != nil {
		return "", Principal{}, err
	}

	return token, Principal{
		UserID:   u.ID,
		TenantID: u.TenantID,
		Email:    u.Email,
		FullName: u.FullName,
		Role:     u.Role,
	}, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (Principal, error) {
	p, err := s.store.principalByToken(ctx, hashToken(token))
	if errors.Is(err, ErrNotFound) {
		return Principal{}, ErrNoSession
	}
	if err != nil {
		return Principal{}, err
	}
	return p, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	return s.store.deleteSession(ctx, hashToken(token))
}

func newToken() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("генерация токена сессии: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, hashToken(token), nil
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
```

- [ ] **Шаг 6: Запустить тесты сервиса**

Запустить: `go test ./internal/identity/ -v`
Ожидается: PASS всех тестов задач 4 и 5.

- [ ] **Шаг 7: Реализовать HTTP-обработчик и middleware**

Файл `internal/identity/handler.go`:

```go
package identity

import (
	"errors"
	"net/http"
	"time"

	"github.com/serz/studcore/internal/httpx"
)

const cookieName = "sc_session"

type Handler struct {
	svc          *Service
	secureCookie bool
	ttl          time.Duration
}

func NewHandler(svc *Service, secureCookie bool, ttl time.Duration) *Handler {
	return &Handler{svc: svc, secureCookie: secureCookie, ttl: ttl}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/login", h.login)
	mux.HandleFunc("POST /api/v1/auth/logout", h.logout)
	mux.Handle("GET /api/v1/me", h.RequireAuth(http.HandlerFunc(h.me)))
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Fail(w, http.StatusBadRequest, "bad_request", "Не удалось разобрать запрос")
		return
	}
	if req.Email == "" {
		httpx.FailField(w, http.StatusBadRequest, "email_required", "Укажите рабочую почту", "email")
		return
	}
	if req.Password == "" {
		httpx.FailField(w, http.StatusBadRequest, "password_required", "Введите пароль", "password")
		return
	}

	token, principal, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if errors.Is(err, ErrInvalidCredentials) {
		httpx.Fail(w, http.StatusUnauthorized, "invalid_credentials",
			"Неверная почта или пароль. Проверьте раскладку и регистр")
		return
	}
	if err != nil {
		httpx.Fail(w, http.StatusInternalServerError, "internal",
			"Не удалось выполнить вход. Попробуйте ещё раз через минуту")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		Expires:  time.Now().Add(h.ttl),
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
	httpx.JSON(w, http.StatusOK, principal)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		if err := h.svc.Logout(r.Context(), c.Value); err != nil {
			httpx.Fail(w, http.StatusInternalServerError, "internal", "Не удалось выйти из системы")
			return
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	p, ok := FromContext(r.Context())
	if !ok {
		httpx.Fail(w, http.StatusUnauthorized, "unauthenticated", "Войдите в систему")
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

// RequireAuth пропускает дальше только запросы с действующей сессией
// и кладёт Principal в контекст.
func (h *Handler) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			httpx.Fail(w, http.StatusUnauthorized, "unauthenticated", "Войдите в систему")
			return
		}
		p, err := h.svc.Authenticate(r.Context(), c.Value)
		if errors.Is(err, ErrNoSession) {
			httpx.Fail(w, http.StatusUnauthorized, "session_expired",
				"Сессия истекла. Войдите заново")
			return
		}
		if err != nil {
			httpx.Fail(w, http.StatusInternalServerError, "internal", "Не удалось проверить сессию")
			return
		}
		next.ServeHTTP(w, r.WithContext(withPrincipal(r.Context(), p)))
	})
}
```

- [ ] **Шаг 8: Перенести маршрутизатор в пакет `app`**

Удалить `internal/httpx/router.go`. Создать `internal/app/router.go`:

```go
package app

import (
	"net/http"

	"github.com/serz/studcore/internal/httpx"
	"github.com/serz/studcore/internal/identity"
)

type Deps struct {
	Identity *identity.Handler
}

func NewRouter(d Deps) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	if d.Identity != nil {
		d.Identity.Register(mux)
	}

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		httpx.Fail(w, http.StatusNotFound, "not_found", "Запрошенный адрес не существует")
	})

	return mux
}
```

Переместить `internal/httpx/router_test.go` в `internal/app/router_test.go`,
заменив в нём пакет на `app_test`, импорт на
`"github.com/serz/studcore/internal/app"` и вызовы `httpx.NewRouter()` на
`app.NewRouter(app.Deps{})`.

- [ ] **Шаг 9: Перевести точку входа на новый маршрутизатор**

Заменить в `cmd/api/main.go` блок создания сервера на:

```go
	ctx := context.Background()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("подключение к базе", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	identitySvc := identity.NewService(identity.NewStore(pool), cfg.SessionTTL)

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: app.NewRouter(app.Deps{
			Identity: identity.NewHandler(identitySvc, cfg.CookieSecure, cfg.SessionTTL),
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}
```

и добавить импорты `"github.com/serz/studcore/internal/app"`,
`"github.com/serz/studcore/internal/db"`, `"github.com/serz/studcore/internal/identity"`.

- [ ] **Шаг 10: Реализовать команду создания первого пользователя**

Файл `cmd/createuser/main.go`:

```go
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/serz/studcore/internal/db"
	"github.com/serz/studcore/internal/identity"
)

// Первый пользователь арендатора заводится командой: интерфейса регистрации
// в продукте нет и не планируется — сотрудников создаёт администратор вуза.
func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	tenantSlug := flag.String("tenant", "", "короткое имя арендатора, например spb-univ")
	tenantName := flag.String("tenant-name", "", "полное название арендатора")
	email := flag.String("email", "", "рабочая почта пользователя")
	password := flag.String("password", "", "пароль")
	fullName := flag.String("name", "", "фамилия и имя")
	flag.Parse()

	if *tenantSlug == "" || *email == "" || *password == "" || *fullName == "" {
		log.Error("не заданы обязательные флаги: -tenant, -email, -password, -name")
		os.Exit(1)
	}
	if *tenantName == "" {
		*tenantName = *tenantSlug
	}

	dsn := os.Getenv("SC_DATABASE_URL")
	if dsn == "" {
		log.Error("переменная окружения SC_DATABASE_URL не задана")
		os.Exit(1)
	}

	ctx := context.Background()
	pool, err := db.Open(ctx, dsn)
	if err != nil {
		log.Error("подключение к базе", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	var tenantID uuid.UUID
	err = pool.Tx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO tenants (slug, name) VALUES ($1, $2)
			ON CONFLICT (slug) DO UPDATE SET name = excluded.name
			RETURNING id
		`, *tenantSlug, *tenantName).Scan(&tenantID)
	})
	if err != nil {
		log.Error("создание арендатора", "err", err)
		os.Exit(1)
	}

	svc := identity.NewService(identity.NewStore(pool), 0)
	userID, err := svc.CreateUser(ctx, tenantID, *email, *password, *fullName, "admin")
	if err != nil {
		log.Error("создание пользователя", "err", err)
		os.Exit(1)
	}

	log.Info("пользователь создан", "tenant", tenantID, "user", userID, "email", *email)
}
```

- [ ] **Шаг 11: Дополнить Makefile**

```makefile
.PHONY: createuser

createuser:
	SC_DATABASE_URL="$(DB)" go run ./cmd/createuser \
		-tenant demo -tenant-name "Демо-вуз" \
		-email admin@demo.ru -password demo-пароль -name "Администратор Демо"
```

- [ ] **Шаг 12: Проверить руками**

```bash
make migrate db-login
make createuser
make run
```

В другом терминале:

```bash
curl -s -X POST localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.ru","password":"demo-пароль"}' \
  -c /tmp/sc-cookies.txt
curl -s localhost:8080/api/v1/me -b /tmp/sc-cookies.txt
```

Ожидается: первый запрос возвращает JSON с `full_name`, второй — тот же объект.
Запрос `/api/v1/me` без файла cookie должен вернуть 401 и текст
«Войдите в систему».

- [ ] **Шаг 13: Прогнать все тесты**

Запустить: `go test ./... -count=1`
Ожидается: PASS.

- [ ] **Шаг 14: Коммит**

```bash
git add internal cmd Makefile
git rm --cached internal/httpx/router.go 2>/dev/null || true
git commit -m "Добавить вход по паролю, сессии и защиту маршрутов"
```

---

## Задача 6: Вертикальный срез — справочник подразделений

**Файлы:**
- Создать: `internal/departments/store.go`
- Создать: `internal/departments/service.go`
- Создать: `internal/departments/handler.go`
- Изменить: `internal/app/router.go`, `cmd/api/main.go`
- Тест: `internal/app/vertical_test.go`

**Интерфейсы:**
- Потребляет: `(*db.Pool).WithTenant` (задача 3); `identity.FromContext`,
  `(*identity.Handler).RequireAuth`, `identity.NewService`, `(*Service).CreateUser`,
  `identity.NewHandler` (задача 5); `httpx.*` (задача 1).
- Производит:
  `departments.Department{ID uuid.UUID; Code, Name string; CreatedAt time.Time}`;
  `departments.NewStore(pool *db.Pool) *Store`;
  `departments.NewService(store *Store) *Service`;
  `(*Service).List(ctx context.Context, tenantID uuid.UUID) ([]Department, error)`;
  `(*Service).Create(ctx context.Context, tenantID uuid.UUID, code, name string) (Department, error)`;
  `departments.ErrDuplicateCode`, `departments.ErrEmptyCode`, `departments.ErrEmptyName`;
  `departments.NewHandler(svc *Service, auth func(http.Handler) http.Handler) *Handler`;
  `(*Handler).Register(mux *http.ServeMux)`;
  `app.Deps` получает поле `Departments *departments.Handler`.

- [ ] **Шаг 1: Написать падающий сквозной тест**

Файл `internal/app/vertical_test.go`:

```go
package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/serz/studcore/internal/app"
	"github.com/serz/studcore/internal/db"
	"github.com/serz/studcore/internal/departments"
	"github.com/serz/studcore/internal/identity"
	"github.com/serz/studcore/internal/testsupport"
)

type fixture struct {
	server *httptest.Server
	client *http.Client
}

func newFixture(t *testing.T) (*fixture, *db.Pool) {
	t.Helper()
	ctx := context.Background()

	pool, err := db.Open(ctx, testsupport.Postgres(t))
	if err != nil {
		t.Fatalf("открытие пула: %v", err)
	}
	t.Cleanup(pool.Close)

	identitySvc := identity.NewService(identity.NewStore(pool), time.Hour)
	identityHandler := identity.NewHandler(identitySvc, false, time.Hour)
	departmentsHandler := departments.NewHandler(
		departments.NewService(departments.NewStore(pool)),
		identityHandler.RequireAuth,
	)

	srv := httptest.NewServer(app.NewRouter(app.Deps{
		Identity:    identityHandler,
		Departments: departmentsHandler,
	}))
	t.Cleanup(srv.Close)

	jar, err := newJar()
	if err != nil {
		t.Fatalf("создание хранилища cookie: %v", err)
	}
	return &fixture{server: srv, client: &http.Client{Jar: jar}}, pool
}

func (f *fixture) do(t *testing.T, method, path string, body any) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("кодирование тела: %v", err)
		}
	}
	req, err := http.NewRequest(method, f.server.URL+path, &buf)
	if err != nil {
		t.Fatalf("создание запроса: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.client.Do(req)
	if err != nil {
		t.Fatalf("выполнение запроса %s %s: %v", method, path, err)
	}
	return resp
}

func seedUser(t *testing.T, pool *db.Pool, slug, email, password string) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	var tenantID uuid.UUID
	err := pool.Tx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO tenants (slug, name) VALUES ($1, $1) RETURNING id`, slug).Scan(&tenantID)
	})
	if err != nil {
		t.Fatalf("создание арендатора: %v", err)
	}

	svc := identity.NewService(identity.NewStore(pool), time.Hour)
	if _, err := svc.CreateUser(ctx, tenantID, email, password, "Тестовый Сотрудник", "admin"); err != nil {
		t.Fatalf("создание пользователя: %v", err)
	}
	return tenantID
}

func TestDepartmentsRequireAuthentication(t *testing.T) {
	f, _ := newFixture(t)

	resp := f.do(t, http.MethodGet, "/api/v1/departments", nil)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("код ответа = %d, ожидался 401", resp.StatusCode)
	}
}

func TestLoginThenCreateAndListDepartments(t *testing.T) {
	f, pool := newFixture(t)
	seedUser(t, pool, "vertical-a", "staff@vuz.ru", "пароль-сотрудника")

	resp := f.do(t, http.MethodPost, "/api/v1/auth/login",
		map[string]string{"email": "staff@vuz.ru", "password": "пароль-сотрудника"})
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("вход: код ответа = %d, ожидался 200", resp.StatusCode)
	}

	resp = f.do(t, http.MethodPost, "/api/v1/departments",
		map[string]string{"code": "ЭФ", "name": "Экономический факультет"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("создание: код ответа = %d, ожидался 201", resp.StatusCode)
	}

	listResp := f.do(t, http.MethodGet, "/api/v1/departments", nil)
	defer listResp.Body.Close()

	var list []struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&list); err != nil {
		t.Fatalf("разбор списка: %v", err)
	}
	if len(list) != 1 || list[0].Code != "ЭФ" {
		t.Fatalf("список = %+v, ожидалась одна запись с кодом ЭФ", list)
	}
}

func TestDepartmentsOfOtherTenantAreInvisible(t *testing.T) {
	f, pool := newFixture(t)
	seedUser(t, pool, "vertical-b", "first@vuz.ru", "пароль-первого")
	seedUser(t, pool, "vertical-c", "second@vuz.ru", "пароль-второго")

	resp := f.do(t, http.MethodPost, "/api/v1/auth/login",
		map[string]string{"email": "first@vuz.ru", "password": "пароль-первого"})
	resp.Body.Close()

	resp = f.do(t, http.MethodPost, "/api/v1/departments",
		map[string]string{"code": "ЮФ", "name": "Юридический факультет"})
	resp.Body.Close()

	resp = f.do(t, http.MethodPost, "/api/v1/auth/login",
		map[string]string{"email": "second@vuz.ru", "password": "пароль-второго"})
	resp.Body.Close()

	listResp := f.do(t, http.MethodGet, "/api/v1/departments", nil)
	defer listResp.Body.Close()

	var list []struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&list); err != nil {
		t.Fatalf("разбор списка: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("второй арендатор видит %d чужих подразделений, ожидалось 0", len(list))
	}
}

func TestDuplicateCodeIsRejectedWithFieldHint(t *testing.T) {
	f, pool := newFixture(t)
	seedUser(t, pool, "vertical-d", "dup@vuz.ru", "пароль-дубля")

	resp := f.do(t, http.MethodPost, "/api/v1/auth/login",
		map[string]string{"email": "dup@vuz.ru", "password": "пароль-дубля"})
	resp.Body.Close()

	resp = f.do(t, http.MethodPost, "/api/v1/departments",
		map[string]string{"code": "ИФ", "name": "Исторический факультет"})
	resp.Body.Close()

	resp = f.do(t, http.MethodPost, "/api/v1/departments",
		map[string]string{"code": "ИФ", "name": "Другое название"})
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("код ответа = %d, ожидался 409", resp.StatusCode)
	}
	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Field   string `json:"field"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("разбор ошибки: %v", err)
	}
	if body.Field != "code" {
		t.Errorf("field = %q, ожидалось \"code\"", body.Field)
	}
	if body.Message == "" {
		t.Error("сообщение об ошибке пустое — пользователю нечего показать")
	}
}
```

Добавить в тот же файл вспомогательную функцию:

```go
func newJar() (http.CookieJar, error) {
	return cookiejar.New(nil)
}
```

с импортом `"net/http/cookiejar"`.

- [ ] **Шаг 2: Запустить тест и убедиться, что он падает**

Запустить: `go test ./internal/app/ -v`
Ожидается: FAIL — пакет `departments` не существует.

- [ ] **Шаг 3: Реализовать хранилище**

Файл `internal/departments/store.go`:

```go
package departments

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/serz/studcore/internal/db"
)

type Department struct {
	ID        uuid.UUID `json:"id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

var ErrDuplicateCode = errors.New("подразделение с таким кодом уже есть")

type Store struct {
	pool *db.Pool
}

func NewStore(pool *db.Pool) *Store { return &Store{pool: pool} }

func (s *Store) list(ctx context.Context, tenantID uuid.UUID) ([]Department, error) {
	out := []Department{}
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, code, name, created_at
			FROM departments
			WHERE deleted_at IS NULL
			ORDER BY code
		`)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var d Department
			if err := rows.Scan(&d.ID, &d.Code, &d.Name, &d.CreatedAt); err != nil {
				return err
			}
			out = append(out, d)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("чтение подразделений: %w", err)
	}
	return out, nil
}

func (s *Store) create(ctx context.Context, tenantID uuid.UUID, code, name string) (Department, error) {
	var d Department
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO departments (tenant_id, code, name)
			VALUES ($1, $2, $3)
			RETURNING id, code, name, created_at
		`, tenantID, code, name).Scan(&d.ID, &d.Code, &d.Name, &d.CreatedAt)
	})

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Department{}, ErrDuplicateCode
	}
	if err != nil {
		return Department{}, fmt.Errorf("создание подразделения: %w", err)
	}
	return d, nil
}
```

- [ ] **Шаг 4: Реализовать сервис**

Файл `internal/departments/service.go`:

```go
package departments

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	ErrEmptyCode = errors.New("код подразделения не заполнен")
	ErrEmptyName = errors.New("название подразделения не заполнено")
	ErrLongCode  = errors.New("код подразделения длиннее 20 символов")
	ErrLongName  = errors.New("название подразделения длиннее 200 символов")
)

type Service struct {
	store *Store
}

func NewService(store *Store) *Service { return &Service{store: store} }

func (s *Service) List(ctx context.Context, tenantID uuid.UUID) ([]Department, error) {
	return s.store.list(ctx, tenantID)
}

func (s *Service) Create(ctx context.Context, tenantID uuid.UUID, code, name string) (Department, error) {
	code = strings.TrimSpace(code)
	name = strings.TrimSpace(name)

	switch {
	case code == "":
		return Department{}, ErrEmptyCode
	case utf8.RuneCountInString(code) > 20:
		return Department{}, ErrLongCode
	case name == "":
		return Department{}, ErrEmptyName
	case utf8.RuneCountInString(name) > 200:
		return Department{}, ErrLongName
	}

	return s.store.create(ctx, tenantID, code, name)
}
```

- [ ] **Шаг 5: Реализовать обработчик**

Файл `internal/departments/handler.go`:

```go
package departments

import (
	"errors"
	"net/http"

	"github.com/serz/studcore/internal/httpx"
	"github.com/serz/studcore/internal/identity"
)

type Handler struct {
	svc  *Service
	auth func(http.Handler) http.Handler
}

// auth передаётся снаружи, чтобы модуль справочника не зависел от того,
// как именно устроена аутентификация.
func NewHandler(svc *Service, auth func(http.Handler) http.Handler) *Handler {
	return &Handler{svc: svc, auth: auth}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/departments", h.auth(http.HandlerFunc(h.list)))
	mux.Handle("POST /api/v1/departments", h.auth(http.HandlerFunc(h.create)))
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	p, ok := identity.FromContext(r.Context())
	if !ok {
		httpx.Fail(w, http.StatusUnauthorized, "unauthenticated", "Войдите в систему")
		return
	}

	items, err := h.svc.List(r.Context(), p.TenantID)
	if err != nil {
		httpx.Fail(w, http.StatusInternalServerError, "internal",
			"Не удалось загрузить список подразделений")
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}

type createRequest struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	p, ok := identity.FromContext(r.Context())
	if !ok {
		httpx.Fail(w, http.StatusUnauthorized, "unauthenticated", "Войдите в систему")
		return
	}

	var req createRequest
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Fail(w, http.StatusBadRequest, "bad_request", "Не удалось разобрать запрос")
		return
	}

	d, err := h.svc.Create(r.Context(), p.TenantID, req.Code, req.Name)
	switch {
	case errors.Is(err, ErrEmptyCode):
		httpx.FailField(w, http.StatusBadRequest, "code_required",
			"Укажите код подразделения — он попадёт в номер документа", "code")
	case errors.Is(err, ErrLongCode):
		httpx.FailField(w, http.StatusBadRequest, "code_too_long",
			"Код подразделения не длиннее 20 символов", "code")
	case errors.Is(err, ErrEmptyName):
		httpx.FailField(w, http.StatusBadRequest, "name_required",
			"Укажите название подразделения", "name")
	case errors.Is(err, ErrLongName):
		httpx.FailField(w, http.StatusBadRequest, "name_too_long",
			"Название подразделения не длиннее 200 символов", "name")
	case errors.Is(err, ErrDuplicateCode):
		httpx.FailField(w, http.StatusConflict, "code_duplicate",
			"Подразделение с таким кодом уже заведено. Укажите другой код", "code")
	case err != nil:
		httpx.Fail(w, http.StatusInternalServerError, "internal",
			"Не удалось создать подразделение")
	default:
		httpx.JSON(w, http.StatusCreated, d)
	}
}
```

- [ ] **Шаг 6: Подключить модуль к маршрутизатору**

В `internal/app/router.go` добавить импорт
`"github.com/serz/studcore/internal/departments"`, поле в `Deps` и регистрацию:

```go
type Deps struct {
	Identity    *identity.Handler
	Departments *departments.Handler
}
```

```go
	if d.Departments != nil {
		d.Departments.Register(mux)
	}
```

Регистрацию поставить после `d.Identity.Register(mux)` и до обработчика `"/"`.

- [ ] **Шаг 7: Подключить модуль в точке входа**

В `cmd/api/main.go` после создания `identitySvc`:

```go
	identityHandler := identity.NewHandler(identitySvc, cfg.CookieSecure, cfg.SessionTTL)
	departmentsHandler := departments.NewHandler(
		departments.NewService(departments.NewStore(pool)),
		identityHandler.RequireAuth,
	)
```

и передать оба в `app.Deps{Identity: identityHandler, Departments: departmentsHandler}`.
Добавить импорт `"github.com/serz/studcore/internal/departments"`.

- [ ] **Шаг 8: Запустить тесты и убедиться, что они проходят**

Запустить: `go test ./... -count=1 -v`
Ожидается: PASS всех тестов, включая четыре сквозных из `internal/app`.

- [ ] **Шаг 9: Коммит**

```bash
git add internal cmd
git commit -m "Добавить справочник подразделений как вертикальный срез через все слои"
```

---

## Задача 7: Интерфейс — вход и справочник подразделений

**Файлы:**
- Создать: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`
- Создать: `web/src/main.tsx`, `web/src/api.ts`, `web/src/App.tsx`
- Создать: `web/src/LoginPage.tsx`, `web/src/DepartmentsPage.tsx`, `web/src/styles.css`
- Тест: `web/src/api.test.ts`
- Изменить: `Makefile`

**Интерфейсы:**
- Потребляет: HTTP API из задач 5 и 6 — `POST /api/v1/auth/login`,
  `POST /api/v1/auth/logout`, `GET /api/v1/me`, `GET /api/v1/departments`,
  `POST /api/v1/departments`.
- Производит: `request<T>(path: string, init?: RequestInit): Promise<T>`;
  класс `ApiError` с полями `code: string`, `message: string`, `field?: string`.

**Оформления в этой задаче нет.** Tailwind, shadcn/ui и командная палитра приходят
на этапе 2 вместе с настоящими экранами; здесь нужен только рабочий срез.

- [ ] **Шаг 1: Завести проект**

```bash
cd ~/projects/studcore
npm create vite@latest web -- --template react-ts
cd web
npm install
npm install @tanstack/react-query
npm install -D vitest
```

- [ ] **Шаг 2: Написать падающий тест**

Файл `web/src/api.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { ApiError, request } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('request', () => {
  it('возвращает разобранное тело при успехе', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, [{ code: 'ЭФ' }])))

    const result = await request<Array<{ code: string }>>('/api/v1/departments')

    expect(result).toEqual([{ code: 'ЭФ' }])
  })

  it('превращает ошибку сервера в ApiError с текстом для пользователя', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(409, {
      code: 'code_duplicate',
      message: 'Подразделение с таким кодом уже заведено. Укажите другой код',
      field: 'code',
    })))

    await expect(request('/api/v1/departments', { method: 'POST' }))
      .rejects.toMatchObject({
        code: 'code_duplicate',
        field: 'code',
        message: 'Подразделение с таким кодом уже заведено. Укажите другой код',
      })
  })

  it('не теряет сообщение, когда сервер ответил не JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('502 Bad Gateway', { status: 502 })))

    const err = await request('/api/v1/me').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).not.toBe('')
  })
})
```

- [ ] **Шаг 3: Запустить тест и убедиться, что он падает**

Запустить: `cd web && npx vitest run`
Ожидается: FAIL — модуль `./api` не найден.

- [ ] **Шаг 4: Реализовать клиент API**

Файл `web/src/api.ts`:

```ts
export class ApiError extends Error {
  readonly code: string
  readonly field?: string

  constructor(code: string, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.field = field
  }
}

// Все запросы идут с cookie сессии; токен в JavaScript не попадает,
// поэтому его нельзя украсть через XSS.
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })

  if (response.status === 204) {
    return undefined as T
  }

  const raw = await response.text()
  let body: unknown = null
  try {
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    body = null
  }

  if (!response.ok) {
    const parsed = body as { code?: string; message?: string; field?: string } | null
    throw new ApiError(
      parsed?.code ?? 'unknown',
      parsed?.message ?? 'Сервис временно недоступен. Попробуйте ещё раз через минуту',
      parsed?.field,
    )
  }

  return body as T
}
```

- [ ] **Шаг 5: Запустить тест и убедиться, что он проходит**

Запустить: `cd web && npx vitest run`
Ожидается: PASS всех трёх тестов.

- [ ] **Шаг 6: Настроить прокси на бэкенд**

Файл `web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
```

- [ ] **Шаг 7: Реализовать экран входа**

Файл `web/src/LoginPage.tsx`:

```tsx
import { useState } from 'react'
import { ApiError, request } from './api'

type Principal = {
  user_id: string
  tenant_id: string
  email: string
  full_name: string
  role: string
}

export function LoginPage({ onSuccess }: { onSuccess: (p: Principal) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const principal = await request<Principal>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      onSuccess(principal)
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h1>Вход</h1>
      <label>
        Рабочая почта
        <input
          type="email"
          value={email}
          autoFocus
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error?.field === 'email'}
        />
      </label>
      <label>
        Пароль
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error?.field === 'password'}
        />
      </label>
      {error && <p role="alert" className="error">{error.message}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Проверяем…' : 'Войти'}</button>
    </form>
  )
}

export type { Principal }
```

- [ ] **Шаг 8: Реализовать экран справочника**

Файл `web/src/DepartmentsPage.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, request } from './api'
import type { Principal } from './LoginPage'

type Department = {
  id: string
  code: string
  name: string
  created_at: string
}

export function DepartmentsPage({ principal, onLogout }: { principal: Principal; onLogout: () => void }) {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<ApiError | null>(null)

  const list = useQuery({
    queryKey: ['departments'],
    queryFn: () => request<Department[]>('/api/v1/departments'),
  })

  const create = useMutation({
    mutationFn: () =>
      request<Department>('/api/v1/departments', {
        method: 'POST',
        body: JSON.stringify({ code, name }),
      }),
    onSuccess: () => {
      setCode('')
      setName('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (e) => setError(e as ApiError),
  })

  async function logout() {
    await request('/api/v1/auth/logout', { method: 'POST' })
    onLogout()
  }

  return (
    <div className="page">
      <header>
        <span>{principal.full_name}</span>
        <button type="button" onClick={logout}>Выйти</button>
      </header>

      <h1>Подразделения</h1>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <input
          placeholder="Код"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error?.field === 'code'}
        />
        <input
          placeholder="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error?.field === 'name'}
        />
        <button type="submit" disabled={create.isPending}>Добавить</button>
      </form>
      {error && <p role="alert" className="error">{error.message}</p>}

      {list.isPending && <p>Загружаем…</p>}
      {list.isError && <p role="alert" className="error">Не удалось загрузить список</p>}
      {list.data && (
        <table>
          <thead>
            <tr><th>Код</th><th>Название</th></tr>
          </thead>
          <tbody>
            {list.data.map((d) => (
              <tr key={d.id}><td>{d.code}</td><td>{d.name}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {list.data?.length === 0 && <p>Пока ни одного подразделения не заведено</p>}
    </div>
  )
}
```

- [ ] **Шаг 9: Собрать приложение**

Файл `web/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { request } from './api'
import { LoginPage, type Principal } from './LoginPage'
import { DepartmentsPage } from './DepartmentsPage'

const queryClient = new QueryClient()

export function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null)
  const [checked, setChecked] = useState(false)

  // Сессия живёт в cookie, поэтому после перезагрузки страницы
  // достаточно спросить сервер, кто мы.
  useEffect(() => {
    request<Principal>('/api/v1/me')
      .then(setPrincipal)
      .catch(() => setPrincipal(null))
      .finally(() => setChecked(true))
  }, [])

  if (!checked) return <p>Загружаем…</p>

  return (
    <QueryClientProvider client={queryClient}>
      {principal
        ? <DepartmentsPage principal={principal} onLogout={() => setPrincipal(null)} />
        : <LoginPage onSuccess={setPrincipal} />}
    </QueryClientProvider>
  )
}
```

Файл `web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Файл `web/src/styles.css`:

```css
:root { font-family: system-ui, sans-serif; color-scheme: light dark; }
body { margin: 0; padding: 24px; }
.card { display: grid; gap: 12px; max-width: 320px; }
.page { display: grid; gap: 16px; }
.row { display: flex; gap: 8px; }
header { display: flex; gap: 12px; align-items: center; justify-content: flex-end; }
table { border-collapse: collapse; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
.error { color: #b00020; }
input[aria-invalid='true'] { outline: 2px solid #b00020; }
```

Удалить созданные шаблоном `web/src/App.css` и `web/src/index.css`, если они есть.

- [ ] **Шаг 10: Проверить типы, тесты и сборку**

```bash
cd web
npx tsc --noEmit
npx vitest run
npm run build
```

Ожидается: без ошибок типов, тесты проходят, сборка создаёт `web/dist`.

- [ ] **Шаг 11: Проверить руками**

В одном терминале `make run`, в другом `cd web && npm run dev`.
Открыть `http://localhost:5173`, войти как `admin@demo.ru`, добавить
подразделение, обновить страницу — сессия сохраняется, список остаётся.
Попробовать добавить второе подразделение с тем же кодом — под полем «Код»
появляется красное сообщение «Подразделение с таким кодом уже заведено».

- [ ] **Шаг 12: Дополнить Makefile**

```makefile
.PHONY: web web-test

web:
	cd web && npm run dev

web-test:
	cd web && npx tsc --noEmit && npx vitest run
```

- [ ] **Шаг 13: Коммит**

```bash
git add web Makefile
git commit -m "Добавить интерфейс входа и справочника подразделений"
```

---

## Задача 8: Непрерывная проверка

**Файлы:**
- Создать: `.github/workflows/ci.yml`
- Создать: `.golangci.yml`
- Изменить: `Makefile`

**Интерфейсы:**
- Потребляет: цели `test`, `web-test` из Makefile.
- Производит: проверку, падающую при любой ошибке компиляции, теста или линтера.

- [ ] **Шаг 1: Настроить линтер**

Файл `.golangci.yml`:

```yaml
version: "2"

linters:
  enable:
    - errcheck
    - govet
    - ineffassign
    - staticcheck
    - unused
    - bodyclose
    - rowserrcheck
    - sqlclosecheck

issues:
  max-issues-per-linter: 0
  max-same-issues: 0
```

- [ ] **Шаг 2: Установить линтер и убедиться, что он проходит**

```bash
brew install golangci-lint
golangci-lint run ./...
```

Ожидается: без замечаний. Если `rowserrcheck` ругается — значит где-то забыт
`rows.Err()`, это настоящая ошибка, её надо исправить, а не отключать линтер.

- [ ] **Шаг 3: Описать проверку**

Файл `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  go:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.26.6'
          cache: true
      - name: Тесты
        run: go test ./... -count=1
      - uses: golangci/golangci-lint-action@v6
        with:
          version: latest

  web:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - name: Типы
        run: npx tsc --noEmit
      - name: Тесты
        run: npx vitest run
      - name: Сборка
        run: npm run build
```

Интеграционные тесты работают на GitHub Actions без дополнительной настройки:
на раннерах `ubuntu-latest` установлен Docker, testcontainers его находит сам.

- [ ] **Шаг 4: Обновить цель линтера в Makefile**

```makefile
lint:
	golangci-lint run ./...
```

- [ ] **Шаг 5: Проверить весь набор локально**

Запустить: `make test lint web-test`
Ожидается: всё проходит.

- [ ] **Шаг 6: Коммит и проверка на GitHub**

```bash
git add .github .golangci.yml Makefile
git commit -m "Добавить непрерывную проверку тестами и линтером"
git push
```

Убедиться, что оба задания CI зелёные. Если репозиторий ещё не связан с GitHub —
создать его и добавить `origin` до пуша.

---

## Задача 9: Контейнеризация и деплой

**Файлы:**
- Создать: `deploy/Dockerfile`
- Создать: `deploy/docker-compose.yml`
- Создать: `deploy/Caddyfile`
- Создать: `deploy/.env.example`
- Создать: `docs/runbook.md`
- Изменить: `Makefile`

**Интерфейсы:**
- Потребляет: `cmd/api`, `cmd/migrate`, `cmd/createuser`, сборку `web/dist`.
- Производит: образ `studcore:latest` и стек, поднимающийся одной командой.

- [ ] **Шаг 1: Написать Dockerfile**

Файл `deploy/Dockerfile`:

```dockerfile
# Сборка фронтенда
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Сборка бэкенда
FROM golang:1.26-alpine AS api
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -o /out/migrate ./cmd/migrate \
 && CGO_ENABLED=0 go build -o /out/createuser ./cmd/createuser

# Итоговый образ
FROM alpine:3.20
RUN adduser -D -u 10001 studcore
COPY --from=api /out/api /usr/local/bin/api
COPY --from=api /out/migrate /usr/local/bin/migrate
COPY --from=api /out/createuser /usr/local/bin/createuser
COPY --from=web /src/web/dist /srv/web
USER studcore
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/api"]
```

- [ ] **Шаг 2: Описать стек**

Файл `deploy/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: studcore
      POSTGRES_USER: owner
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?задайте POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U owner -d studcore"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  migrate:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    entrypoint: ["/usr/local/bin/migrate"]
    environment:
      SC_MIGRATE_DATABASE_URL: postgres://owner:${POSTGRES_PASSWORD}@postgres:5432/studcore?sslmode=disable
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"

  api:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    environment:
      SC_ADDR: ":8080"
      SC_DATABASE_URL: postgres://studcore_app:${APP_PASSWORD:?задайте APP_PASSWORD}@postgres:5432/studcore?sslmode=disable
      SC_COOKIE_SECURE: "1"
    depends_on:
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
    depends_on:
      - api
    restart: unless-stopped

volumes:
  pgdata:
  caddydata:
```

Контейнер `api` содержит собранный фронтенд в `/srv/web`, но раздаёт его Caddy —
поэтому статика монтируется в Caddy из того же образа не через том, а копией
при сборке (см. Caddyfile: обратный прокси на `api` для `/api`, статика — из
общего каталога). Для первого сервера достаточно того, что Caddy проксирует
всё на `api`, а `api` отдаёт статику; это упрощение задокументировано в runbook
и снимается на этапе 6.

- [ ] **Шаг 3: Научить сервис раздавать статику**

Добавить в `internal/app/router.go` перед обработчиком `"/"`:

```go
	// В проде фронтенд лежит рядом с бинарником и отдаётся тем же процессом:
	// отдельный веб-сервер для этого пока не нужен.
	if d.WebRoot != "" {
		files := http.FileServer(http.Dir(d.WebRoot))
		mux.Handle("GET /assets/", files)
		mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, d.WebRoot+"/index.html")
		})
	}
```

и поле `WebRoot string` в `Deps`. В `cmd/api/main.go` передать
`WebRoot: os.Getenv("SC_WEB_ROOT")`. В `deploy/docker-compose.yml` добавить
сервису `api` переменную `SC_WEB_ROOT: /srv/web`.

- [ ] **Шаг 4: Описать Caddy**

Файл `deploy/Caddyfile`:

```
{$SC_DOMAIN} {
	encode gzip
	reverse_proxy api:8080
}
```

- [ ] **Шаг 5: Описать переменные окружения**

Файл `deploy/.env.example`:

```
# Скопировать в deploy/.env и заполнить своими значениями. .env в git не попадает.
POSTGRES_PASSWORD=смените-меня
APP_PASSWORD=смените-меня-тоже
SC_DOMAIN=studcore.example.ru
```

Добавить `deploy/.env` в `.gitignore`.

- [ ] **Шаг 6: Проверить стек локально**

```bash
cd deploy
cp .env.example .env
# Для локальной проверки достаточно домена localhost — Caddy выдаст свой сертификат.
sed -i '' 's/studcore.example.ru/localhost/' .env
docker compose --env-file .env up --build -d
docker compose ps
```

Ожидается: `migrate` завершился успешно, `api`, `postgres` и `caddy` работают.

Выдать роли приложения пароль и завести первого пользователя:

```bash
docker compose exec -T postgres psql -U owner -d studcore \
  -c "ALTER ROLE studcore_app LOGIN PASSWORD '$(grep APP_PASSWORD .env | cut -d= -f2)'"
docker compose exec api /usr/local/bin/createuser \
  -tenant demo -tenant-name "Демо-вуз" \
  -email admin@demo.ru -password demo-пароль -name "Администратор Демо"
```

Открыть `https://localhost` — открывается экран входа, вход работает.

- [ ] **Шаг 7: Написать runbook**

Файл `docs/runbook.md`:

```markdown
# Эксплуатация StudCore

## Первый запуск на сервере

1. Установить Docker и склонировать репозиторий.
2. `cp deploy/.env.example deploy/.env`, задать пароли и домен.
3. `cd deploy && docker compose --env-file .env up --build -d`.
   Сервис `migrate` накатывает схему и завершается; `api` стартует после него.
4. Выдать роли приложения пароль — она создаётся миграцией без права входа:
   `docker compose exec -T postgres psql -U owner -d studcore -c "ALTER ROLE studcore_app LOGIN PASSWORD '<APP_PASSWORD>'"`
5. Завести администратора арендатора:
   `docker compose exec api /usr/local/bin/createuser -tenant <код> -tenant-name "<название>" -email <почта> -password <пароль> -name "<ФИО>"`

## Обновление версии

`git pull && docker compose --env-file .env up --build -d`.
Миграции накатываются автоматически перед стартом `api`.

## Резервное копирование

Ежедневно: `docker compose exec -T postgres pg_dump -U owner studcore | gzip > /backup/studcore-$(date +%F).sql.gz`.
Хранить 30 копий. **Раз в месяц восстанавливать копию в пустую базу и проверять,
что приложение на ней стартует** — непроверенная копия копией не считается.

## Диагностика

- Логи: `docker compose logs -f api` (формат JSON, поле `err` содержит причину).
- Живость: `curl -s https://<домен>/healthz` → `{"status":"ok"}`.
- Не работает вход и в логах «проверка подключения к базе»: роли `studcore_app`
  не выдан пароль — повторить шаг 4 первого запуска.
- Пустые списки при заполненной базе: не установлен контекст арендатора.
  Проверить, что запрос идёт через `WithTenant`, а не через `Tx`.

## Ограничения текущей версии

- Статику отдаёт сам сервис, Caddy только терминирует TLS. Разделение —
  на этапе 6, когда появится нагрузка на выдачу файлов.
- Реплики `api` не настроены: обновление даёт простой в несколько секунд.
```

- [ ] **Шаг 8: Дополнить Makefile**

```makefile
.PHONY: up down logs

up:
	cd deploy && docker compose --env-file .env up --build -d

down:
	cd deploy && docker compose --env-file .env down

logs:
	cd deploy && docker compose --env-file .env logs -f api
```

- [ ] **Шаг 9: Прогнать всё целиком**

Запустить: `make test lint web-test`
Ожидается: всё зелёное.

- [ ] **Шаг 10: Коммит**

```bash
git add deploy docs/runbook.md Makefile .gitignore internal/app cmd/api
git commit -m "Добавить контейнеризацию, деплой и runbook"
```

---

## Проверка плана относительно спеки

**Покрытие требований этапа 1:**

| Требование спеки | Где реализовано |
|---|---|
| §3 модульный монолит, границы модулей | Структура файлов; `identity` и `departments` общаются через экспортированные функции, `httpx` — листовой пакет |
| §3 процессы `api`, `postgres`, `caddy` | Задача 9 |
| §4 `tenant_id` во всех доменных таблицах | Задача 2, миграция `0001_init.sql` |
| §4 RLS с `ENABLE` и `FORCE` | Задача 2; проверяется `TestEveryDomainTableHasRLS` |
| §4 изоляция арендаторов не зависит от кода | Задача 3, четыре теста изоляции |
| §4 физическое удаление не применяется | `deleted_at` в `departments`, `GRANT` без `DELETE` на доменные таблицы |
| §6 ошибки на языке предметной области с указанием поля | `httpx.FailField`, обработчик `departments`, проверка в `TestDuplicateCodeIsRejectedWithFieldHint` |
| §6 React + TypeScript + TanStack Query | Задача 7 |
| §8 тесты на настоящем PostgreSQL | `testsupport.Postgres` на testcontainers |
| §8 структурные логи | `slog` в обоих бинарниках |
| §8 CI: линтер, тесты, сборка | Задача 8 |
| §8 миграции через goose, `docker compose`, без Kubernetes | Задачи 2 и 9 |
| §8 резервное копирование с проверкой восстановления | `docs/runbook.md` |

**Сознательно отложено за пределы этапа 1** (и это зафиксировано в разделе
«Границы этапа»): журнал доступа append-only и роли сложнее `admin`/`staff` —
этап 6; оформление интерфейса, поиск и командная палитра — этап 2; реплики `api`
и разделение раздачи статики — этап 6.

**Согласованность имён.** `db.Pool.WithTenant` используется одинаково в задачах 3
и 6. `identity.FromContext` объявлен в задаче 5 и вызывается в задаче 6.
`httpx.Fail`/`httpx.FailField` объявлены в задаче 1 и используются в задачах 5–6.
`app.Deps` расширяется в задачах 6 и 9 — каждое расширение показано явно.
