# 확정 엔드포인트 명세 (2026-07-20 실호출 검증)

베이스: `https://apis.data.go.kr/B551014/{service}/{operation}`
공통 파라미터: `serviceKey`(Decoding), `pageNo`, `numOfRows`(최대 확인 필요), `resultType=json`
응답: `{"response":{"header":{resultCode,resultMsg},"body":{pageNo,totalCount,items:{item:[...]}}}}`

| 용도 | service | operation | totalCount(실측) | 비고 |
|---|---|---|---|---|
| 이용권 등록시설 | SRVC_OD_API_FACIL_MNG | `todz_api_facil_mng_i` | 28,772 | **소문자** 주의. 필드: city_cd/nm, main_event_cd/nm, pres_nm, faci_daddr… 좌표 없음 |
| 이용권 등록강좌 | SRVC_OD_API_FACIL_COURSE | `todz_api_facil_course_i` | 66,685 | **소문자**. facil_sn, lectr_nm, item_cd/nm, start_tm… |
| 장애인 등록시설 | SRVC_OD_API_FACIL_MNG_DVOUCHER | `TODZ_API_MNG_DVOUCHER_I` | 8,919 | 대문자. road_addr, city_cd/nm, local_nm… |
| 장애인 등록강좌 | SRVC_DVOUCHER_FACI_COURSE | `TODZ_DVOUCHER_FACI_COURSE` | 23,229 | start_time, dspsn_ty_nm(장애유형)… |
| 전국체육시설 | SRVC_API_SFMS_FACI | `TODZ_API_SFMS_FACI` | 152,788 | addr_ctpv_nm, nation_yn… **좌표 필드 확인 필요(faci_lat/lot)** |
| 운동 동영상 | SRVC_TODZ_VDO_PKG | `TODZ_VDO_FTNS_CERT_I` | 426 | file_url, vdo_desc, resolution… (이 서비스에 오퍼레이션 더 있는지 확인) |
| 측정결과(선택) | SRVC_NFA_TEST_RESULT | `TODZ_NFA_TEST_RESULT_NEW` | 타임아웃 | 291만건 — 긴 타임아웃/작은 페이지로 재시도 |

- 키는 `.env`의 `DATA_GO_KR_KEY` (89자, Decoding). 개발계정 일 10,000건.
- 발견 방법: data.go.kr 상세페이지 HTML 내 임베디드 swagger `"paths"` 추출 + 실호출 검증.
