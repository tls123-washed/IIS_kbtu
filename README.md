# Campus Threads

Рабочий сайт: **[campus-threads-am1s.onrender.com](https://campus-threads-am1s.onrender.com/)**. Интерфейс и Python работают на Render, общая PostgreSQL — на Neon; компьютер разработчика для доступа не нужен.

Для размещения в интернете используй [инструкцию Render Free + Neon Free](DEPLOY.md). В ней описано создание облачной базы, публикация сервера и подключение pgAdmin. Файлы `render.yaml` и `server/cloud.py` задают конфигурацию размещения.

В интерфейсе доступны десктопная навигация, светлая и тёмная темы, анимации кнопок. Регистрация по умолчанию использует `@kbtu.kz` и пароль, без письма с кодом. Результаты 20 основных проверок интерфейса, 5 проверок запуска и измерения нагрузки находятся в [TEST_REPORT.md](TEST_REPORT.md), команды повторного прогона — в [tests/README.md](tests/README.md).

Если впервые открываешь этот проект, начни с [карты файлов и первого упражнения в pgAdmin](START_HERE.md).

Соцсеть KBTU с общей базой PostgreSQL. В пилот входят регистрация студентов по почте `@kbtu.kz`, лента, треды и ответы, лайки, подписки, поиск, сообщества и бесплатные билеты на мероприятия.

## Запуск на Windows для разработки

### Если проект уже настроен на этом компьютере

В Проводнике дважды нажми [CampusThreads.cmd](CampusThreads.cmd). При запуске сайта программа включает локальную PostgreSQL при необходимости, применяет миграции и выводит текущий адрес.

- **1** открывает работающий сайт или запускает его на этом ПК. Если порт `8000` занят, программа выберет свободный.
- **2** запускает временную HTTPS-ссылку для просмотра разработки. Для сдачи и постоянного доступа используй Render и Neon.
- **3** перезапускает сайт после изменений кода или `.env`. У временной ссылки меняется адрес.
- **4** останавливает сайт и временную ссылку.
- **5** назначает организатора мероприятий. Введи имя пользователя, с которым человек зарегистрировался в Campus Threads.
- **6** открывает выдачу и отзыв прав модератора сайта или сообщества.
- **0** закрывает меню. Его можно снова открыть двойным нажатием на тот же файл.

Для доступа из интернета ПК должен оставаться включённым и подключённым к сети. В этой копии `cloudflared.exe` лежит в папке `.runtime`. На другом ПК скачай [Cloudflare Tunnel для Windows](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) и положи его в ту же папку под именем `cloudflared.exe` или добавь в PATH. [Документация временных ссылок](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Python читает строку `DATABASE_URL` из локального файла `.env`. Для подготовленного окружения она указывает на `127.0.0.1:55432`, базу `campus_threads_pilot` и пользователя `campus_local`. Чтобы посмотреть ту же базу, зарегистрируй сервер с этими реквизитами в pgAdmin. В поле **Password** введи пароль пользователя PostgreSQL из `DATABASE_URL`. Затем открой **Databases → campus_threads_pilot → Schemas → public → Tables**.

### Если настраиваешь проект с нуля

1. В pgAdmin создайте отдельную пустую базу `campus_threads_pilot`. Для размещения пилота используйте отдельного пользователя PostgreSQL с доступом к этой базе. Его укажите владельцем базы.
2. В PowerShell из папки проекта создайте окружение Python 3.11+ и заполните настройки. Сгенерируйте секрет, скопируйте его в `APP_SECRET` и подставьте свои реквизиты в `DATABASE_URL`.

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   Copy-Item .env.example .env
   .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

3. Примените миграции и запустите приложение. Повторный запуск миграций пропустит уже применённые файлы.

   ```powershell
   .\.venv\Scripts\python.exe -m server.manage migrate
   .\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
   ```

4. Откройте [локальное приложение](http://127.0.0.1:8000). При `AUTH_MODE=domain` заполните форму с адресом `@kbtu.kz` и нажмите «Создать аккаунт». Если выбраны `AUTH_MODE=code` и `MAIL_MODE=file`, код придёт в файл `.eml` в папке `.mailbox/` в корне проекта.

При запуске на другом порту измените `APP_ORIGIN` и введите в браузере тот же адрес. Например, `localhost` и `127.0.0.1` считаются разными источниками. Проверить доступность сервера и базы можно через [ручку health](http://127.0.0.1:8000/api/health). Контракт API доступен в [Swagger UI](http://127.0.0.1:8000/docs).

### Когда создаются таблицы

Сначала в PostgreSQL должна существовать пустая база. Команда `python -m server.manage migrate` подключается к ней и выполняет SQL по порядку из [manage.py](server/manage.py). Базовые таблицы `users`, `posts` и другие создаются из [01_schema.sql](site/sql/01_schema.sql), а `events` и `event_tickets` добавляет [02_pilot.sql](server/schema/02_pilot.sql). Применённые версии записываются в `public.campus_migrations`, поэтому при повторном запуске выполняются только новые миграции. Чтобы проверить, к какой базе подключён Query Tool, выполни:

```sql
SELECT current_database(), inet_server_port();
SELECT version FROM public.campus_migrations ORDER BY version;
```

## Разбор по шагам

Открытая страница запрашивает актуальные данные примерно раз в четыре секунды. Это касается ленты, ответов, лайков, профилей, сообществ и мероприятий. Поля ввода остаются на месте, поэтому можно продолжать писать ответ. Чтобы увидеть изменения после редактирования кода, используй пункт **3** в меню запуска.

### 1. Проследите запрос от кнопки до базы

```mermaid
flowchart LR
    A["Форма в браузере"] -->|"fetch + JSON"| B["Маршрут FastAPI"]
    B -->|"SQL с параметрами"| C["PostgreSQL"]
    C -->|"Строки результата"| B
    B -->|"HTTP + JSON"| A
```

Откройте DevTools → Network и опубликуйте тред. В [app.js](pilot/assets/app.js) форма вызывает `POST /api/posts` с текстом. В [social.py](server/social.py) маршрут проверяет данные, берёт ID автора из сессии и вызывает `campus_api.publish_post`. Функция в [posts.sql](server/sql/posts.sql) сохраняет тред и хэштеги в одной транзакции. В ответе приходит `post_id`, по которому фронтенд открывает тред.

**Упражнение.** Ответьте на тред в сообществе. Сравните тело запроса с записью в таблице `posts` и найдите триггер `trg_reply_community` в [SQL-файле](site/sql/03_views_triggers.sql), который заполняет `community_id` ответа.

### 2. Подтвердите почту и изучите сессии

Маршрут `POST /api/auth/code` проверяет окончание адреса и отправляет шестизначный код. В `email_codes` хранится HMAC кода, срок действия 10 минут и счётчик попыток. После пяти неверных попыток нужен новый код. Повторную отправку можно запросить через минуту.

В [auth.py](server/auth.py) маршрут `POST /api/auth/register` создаёт записи в `users`, `students` и `sessions` внутри одной транзакции. Браузер получает cookie с флагом `HttpOnly`, а PostgreSQL хранит хеш токена. Запрос `GET /api/auth/me` восстанавливает вход после перезагрузки страницы. Выход удаляет сессию.

**Упражнение.** Введите неверный код и выполните запрос в pgAdmin. Затем введите правильный код и повторите запрос. Объясните, почему строка исчезла.

```sql
SELECT attempts, expires_at FROM email_codes;
SELECT user_id, username, email_verified_at FROM users ORDER BY user_id;
```

### 3. Создайте сообщество и мероприятие

1. Войдите и откройте **Сообщества → Создать сообщество**. После сохранения откроется страница сообщества, а создатель станет его администратором. PostgreSQL записывает сообщество и членство в одной транзакции. [SQL создания](server/sql/organizers.sql)
2. Для публикации мероприятий владелец сервера назначает организатора через пункт **5** в меню Windows. Затем откройте **Мероприятия → Создать мероприятие**, укажите название, место, время по Алматы и количество пропусков. [Маршрут публикации](server/events.py)
3. Участник нажимает **Получить бесплатный пропуск**. В **Мои билеты** появляется номер пропуска. База проверяет время, число мест и наличие билета у пользователя. Одновременные запросы на последнее место обрабатываются последовательно, а повторный запрос возвращает существующий билет. [SQL выдачи пропуска](server/sql/events.sql)

**Упражнение.** Создайте мероприятие с одним местом. Откройте его в двух браузерных профилях с разными аккаунтами и попробуйте взять пропуск одновременно. Затем проверьте `SELECT * FROM event_tickets;`.

Роль можно также назначить в Query Tool командой `SELECT campus_api.grant_event_organizer('имя_пользователя');`. Функция возвращает `TRUE`, если профиль найден.

#### Как выдать или снять роль модератора

1. Открой `CampusThreads.cmd` и выбери **6. Права модераторов**.
2. Выбери выдачу или снятие роли. Укажи логин Campus Threads, для сообщества также введи его точное название. Будущий модератор сообщества сначала должен вступить в него.
3. **Модератор сайта** может удалять посты и ответы по всему сайту. **Модератор или администратор сообщества** может удалять публикации внутри своего сообщества. При снятии роли модератора сообщества пользователь становится обычным участником. База проверяет права при каждом удалении. [Функции выдачи ролей и проверки прав](server/sql/moderation.sql)

Роль организатора мероприятий назначается отдельно через пункт **5**.

### 4. Проверьте пилот отдельно от учебных данных

Миграции загружают схему и справочник факультетов. Пользователи, треды, сообщества, мероприятия и билеты появляются после действий в приложении.

Существующая база в pgAdmin и хранилища учебного демо отдельны от пилота. Если в пилотной базе уже есть данные пробного прогона, остановите сервер, сделайте резервную копию через **Backup** в pgAdmin, проверьте сервер и имя базы, затем выполните [reset_pilot.sql](server/schema/reset_pilot.sql). Скрипт очистит пользовательские таблицы и каталоги мероприятий и сообществ, сохранив миграции и справочник факультетов.

```sql
SELECT current_database();
SELECT (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM posts) AS posts,
       (SELECT count(*) FROM communities) AS communities,
       (SELECT count(*) FROM events) AS events,
       (SELECT count(*) FROM event_tickets) AS tickets;
```

## Временная регистрация без письма

В локальном `.env` установи `AUTH_MODE=domain`, выполни миграции и перезапусти FastAPI. В этом режиме форма сразу создаёт аккаунт с паролем после проверки адреса `@kbtu.kz`. Правило действует и в Python, и в PostgreSQL. Для таких записей в `users` выставляется `domain_registration = TRUE`, а `email_verified_at` остаётся пустым. Любой участник может ввести чужой адрес, поэтому этот режим подходит для ограниченной пилотной группы.

Чтобы вернуть письма, настрой SMTP, измени `AUTH_MODE` на `code` и перезапусти FastAPI. Для входа в ранее созданный пилотный профиль пройди «Создать аккаунт по почте» со своим адресом и введи полученный код, прежнее имя пользователя и прежний пароль. После подтверждения откроется тот же профиль с его тредами и билетами. Аккаунты, уже подтвердившие почту, могут сразу войти по паролю.

Код формы находится в [views.js](pilot/assets/views.js), маршрут регистрации в [auth.py](server/auth.py), функции базы в [domain_registration.sql](server/sql/domain_registration.sql).

## Вход через Microsoft без письма

При `AUTH_MODE=microsoft` студент нажимает «Войти через Microsoft», выбирает свой аккаунт КБТУ и в первый раз заполняет имя пользователя, факультет и курс. При следующих входах Campus Threads узнаёт его по ID аккаунта в каталоге Microsoft. Веб-приложению нужны данные для входа, а доступ к почтовому ящику выдаётся отдельно. [Как работает вход веб-приложения через MSAL](https://learn.microsoft.com/en-us/entra/msal/python/getting-started/acquiring-tokens#acquire-token-by-authorization-code-flow)

1. В [Microsoft Entra](https://entra.microsoft.com/) зарегистрируйте **Campus Threads Sign-in** в каталоге КБТУ. Выберите **Accounts in this organizational directory only**. В **Overview** найдите **Directory (tenant) ID** и **Application (client) ID**. Если каталог ограничивает регистрацию или согласие, эти шаги выполняет ИТ КБТУ.
2. В **Authentication → Add a platform → Web** добавьте адрес `http://localhost:8000/api/auth/microsoft/callback` для локальной пробы. Для пилота используйте HTTPS-адрес своего сайта с тем же путём. [Настройка redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri)
3. В **Token configuration → Add optional claim → ID** добавьте `acct`. Это поле позволяет принять участников каталога КБТУ и отклонить гостевые аккаунты. [Настройка дополнительных полей токена](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims), [проверка участников и гостей](https://learn.microsoft.com/en-us/security/zero-trust/develop/zero-trust-token-customization)
4. В **Certificates & secrets → Client secrets → New client secret** скопируйте **Value** и сохраните в локальном `.env`. Для теста на этом компьютере используйте следующие значения. Храните секрет в `.env` или настройках секретов хостинга.

   ```dotenv
   AUTH_MODE=microsoft
   APP_ORIGIN=http://localhost:8000
   MS_LOGIN_TENANT_ID=идентификатор-каталога-КБТУ
   MS_LOGIN_CLIENT_ID=идентификатор-приложения
   MS_LOGIN_CLIENT_SECRET='значение-секрета'
   ```

5. Примените миграции и перезапустите сервер. Для входа откройте [localhost:8000](http://localhost:8000/), чтобы адрес совпал с `APP_ORIGIN`. Параметр `--no-access-log` исключит адрес callback с одноразовым параметром из журнала Uvicorn.

   ```powershell
   .\.venv\Scripts\python.exe -m server.manage migrate
   .\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --no-access-log
   ```

Если у тебя уже есть профиль Campus Threads, войди по паролю и нажми **Подключить Microsoft** в своём профиле. Выбери аккаунт КБТУ с тем же адресом. Это свяжет вход с существующим профилем и его данными. Чтобы одновременно разрешить новую регистрацию по письму, используй `AUTH_MODE=both` и настроенную почту.

Код входа находится в [microsoft.py](server/microsoft.py). Запросы к базе и привязка аккаунта описаны в [microsoft.sql](server/sql/microsoft.sql). При входе браузер получает сессию Campus Threads, а в PostgreSQL сохраняется связь профиля с идентификатором Microsoft.

## Отправка с корпоративного Outlook КБТУ

Этот режим отправляет письмо от ящика, с которым владелец вошёл в Microsoft. Бэкенд использует делегированное разрешение `Mail.Send`. Участники пилота продолжают получать обычный шестизначный код. [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)

1. В каталоге КБТУ в Microsoft Entra откройте **App registrations → New registration**, задайте имя `Campus Threads Mail` и выберите **Accounts in this organizational directory only**. С вкладки **Overview** скопируйте **Directory (tenant) ID** и **Application (client) ID**. Если университет ограничивает регистрацию приложений или выдачу согласия, эти шаги и разрешение ниже согласует ИТ КБТУ. [Регистрация приложения](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [согласие в Entra](https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience)
2. В **Authentication → Add a platform → Mobile and desktop applications** добавьте URI `http://localhost`. В **API permissions → Add a permission → Microsoft Graph → Delegated permissions** добавьте `Mail.Send`. Если автоматически появился `User.Read`, его можно удалить. [Настройка интерактивного входа MSAL](https://learn.microsoft.com/en-us/entra/msal/python/getting-started/acquiring-tokens#interactive-vs-silent)
3. Остановите FastAPI и обновите зависимости из `requirements.txt`. Замените настройки почты в локальном `.env`. Для пробы оставьте `APP_ENV=dev` и текущий `APP_ORIGIN`.

   ```dotenv
   MAIL_MODE=graph
   GRAPH_TENANT_ID=идентификатор-каталога
   GRAPH_CLIENT_ID=идентификатор-приложения
   GRAPH_SENDER=your.name@kbtu.kz
   ```

4. Выполните команды в PowerShell. Первая откроет страницу входа Microsoft. Войдите именно тем аккаунтом, который указан в `GRAPH_SENDER`. Вторая отправит пробное письмо на этот же адрес. Проверьте входящие и спам в Outlook. Статус HTTP 202 означает, что Graph принял запрос к обработке. [Как Graph обрабатывает отправку](https://learn.microsoft.com/en-us/graph/outlook-things-to-know-about-send-mail)

   ```powershell
   .\.venv\Scripts\python.exe -m server.mail authorize
   .\.venv\Scripts\python.exe -m server.mail test
   ```

5. Запустите FastAPI и проверьте кнопку «Получить код» с собственным адресом. При необходимости сверяйте причины ошибок с журналом сервера.

В [mail_graph.py](server/mail_graph.py) MSAL сохраняет данные OAuth в зашифрованном файле `.mail-auth/graph.cache` и обновляет токен при необходимости. Пароль и MFA вводятся на стороне Microsoft. Для пилота с Graph используйте один процесс Uvicorn, постоянный приватный путь `GRAPH_TOKEN_CACHE` и тот же `APP_SECRET`, с которым был создан кеш для этого окружения. Если Microsoft потребует повторного входа, остановите FastAPI, повторите `authorize` и запустите сервер. Храните кеш и `.env` вне публикации и репозитория. [Хранение токенов MSAL](https://learn.microsoft.com/en-us/entra/msal/python/advanced/msal-python-token-cache-serialization)

## Почта для неофициального пилота

Для небольшой группы можно подключить отдельный личный Gmail как отправителя. Студент указывает свой адрес `@kbtu.kz`, сервер отправляет письмо с Gmail, а студент вводит код, полученный в Outlook. Этот сценарий использует обычный SMTP и работает без регистрации в Microsoft Entra. [Настройки SMTP Gmail](https://support.google.com/mail/answer/7104828)

1. Включи двухэтапную проверку в аккаунте Gmail и создай для Campus Threads отдельный **пароль приложения**, если эта функция доступна для твоего аккаунта. [Как создать пароль приложения](https://support.google.com/accounts/answer/185833)
2. Открой локальный `.env`, замени строку `MAIL_MODE=file` и добавь настройки ниже. В `SMTP_USER` и `SMTP_FROM` подставь один и тот же адрес Gmail, а в `SMTP_PASSWORD` вставь пароль приложения без пробелов. Храни пароль только в локальном `.env` или секретах хостинга.

   ```dotenv
   AUTH_MODE=code
   MAIL_MODE=smtp
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURITY=starttls
   SMTP_USER=your.address@gmail.com
   SMTP_FROM=your.address@gmail.com
   SMTP_PASSWORD='пароль приложения'
   ```

3. Перезапусти FastAPI. Открой «Создать аккаунт по почте», введи **свой** `@kbtu.kz` и нажми «Получить код». Проверь входящие и нежелательную почту в Outlook. Так можно проверить доставку до приглашения группы. Если сайт сообщает об ошибке, посмотри журнал FastAPI. Например, SMTP `535` означает, что Gmail отклонил вход. [Ошибки Gmail SMTP](https://support.google.com/mail/answer/3726730)

## Доступ тестировщикам

На хостинге выполните миграции с пилотным `DATABASE_URL` и запустите FastAPI за HTTPS. Установите `APP_ENV=pilot`, укажите публичный HTTPS-адрес в `APP_ORIGIN` и выберите один из режимов выше. Для `AUTH_MODE=microsoft` достаточно настроек `MS_LOGIN_*` и адреса возврата. Если выбираете регистрацию по письму, настройте `MAIL_MODE=graph` или параметры SMTP, которые предоставит ИТ КБТУ. При работе за прокси настройте Uvicorn доверять заголовкам с IP только от этого прокси, чтобы лимиты учитывали IP клиента.

Перед рассылкой ссылки проверьте выбранный сценарий на собственном аккаунте КБТУ. Для регистрации по письму дополнительно проверьте доставку во входящие.

## Что положить на GitHub

Если преподавателю нужен код, создай репозиторий с видимостью **Private** и пригласи его по имени пользователя GitHub через **Settings → Collaborators**. При доступе к репозиторию преподаватель увидит файлы, добавленные в коммиты. Если для сдачи достаточно публичной страницы проекта, её можно сделать отдельным репозиторием с описанием и демонстрационными скриншотами. [Видимость репозитория](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories#about-repository-visibility), [приглашение преподавателя](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)

- **В репозиторий с кодом** добавь `server/`, `pilot/`, `site/`, `tests/`, файлы зависимостей, `CampusThreads.cmd`, `serve.py`, документацию, `.gitignore` и шаблон `.env.example`. В `server/schema/` и `site/sql/` лежат SQL-скрипты для создания структуры базы.
- **На компьютере** храни рабочий `.env`, данные и резервные копии PostgreSQL, файлы туннеля, письма из `.mailbox`, кеш токенов и локальные скриншоты. Основные пути уже указаны в `.gitignore`.

После `git add .` проверь список командой `git diff --cached --name-only` перед первым коммитом. Пользователям передавай публичную ссылку Render. [Как GitHub и Git обрабатывают игнорируемые файлы](https://docs.github.com/en/get-started/git-basics/ignoring-files)

## Проверки и учебное демо

Для интеграционных тестов создайте отдельную базу, имя которой оканчивается на `_test`. Тесты очищают её между сценариями.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:TEST_DATABASE_URL = 'postgresql://campus_app:CHANGE_ME@127.0.0.1:5432/campus_threads_test'
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_pilot.py -v
```

Исходное демо с SQL-консолью запускается командой `python serve.py` на порту 8080. Оно использует PGlite и отдельное хранилище браузера. Подробности в [учебном разборе демо](README-demo.md).

Документация к использованным механизмам. [Транзакции в Psycopg](https://www.psycopg.org/psycopg3/docs/basic/transactions.html), [параметры SQL](https://www.psycopg.org/psycopg3/docs/basic/params.html), [блокировки строк PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS).
