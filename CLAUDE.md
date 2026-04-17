# 한얼 스케줄 관리 시스템

## 아키텍처

```
GitHub Pages (index.html)  ←→  Google Apps Script (API)  ←→  Google Sheets (저장소)
                                        ↕
                                Google Calendar (양방향 동기화)
```

- **프론트엔드**: 단일 HTML (vanilla JS), GitHub Pages에서 서빙
- **백엔드**: Google Apps Script 웹앱, 모든 요청 GET 방식
- **저장소**: Google Sheets (루틴 시트 + 일정 시트)
- **캘린더**: 양방향 동기화 (루틴 → recurring event, 일정 → single event)

## 핵심 ID/URL

- **스프레드시트 ID**: `1hMfhClmRJ5edl-fmtwWytk5B8eFWMyvsKx8WkbSIqiE`
- **Apps Script 웹앱 URL**: `https://script.google.com/a/macros/somaandbody.com/s/AKfycbz23iMsMa7QiETq50kVDTj8KUtRoSzBqsZZhkDCqC7ZZmlyFjv5IqJ6E_KAKyZT3IFI/exec`
- **GitHub Pages URL**: `https://haneool.github.io/haneol-schedule/`
- **GitHub 저장소**: `https://github.com/HanEool/haneol-schedule`
- **일정 캘린더 ID**: `haneol@somaandbody.com`
- **루틴 캘린더 ID**: `c_177b6987863f353fcd46f459f0c5f7f30cd6d1bb3ee3e727fbfdf7dff2185a2d@group.calendar.google.com`

## Google Sheets 구조

**공통 규칙**: Row 1 = 시스템 정보, Row 2 = 공백, Row 3 = 헤더, Row 4~ = 데이터

### 루틴 시트 (11열)
아이디 | 이름 | 요일 | 시작시간 | 종료시간 | 캘린더ID | 수정일시 | 시작일 | 기한 | 주소 | 메모

- 요일: "월,화,목,금" 형태 (쉼표 구분)
- 시작시간/종료시간: "HH:mm" 문자열
- 시작일/기한: "yyyy-MM-dd" 또는 빈 값 (선택)
- Sheets가 시간을 Date 객체로 반환하므로 `formatTime()`, `formatDateVal()` 헬퍼로 변환 필수

### 일정 시트 (12열)
아이디 | 이름 | 날짜 | 시작시간 | 종료시간 | 캘린더ID | 수정일시 | 출처 | 루틴ID | 상태 | 주소 | 메모

- 출처: 'sheets' 또는 'calendar'
- 루틴ID: 빈 값이면 순수 일정, 값이 있으면 루틴에서 파생된 예외
- 상태: 'active', 'cancelled', 'modified'

### 케어 시트 (8열)
아이디 | 이름 | 주기(일) | 소요기간(일) | 마지막완료일 | 예정일 | 키워드 | 메모

- 주기(일): 숫자 (예: 365, 180)
- 소요기간(일): 숫자 (기본값 1, 예: 30이면 30일간 진행)
- 마지막완료일: "yyyy-MM-dd" 또는 빈 값
- 예정일: "yyyy-MM-dd" 또는 빈 값
- 키워드: 쉼표 구분 검색어 (일정 매칭용)

## API 엔드포인트 (모두 GET)

모든 쓰기 작업도 GET으로 처리 (Apps Script POST의 CORS 문제 회피).
데이터는 `data` 파라미터에 JSON 문자열로 전달.

### 읽기
- `?action=getRoutines`
- `?action=getEvents&startDate=yyyy-MM-dd&endDate=yyyy-MM-dd`
- `?action=getWeekView&date=yyyy-MM-dd`
- `?action=getCares`

### 루틴
- `?action=addRoutine&data={JSON}`
- `?action=updateRoutine&data={JSON}`
- `?action=deleteRoutine&id=routine_xxx`

### 일정
- `?action=addEvent&data={JSON}`
- `?action=updateEvent&data={JSON}`
- `?action=deleteEvent&id=event_xxx`

### 케어
- `?action=getCares`
- `?action=addCare&data={JSON}`
- `?action=updateCare&data={JSON}`
- `?action=deleteCare&id=care_xxx`

### 동기화
- `?action=syncCalendar`

## 파일 구조

```
schedule/
├── index.html        ← GitHub Pages 메인 (PWA 메타태그 포함)
├── manifest.json     ← PWA manifest
├── app-icon.png      ← 180x180 앱 아이콘
└── CLAUDE.md         ← 이 파일
```

**Apps Script 측 (별도 관리)**:
- `Code.gs` — 백엔드 전체 로직
- `Schedule.html` — Apps Script에서 직접 서빙하는 HTML (GitHub Pages와 별개)

## 디자인 시스템

Cold pastel 기반, dark/bright 모드 전환 지원.

### 색상 팔레트
- accent (라벤더): bright `#9b8abf` / dark `#b0a0d0`
- mint (일정): bright `#7cb5a0` / dark `#8ccaae`
- sky (루틴): bright `#88aec8` / dark `#94b8d4`
- rose (취소): bright `#c4929c` / dark `#d4a4ae`
- gold (변경): bright `#c4b07a` / dark `#d4c48e`

### 타이포그래피
- 제목: Nanum Myeongjo (serif)
- 본문: Noto Sans KR (sans-serif)

### 배지 규칙
- 루틴 파생 항목 → 항상 "루틴" 배지 (변경되어도 동일)
- 순수 개별 일정 → "일정" 배지
- 취소된 항목만 → "취소" 배지

## 양방향 동기화 로직

### Sheets → Calendar
- calendarEventId가 없는 행을 감지해서 Calendar에 생성
- 루틴 → recurring event (루틴 캘린더), 일정 → single event (일정 캘린더)

### Calendar → Sheets
- `updatedMin`으로 마지막 동기화 이후 변경분만 폴링
- 충돌 시 lastModified 타임스탬프 비교, 더 최근 것 우선
- 루틴의 개별 인스턴스 수정 → 일정 시트에 예외(routineId 참조)로 기록
- 루틴의 개별 인스턴스 삭제 → 일정 시트에 status='cancelled'로 기록
- 삭제 감지는 Calendar Advanced Service 필요 (`detectDeletedInstances()`)

## 주의사항

- 한국어 입력: React에서는 ref 기반 uncontrolled input 필요 (이 프로젝트는 vanilla JS라 해당 없음)
- 날짜/시간: UTC 변환 없이 로컬 시간 기준 (Asia/Seoul), `YYYY-MM-DDTHH:mm` 포맷
- Apps Script 배포: 코드 변경 시 "새 버전"으로 배포해야 반영됨
- Apps Script 접근 권한: "모든 사용자"로 설정 필요
- 폼 입력 font-size: iOS 자동 확대 방지를 위해 16px
- 저장 버튼: `isSaving` 플래그로 더블 클릭 방지
- Apps Script `initializeSheets()`: 헤더 컬럼 변경 시 실행 필요

## 현재 루틴 목록

| 이름 | 요일 | 시간 |
|------|------|------|
| 수어교실 | 화 | 19:30-21:30 |
| 화방 | 수 | 18:00-20:30 |
| 교보문고 | 월화수목금 | 09:30-12:30 |
| 스타벅스 | 월화수목금 | 07:00-09:00 |
| 힘의집 운동 | 월화목금 | 18:00-19:30 |
| 펠든크라이스 수련 | 월화목금 | 22:00-23:30 |
