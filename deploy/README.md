# 배포 (deploy.sh)

서버 = 오라클 A1(`ssh stockllm`), 앞단 Caddy, 컨테이너 1개. DB 는 `data/sponavi.db` 한 파일이
컨테이너에 **단일 파일 바인드마운트(:ro)** 로 물려 있다.

## 두 가지 모드

| 명령 | 하는 일 | 언제 |
|---|---|---|
| `bash deploy/deploy.sh` | 코드만. `--exclude 'data/sponavi.db*'` 로 **서버 DB 를 건드리지 않는다** | 평소 전부 |
| `bash deploy/deploy.sh --with-db` | 코드 + `data/sponavi.db` **본체 1개** 푸시 | 아래 경우만 |

`--with-db` 를 쓰는 경우는 셋뿐이다.

1. DB 스키마 마이그레이션·재적재 직후(예: `migrate_facility_gb.py`, videos 재적재).
2. 새 서버/빈 호스트 첫 배포 — 서버에 `data/sponavi.db` 가 없으면 도커가 마운트 지점에
   **디렉터리**를 만들어버려 컨테이너가 깨진다. 첫 배포는 반드시 `--with-db`.
3. **9/17 프리즈 직전 마지막 1회** — 이때 찍힌 지문이 심사 기간 내내 정본이 된다.

## FREEZE.sha 규약 (결정 OV7)

- 지문 = `scripts/db_fingerprint.sh` = **이름에 `cache` 가 든 테이블을 뺀 `.dump` 의 sha256**.
  파일 해시가 아니다(VACUUM·페이지 배치·mtime 으로 바이트가 달라진다). `fitness_ai_cache` 는
  로컬에서 pytest 를 돌릴 때마다 커지므로 지문에서 뺀다.
- **정본은 프로덕션이다.** `--with-db` 배포가 끝나면 deploy.sh 가 지문을 *서버에서* 계산해
  `data/FREEZE.sha`(로컬)와 `~/sponavi/data/FREEZE.sha`(서버) 양쪽에 적고 화면에 찍는다.
  로컬 `data/FREEZE.sha` 는 **커밋해 둔다** — 다음 배포부터 자동 대조된다.
- 기본 배포는 rsync 전에 서버 지문을 재서 `data/FREEZE.sha` 와 대조한다.
  - 같으면 그냥 진행. 다르면 둘 다 찍고 `[y/N]` 로 묻는다(비대화형 셸이면 중단).
  - 불일치 = "프리즈 이후 서버 DB 가 바뀌었다" 또는 "FREEZE.sha 가 낡았다" 는 뜻이다.
    무엇이 맞는지 사람이 판단해라. 기본 배포 자체는 DB 를 덮어쓰지 않는다.
  - `data/FREEZE.sha` 가 없으면 조용히 건너뛴다(프리즈 전 기간).
- 서버에 `sqlite3` 가 필요하다. 없으면 지문을 못 재고 대조를 건너뛴다(경고만):
  `ssh stockllm 'sudo apt-get install -y sqlite3'`

## -shm / -wal 은 절대 올리지 않는다

`data/sponavi.db-shm`·`-wal` 은 **그 순간의 본체 파일과 짝**(솔트·체크섬)이다. 따로 복사해
서버에 붙이면 SQLite 가 남의 WAL 을 되감아 DB 를 깨뜨리거나 유령 데이터를 읽는다.
그래서 `--with-db` 도 본체 1개만 보내고, 보내기 전에 `PRAGMA wal_checkpoint(TRUNCATE)` 로
WAL 을 본체에 접어넣는다. 기본 배포의 `--exclude 'data/sponavi.db*'` 는 셋 다 막는다
(`--delete` 는 제외된 파일을 지우지 않으므로 서버 DB 는 그대로 살아 있다).

## 알아둘 것

- `--with-db` 스모크는 `/api/health` 의 `data_built` 가 **푸시 전후로 바뀌었는지** 확인하고,
  안 바뀌었으면 시끄럽게 실패한다(= 새 DB 가 컨테이너에 안 물렸다는 신호).
- `scripts/refresh_data.sh`(월간 갱신)는 자체적으로 DB 를 rsync 한다 — **FREEZE.sha 를 갱신하지
  않는다.** 프리즈 이후에 refresh 를 돌렸다면, 이어서 `deploy.sh --with-db` 를 한 번 돌려
  지문을 다시 찍어라. 안 그러면 다음 배포마다 불일치 프롬프트가 뜬다.
- 지문만 따로 보고 싶을 때: `bash scripts/db_fingerprint.sh data/sponavi.db`

## 업타임 프로브 (W3)

- `scripts/uptime_probe.sh` — `https://sponavi.kro.kr/api/health`를 10초 타임아웃으로 찌르고 `~/Library/Logs/sponavi-uptime.log`에 1줄 기록. 연속 실패 3회째(≈15분)와 이후 1시간마다 macOS 알림, 복구 시 알림 1회.
- 설치(도메인·HTTPS 살아난 뒤): `cp deploy/com.sponavi.uptime.plist ~/Library/LaunchAgents/ && launchctl load -w ~/Library/LaunchAgents/com.sponavi.uptime.plist`
- 한계: 맥이 잠들면 공백. 심사 기간(10월)엔 무료 외부 핑거(5분 HTTP 모니터) 1개를 추가로 두는 안이 Reviewer Concern 2로 남아 있음 — 도입 여부는 W3 말에 결정.

## FREEZE.sha 는 서버에서만 계산한다 (2026-08-28)
`.dump` 텍스트는 sqlite3 버전(서버 3.37 / 맥 3.51)에 따라 달라서 **로컬 지문 ≠ 서버 지문**이 정상이다. 대조는 항상 "서버 현재 지문 vs FREEZE.sha(서버에서 기록)"로만 한다. 내용 동일성은 테이블별 행수 비교로 확인했다(11개 테이블 일치). 지문 계산 전 `quick_check` 게이트가 있어 손상 DB 는 지문 단계에서 실패한다.
