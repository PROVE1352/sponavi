-- ============================================================
-- 되나요 (Doenayo) DB 스키마 — MySQL 8.0 버전
-- MVP는 SQLite로 동작하나, 프로덕션 이관용 MySQL DDL.
-- 조인 허브 = sigungu_cd (행정표준 시군구 5자리). utf8mb4/InnoDB.
-- 생성: 2026-07-20
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. sigungu — 전국 시군구 (코드·명·좌표 폴백)
--    voucher/dvoucher 시설의 local_cd/local_nm 합집합 + public 좌표 평균으로 구축
-- ------------------------------------------------------------
CREATE TABLE `sigungu` (
  `cd`        CHAR(5)      NOT NULL COMMENT '행정표준 시군구코드 5자리 (예: 11290 성북구)',
  `nm`        VARCHAR(40)  NOT NULL COMMENT '시군구명',
  `sido_cd`   CHAR(2)      NOT NULL COMMENT '시도코드 2자리 (11=서울)',
  `sido_nm`   VARCHAR(20)  NULL     COMMENT '시도명',
  `lat`       DECIMAL(10,7) NULL    COMMENT '중심 위도(좌표 없는 시설 폴백용)',
  `lon`       DECIMAL(10,7) NULL    COMMENT '중심 경도',
  PRIMARY KEY (`cd`),
  KEY `idx_sigungu_sido` (`sido_cd`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='전국 시군구 마스터';

-- ------------------------------------------------------------
-- 2. facilities — 시설 (이용권 가맹·장애인 가맹·공공체육)
--    source: voucher(15107783) | dvoucher(15107874) | public(15113986)
-- ------------------------------------------------------------
CREATE TABLE `facilities` (
  `id`                  BIGINT       NOT NULL AUTO_INCREMENT,
  `source`              ENUM('voucher','dvoucher','public') NOT NULL COMMENT '데이터 출처',
  `name`                VARCHAR(200) NOT NULL COMMENT '시설명',
  `sido_cd`             CHAR(2)      NULL,
  `sigungu_cd`          CHAR(5)      NULL     COMMENT 'FK→sigungu.cd (voucher/dvoucher=local_cd, public=명 매핑)',
  `sigungu_nm`          VARCHAR(40)  NULL,
  `addr`                VARCHAR(300) NULL     COMMENT '도로명 주소',
  `lat`                 DECIMAL(10,7) NULL    COMMENT 'public=실좌표, 그외=시군구 폴백',
  `lon`                 DECIMAL(10,7) NULL,
  `sports`              VARCHAR(500) NULL     COMMENT '종목 콤마목록 (시설 주종목 + 소속 강좌 종목 합집합)',
  `disability_support`  TINYINT(1)   NULL     COMMENT '1=장애인 지원, 0=아님, NULL=미상',
  `brno`                VARCHAR(20)  NULL     COMMENT '사업자등록번호 (강좌 조인키)',
  `facil_sn`            VARCHAR(20)  NULL     COMMENT '시설일련번호 (이용권 강좌 조인키)',
  `status`              VARCHAR(20)  NULL     COMMENT '영업상태 (폐업 제외 적재)',
  `phone`               VARCHAR(30)  NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fac_sigungu`  (`sigungu_cd`),
  KEY `idx_fac_source`   (`source`),
  KEY `idx_fac_geo`      (`lat`,`lon`),
  KEY `idx_fac_join`     (`brno`,`facil_sn`),
  CONSTRAINT `fk_fac_sigungu` FOREIGN KEY (`sigungu_cd`) REFERENCES `sigungu`(`cd`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='시설 통합(이용권·장애인·공공)';

-- ------------------------------------------------------------
-- 3. courses — 강좌 (이용권 등록강좌 15107784 · 장애인 등록강좌 15117341)
-- ------------------------------------------------------------
CREATE TABLE `courses` (
  `id`                BIGINT       NOT NULL AUTO_INCREMENT,
  `facility_id`       BIGINT       NULL     COMMENT 'FK→facilities.id (brno[+facil_sn] 매칭)',
  `source`            ENUM('voucher','dvoucher') NOT NULL,
  `name`              VARCHAR(200) NOT NULL COMMENT '강좌명',
  `sport`             VARCHAR(60)  NULL     COMMENT '종목',
  `fee_month`         INT          NULL     COMMENT '월 수강료(원). 0=무료',
  `weekday_mask`      CHAR(7)      NULL     COMMENT '요일마스크 월화수목금토일 (예: 1111100)',
  `start_tm`          CHAR(5)      NULL     COMMENT 'HH:MM',
  `end_tm`            CHAR(5)      NULL,
  `target`            VARCHAR(30)  NULL     COMMENT '유아|청소년|성인|어르신|장애인|전연령',
  `disability_types`  VARCHAR(120) NULL     COMMENT '장애유형 콤마목록 (dvoucher만)',
  PRIMARY KEY (`id`),
  KEY `idx_crs_facility` (`facility_id`),
  KEY `idx_crs_sport`    (`sport`),
  CONSTRAINT `fk_crs_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='강좌';

-- ------------------------------------------------------------
-- 4. coverage — 이용권 수급 통계 (지역별스포츠강좌이용권활용정보)
--    자격자(target) 대비 실수령(recipient) = 사각지대 크기. 서울 15구 실측.
-- ------------------------------------------------------------
CREATE TABLE `coverage` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `sigungu_cd`  CHAR(5)      NOT NULL COMMENT 'FK→sigungu.cd',
  `sigungu_nm`  VARCHAR(40)  NULL,
  `class`       ENUM('기초수급','차상위·한부모') NOT NULL COMMENT 'S / N',
  `target`      INT          NOT NULL COMMENT '자격 대상 인원',
  `recipient`   INT          NOT NULL COMMENT '실제 수령 인원',
  `pop`         INT          NULL     COMMENT '시군구 인구',
  `facil_cnt`   INT          NULL     COMMENT '시군구 가맹시설 수',
  `year`        SMALLINT     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cov` (`sigungu_cd`,`class`,`year`),
  KEY `idx_cov_sigungu` (`sigungu_cd`),
  CONSTRAINT `fk_cov_sigungu` FOREIGN KEY (`sigungu_cd`) REFERENCES `sigungu`(`cd`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='이용권 자격 대비 수급 통계(사각지대)';

-- ------------------------------------------------------------
-- 5. measurement_item — 국민체력100 측정항목 카탈로그 (AI 운동추천용)
--    "측정해야 하는 것들 전부"의 마스터. 연령군별 적용 + 체력요인 분류.
-- ------------------------------------------------------------
CREATE TABLE `measurement_item` (
  `code`          VARCHAR(20)  NOT NULL COMMENT '항목코드 (예: f001 신장, f012 앉아윗몸앞으로굽히기)',
  `name`          VARCHAR(80)  NOT NULL COMMENT '항목명',
  `unit`          VARCHAR(20)  NULL     COMMENT '단위(cm·kg·회·초·mmHg·%)',
  `factor`        ENUM('신체구성','근력','근지구력','심폐지구력','유연성','순발력','민첩성','평형성','협응력','기타') NOT NULL COMMENT '체력요인',
  `age_groups`    SET('유아','청소년','성인','어르신') NOT NULL COMMENT '측정 대상 연령군',
  `higher_better` TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1=높을수록 좋음, 0=낮을수록 좋음(예: 왕복달리기 시간)',
  `sort_order`    SMALLINT     NULL,
  PRIMARY KEY (`code`),
  KEY `idx_mi_factor` (`factor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='국민체력100 측정항목 카탈로그(AI 처방 입력 정의)';

-- ------------------------------------------------------------
-- 6. fitness_norm — 연령·성별 기준표 (등급 판정용, 선택)
--    공식 기준표 확보 시 채움. 미확보면 '데모 기준' 라벨로 근사.
-- ------------------------------------------------------------
CREATE TABLE `fitness_norm` (
  `id`         INT         NOT NULL AUTO_INCREMENT,
  `item_code`  VARCHAR(20) NOT NULL COMMENT 'FK→measurement_item.code',
  `sex`        ENUM('M','F') NOT NULL,
  `age_min`    TINYINT     NOT NULL,
  `age_max`    TINYINT     NOT NULL,
  `p20`        DECIMAL(8,2) NULL COMMENT '하위20% 경계',
  `p50`        DECIMAL(8,2) NULL COMMENT '중앙값',
  `p80`        DECIMAL(8,2) NULL COMMENT '상위20% 경계',
  `source`     VARCHAR(120) NULL COMMENT '기준표 출처(공식/데모)',
  PRIMARY KEY (`id`),
  KEY `idx_norm_lookup` (`item_code`,`sex`,`age_min`,`age_max`),
  CONSTRAINT `fk_norm_item` FOREIGN KEY (`item_code`) REFERENCES `measurement_item`(`code`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='연령·성별 체력 기준표';

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 대표 쿼리 (서버 store 레이어)
-- ============================================================
-- (1) 근처 이용권 가맹시설 + 강좌·수강료
-- SELECT f.*, c.name AS course, c.fee_month
--   FROM facilities f LEFT JOIN courses c ON c.facility_id=f.id
--   WHERE f.sigungu_cd=? AND f.source='voucher';
--
-- (2) 공급공백 판정 (장애인 가맹 0개?)
-- SELECT COUNT(*) FROM facilities WHERE sigungu_cd=? AND source='dvoucher';
--
-- (3) 사각지대 커버리지 (자격 대비 수령률)
-- SELECT class, target, recipient, recipient/target AS rate
--   FROM coverage WHERE sigungu_cd=? AND year=2025;
--
-- (4) AI 처방 입력 — 사용자가 채운 측정항목 + 요인 분류
-- SELECT code, name, unit, factor, higher_better
--   FROM measurement_item WHERE FIND_IN_SET(?, age_groups);
