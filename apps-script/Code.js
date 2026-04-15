// ============================================================
// 한얼 스케줄 관리 시스템 - Google Apps Script
// Google Sheets ↔ Google Calendar 양방향 동기화
// ============================================================

const SPREADSHEET_ID = '1hMfhClmRJ5edl-fmtwWytk5B8eFWMyvsKx8WkbSIqiE';

const CALENDAR_ID_EVENT = 'haneol@somaandbody.com';
const CALENDAR_ID_ROUTINE = 'c_177b6987863f353fcd46f459f0c5f7f30cd6d1bb3ee3e727fbfdf7dff2185a2d@group.calendar.google.com';

const SHEET_ROUTINE = '루틴';
const SHEET_EVENT = '일정';
const SHEET_CARE = '케어';
const DATA_START_ROW = 4; // Row1=시스템, Row2=공백, Row3=헤더, Row4~=데이터

// ============================================================
// 웹 API 라우팅
// ============================================================

function doGet(e) {
  const action = e.parameter.action;

  // action이 없으면 HTML 페이지 서빙
  if (!action) {
    const template = HtmlService.createTemplateFromFile('Schedule');
    template.apiUrl = ScriptApp.getService().getUrl();
    return template.evaluate()
      .setTitle('한얼 스케줄')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // action이 있으면 JSON API
  const data = e.parameter.data ? JSON.parse(e.parameter.data) : null;
  const id = e.parameter.id || null;
  let result;

  try {
    switch (action) {
      case 'getRoutines':
        result = getRoutines();
        break;
      case 'getEvents':
        result = getEvents(e.parameter.startDate, e.parameter.endDate);
        break;
      case 'getWeekView':
        result = getWeekView(e.parameter.date);
        break;
      case 'addRoutine':
        result = addRoutine(data);
        break;
      case 'updateRoutine':
        result = updateRoutine(data);
        break;
      case 'deleteRoutine':
        result = deleteRoutine(id);
        break;
      case 'addEvent':
        result = addEvent(data);
        break;
      case 'updateEvent':
        result = updateEvent(data);
        break;
      case 'deleteEvent':
        result = deleteEvent(id);
        break;
      case 'getCares':
        result = getCares();
        break;
      case 'addCare':
        result = addCare(data);
        break;
      case 'updateCare':
        result = updateCare(data);
        break;
      case 'deleteCare':
        result = deleteCare(id);
        break;
      case 'syncCalendar':
        result = fullSync();
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message, stack: err.stack };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 헬퍼 함수
// ============================================================

function getSheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}

function generateId(prefix) {
  return prefix + '_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 5);
}

function now() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm");
}

function toKSTString(date) {
  return Utilities.formatDate(date, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm");
}

function formatTime(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'HH:mm');
  return String(val);
}

function formatDateVal(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
  return String(val);
}

// 요일 매핑
const DAY_MAP = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
const DAY_MAP_REVERSE = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };
const RRULE_DAY = { '월': 'MO', '화': 'TU', '수': 'WE', '목': 'TH', '금': 'FR', '토': 'SA', '일': 'SU' };

// ============================================================
// 루틴 CRUD
// ============================================================

function getRoutines() {
  const sheet = getSheet(SHEET_ROUTINE);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const data = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 11).getValues();
  return data.filter(row => row[0] !== '').map(row => ({
    id: row[0],
    title: row[1],
    dayOfWeek: String(row[2]),
    startTime: formatTime(row[3]),
    endTime: formatTime(row[4]),
    calendarEventId: row[5],
    lastModified: row[6],
    startDate: formatDateVal(row[7]),
    endDate: formatDateVal(row[8]),
    address: row[9] || '',
    memo: row[10] || ''
  }));
}

function addRoutine(data) {
  const sheet = getSheet(SHEET_ROUTINE);
  const id = generateId('routine');
  const timestamp = now();

  // Calendar에 recurring event 생성
  const calEventId = createRecurringCalendarEvent(data, id);

  sheet.appendRow([
    id,
    data.title,
    data.dayOfWeek,
    data.startTime,
    data.endTime,
    calEventId,
    timestamp,
    data.startDate || '',
    data.endDate || '',
    data.address || '',
    data.memo || ''
  ]);

  return { success: true, id: id, calendarEventId: calEventId };
}

function updateRoutine(data) {
  const sheet = getSheet(SHEET_ROUTINE);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return { error: 'No data' };

  const ids = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === data.id) {
      const row = DATA_START_ROW + i;
      const oldCalId = sheet.getRange(row, 6).getValue();

      // Calendar 업데이트
      if (oldCalId) {
        try {
          CalendarApp.getCalendarById(CALENDAR_ID_ROUTINE).getEventById(oldCalId).deleteEvent();
        } catch (e) { /* 이미 삭제된 경우 무시 */ }
      }
      const newCalId = createRecurringCalendarEvent(data, data.id);

      sheet.getRange(row, 2, 1, 10).setValues([[
        data.title, data.dayOfWeek, data.startTime, data.endTime, newCalId, now(), data.startDate || '', data.endDate || '', data.address || '', data.memo || ''
      ]]);
      return { success: true };
    }
  }
  return { error: 'Routine not found' };
}

function deleteRoutine(id) {
  const sheet = getSheet(SHEET_ROUTINE);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return { error: 'No data' };

  const ids = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) {
      const row = DATA_START_ROW + i;
      const calId = sheet.getRange(row, 6).getValue();

      // Calendar에서 삭제
      if (calId) {
        try {
          CalendarApp.getCalendarById(CALENDAR_ID_ROUTINE).getEventById(calId).deleteEvent();
        } catch (e) { /* 무시 */ }
      }

      sheet.deleteRow(row);
      return { success: true };
    }
  }
  return { error: 'Routine not found' };
}

// ============================================================
// 일정 CRUD
// ============================================================

function getEvents(startDate, endDate) {
  const sheet = getSheet(SHEET_EVENT);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const data = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 12).getValues();
  return data.filter(row => {
    if (row[0] === '') return false;
    const rowDate = formatDateVal(row[2]);
    if (startDate && rowDate < startDate) return false;
    if (endDate && rowDate > endDate) return false;
    return true;
  }).map(row => ({
    id: row[0],
    title: row[1],
    date: formatDateVal(row[2]),
    startTime: formatTime(row[3]),
    endTime: formatTime(row[4]),
    calendarEventId: row[5],
    lastModified: row[6],
    source: row[7],
    routineId: row[8],
    status: row[9],
    address: row[10] || '',
    memo: row[11] || ''
  }));
}

function addEvent(data) {
  const sheet = getSheet(SHEET_EVENT);
  const id = generateId('event');
  const timestamp = now();

  // Calendar에 단일 이벤트 생성
  const calEventId = createSingleCalendarEvent(data);

  sheet.appendRow([
    id,
    data.title,
    data.date,
    data.startTime,
    data.endTime,
    calEventId,
    timestamp,
    'sheets',
    data.routineId || '',
    data.status || 'active',
    data.address || '',
    data.memo || ''
  ]);

  return { success: true, id: id, calendarEventId: calEventId };
}

function updateEvent(data) {
  const sheet = getSheet(SHEET_EVENT);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return { error: 'No data' };

  const ids = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === data.id) {
      const row = DATA_START_ROW + i;
      const oldCalId = sheet.getRange(row, 6).getValue();

      // Calendar 업데이트
      if (oldCalId && data.status !== 'cancelled') {
        try {
          const cal = CalendarApp.getCalendarById(CALENDAR_ID_EVENT);
          const event = cal.getEventById(oldCalId);
          if (event) {
            const start = new Date(data.date + 'T' + data.startTime + ':00');
            const end = new Date(data.date + 'T' + data.endTime + ':00');
            event.setTime(start, end);
            event.setTitle(data.title);
          }
        } catch (e) { /* 무시 */ }
      }

      sheet.getRange(row, 2, 1, 11).setValues([[
        data.title, data.date, data.startTime, data.endTime,
        oldCalId, now(), data.source || 'sheets',
        data.routineId || '', data.status || 'active',
        data.address || '', data.memo || ''
      ]]);
      return { success: true };
    }
  }
  return { error: 'Event not found' };
}

function deleteEvent(id) {
  const sheet = getSheet(SHEET_EVENT);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return { error: 'No data' };

  const ids = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) {
      const row = DATA_START_ROW + i;
      const calId = sheet.getRange(row, 6).getValue();

      if (calId) {
        try {
          CalendarApp.getCalendarById(CALENDAR_ID_EVENT).getEventById(calId).deleteEvent();
        } catch (e) { /* 무시 */ }
      }

      sheet.deleteRow(row);
      return { success: true };
    }
  }
  return { error: 'Event not found' };
}

// ============================================================
// 케어 CRUD
// ============================================================

function getCares() {
  const sheet = getSheet(SHEET_CARE);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const data = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 8).getValues();
  return data.filter(row => row[0] !== '').map(row => ({
    id: row[0],
    title: row[1],
    cycle: String(row[2]),
    duration: String(row[3] || 1),
    lastDone: formatDateVal(row[4]),
    nextDate: formatDateVal(row[5]),
    keywords: row[6] || '',
    memo: row[7] || ''
  }));
}

function addCare(data) {
  const sheet = getSheet(SHEET_CARE);
  if (!sheet) return { error: '케어 시트가 없습니다. initializeSheets()를 실행해주세요.' };
  const id = generateId('care');

  sheet.appendRow([
    id,
    data.title,
    parseInt(data.cycle),
    parseInt(data.duration) || 1,
    data.lastDone || '',
    data.nextDate || '',
    data.keywords || '',
    data.memo || ''
  ]);

  return { success: true, id: id };
}

function updateCare(data) {
  const sheet = getSheet(SHEET_CARE);
  if (!sheet) return { error: '케어 시트가 없습니다.' };
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return { error: 'No data' };

  const ids = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === data.id) {
      const row = DATA_START_ROW + i;
      sheet.getRange(row, 2, 1, 7).setValues([[
        data.title,
        parseInt(data.cycle),
        parseInt(data.duration) || 1,
        data.lastDone || '',
        data.nextDate || '',
        data.keywords || '',
        data.memo || ''
      ]]);
      return { success: true };
    }
  }
  return { error: 'Care not found' };
}

function deleteCare(id) {
  const sheet = getSheet(SHEET_CARE);
  if (!sheet) return { error: '케어 시트가 없습니다.' };
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return { error: 'No data' };

  const ids = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) {
      sheet.deleteRow(DATA_START_ROW + i);
      return { success: true };
    }
  }
  return { error: 'Care not found' };
}

// ============================================================
// Google Calendar 생성 함수
// ============================================================

function createRecurringCalendarEvent(data, routineId) {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID_ROUTINE);
  const days = data.dayOfWeek.split(',').map(d => d.trim());
  const rruleDays = days.map(d => RRULE_DAY[d]).join(',');

  // 시작일이 설정되어 있으면 해당 날짜 사용, 없으면 다음 해당 요일
  let baseDate;
  if (data.startDate) {
    baseDate = new Date(data.startDate + 'T00:00:00');
  } else {
    const today = new Date();
    const targetDay = DAY_MAP[days[0]];
    const daysUntil = (targetDay - today.getDay() + 7) % 7 || 7;
    baseDate = new Date(today);
    baseDate.setDate(today.getDate() + daysUntil);
  }

  const startParts = data.startTime.split(':');
  const endParts = data.endTime.split(':');

  const eventStart = new Date(baseDate);
  eventStart.setHours(parseInt(startParts[0]), parseInt(startParts[1]), 0);
  const eventEnd = new Date(baseDate);
  eventEnd.setHours(parseInt(endParts[0]), parseInt(endParts[1]), 0);

  const weeklyRule = CalendarApp.newRecurrence()
    .addWeeklyRule()
    .onlyOnWeekdays(days.map(d => {
      const map = {
        '월': CalendarApp.Weekday.MONDAY,
        '화': CalendarApp.Weekday.TUESDAY,
        '수': CalendarApp.Weekday.WEDNESDAY,
        '목': CalendarApp.Weekday.THURSDAY,
        '금': CalendarApp.Weekday.FRIDAY,
        '토': CalendarApp.Weekday.SATURDAY,
        '일': CalendarApp.Weekday.SUNDAY
      };
      return map[d];
    }));

  // 기한이 설정된 경우 반복 종료일 지정
  if (data.endDate) {
    const untilDate = new Date(data.endDate + 'T23:59:59');
    weeklyRule.until(untilDate);
  }

  const recurrence = weeklyRule;

  const event = cal.createEventSeries(
    data.title,
    eventStart,
    eventEnd,
    recurrence,
    { description: 'routineId:' + routineId }
  );

  return event.getId();
}

function createSingleCalendarEvent(data) {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID_EVENT);

  const start = new Date(data.date + 'T' + data.startTime + ':00');
  const end = new Date(data.date + 'T' + data.endTime + ':00');

  const event = cal.createEvent(data.title, start, end);
  return event.getId();
}

// ============================================================
// 양방향 동기화
// ============================================================

function fullSync() {
  const results = {
    sheetsToCalendar: syncSheetsToCalendar(),
    calendarToSheets: syncCalendarToSheets()
  };
  return { success: true, results: results };
}

// Sheets → Calendar: calendarEventId가 없는 행 처리
function syncSheetsToCalendar() {
  let synced = 0;

  // 루틴 동기화
  const routineSheet = getSheet(SHEET_ROUTINE);
  const routineLastRow = routineSheet.getLastRow();
  if (routineLastRow >= DATA_START_ROW) {
    const routineData = routineSheet.getRange(DATA_START_ROW, 1, routineLastRow - DATA_START_ROW + 1, 7).getValues();
    for (let i = 0; i < routineData.length; i++) {
      if (routineData[i][0] && !routineData[i][5]) {
        const data = {
          title: routineData[i][1],
          dayOfWeek: routineData[i][2],
          startTime: routineData[i][3],
          endTime: routineData[i][4]
        };
        const calId = createRecurringCalendarEvent(data, routineData[i][0]);
        routineSheet.getRange(DATA_START_ROW + i, 6).setValue(calId);
        routineSheet.getRange(DATA_START_ROW + i, 7).setValue(now());
        synced++;
      }
    }
  }

  // 일정 동기화
  const eventSheet = getSheet(SHEET_EVENT);
  const eventLastRow = eventSheet.getLastRow();
  if (eventLastRow >= DATA_START_ROW) {
    const eventData = eventSheet.getRange(DATA_START_ROW, 1, eventLastRow - DATA_START_ROW + 1, 10).getValues();
    for (let i = 0; i < eventData.length; i++) {
      if (eventData[i][0] && !eventData[i][5] && eventData[i][9] !== 'cancelled') {
        const data = {
          title: eventData[i][1],
          date: eventData[i][2],
          startTime: eventData[i][3],
          endTime: eventData[i][4]
        };
        const calId = createSingleCalendarEvent(data);
        eventSheet.getRange(DATA_START_ROW + i, 6).setValue(calId);
        eventSheet.getRange(DATA_START_ROW + i, 7).setValue(now());
        synced++;
      }
    }
  }

  return { synced: synced };
}

// Calendar → Sheets: 최근 변경분 가져오기
function syncCalendarToSheets() {
  let synced = 0;
  const props = PropertiesService.getScriptProperties();
  const lastSyncStr = props.getProperty('lastSync');
  const lastSync = lastSyncStr ? new Date(lastSyncStr) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  // 일정 캘린더에서 변경분 가져오기
  synced += syncCalendarEventsToSheet(CALENDAR_ID_EVENT, lastSync, false);

  // 루틴 캘린더에서 변경분 가져오기 (개별 인스턴스 예외 처리)
  synced += syncRoutineCalendarToSheet(CALENDAR_ID_ROUTINE, lastSync);

  props.setProperty('lastSync', new Date().toISOString());
  return { synced: synced };
}

function syncCalendarEventsToSheet(calendarId, since, isRoutine) {
  let synced = 0;
  const cal = CalendarApp.getCalendarById(calendarId);
  const now_date = new Date();
  const futureDate = new Date(now_date.getTime() + 30 * 24 * 60 * 60 * 1000); // 30일 후

  const events = cal.getEvents(since, futureDate);
  const sheet = getSheet(SHEET_EVENT);
  const lastRow = sheet.getLastRow();

  // 기존 calendarEventId 목록
  let existingCalIds = {};
  if (lastRow >= DATA_START_ROW) {
    const data = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 10).getValues();
    data.forEach((row, i) => {
      if (row[5]) existingCalIds[row[5]] = DATA_START_ROW + i;
    });
  }

  events.forEach(event => {
    const eventId = event.getId();
    const eventStart = event.getStartTime();
    const eventEnd = event.getEndTime();
    const dateStr = Utilities.formatDate(eventStart, 'Asia/Seoul', 'yyyy-MM-dd');
    const startTimeStr = Utilities.formatDate(eventStart, 'Asia/Seoul', 'HH:mm');
    const endTimeStr = Utilities.formatDate(eventEnd, 'Asia/Seoul', 'HH:mm');

    if (existingCalIds[eventId]) {
      // 기존 행 업데이트 (Calendar 쪽이 더 최근이면)
      const row = existingCalIds[eventId];
      const sheetModified = new Date(sheet.getRange(row, 7).getValue());
      const calModified = event.getLastUpdated();

      if (calModified > sheetModified) {
        sheet.getRange(row, 2, 1, 9).setValues([[
          event.getTitle(), dateStr, startTimeStr, endTimeStr,
          eventId, toKSTString(calModified), 'calendar',
          sheet.getRange(row, 9).getValue(),
          sheet.getRange(row, 10).getValue()
        ]]);
        synced++;
      }
    } else {
      // 새 이벤트 → Sheets에 추가
      const id = generateId('event');
      sheet.appendRow([
        id, event.getTitle(), dateStr, startTimeStr, endTimeStr,
        eventId, toKSTString(event.getLastUpdated()), 'calendar', '', 'active'
      ]);
      synced++;
    }
  });

  return synced;
}

function syncRoutineCalendarToSheet(calendarId, since) {
  let synced = 0;
  const cal = CalendarApp.getCalendarById(calendarId);
  const now_date = new Date();
  const futureDate = new Date(now_date.getTime() + 30 * 24 * 60 * 60 * 1000);

  const events = cal.getEvents(since, futureDate);
  const eventSheet = getSheet(SHEET_EVENT);
  const routineSheet = getSheet(SHEET_ROUTINE);

  // 루틴 매핑: calendarEventId → routineId
  const routineLastRow = routineSheet.getLastRow();
  let routineMap = {};
  if (routineLastRow >= DATA_START_ROW) {
    const routineData = routineSheet.getRange(DATA_START_ROW, 1, routineLastRow - DATA_START_ROW + 1, 7).getValues();
    routineData.forEach(row => {
      if (row[5]) routineMap[row[5]] = row[0]; // calEventId → routineId
    });
  }

  // 기존 일정시트 calendarEventId 목록
  const eventLastRow = eventSheet.getLastRow();
  let existingCalIds = {};
  if (eventLastRow >= DATA_START_ROW) {
    const data = eventSheet.getRange(DATA_START_ROW, 1, eventLastRow - DATA_START_ROW + 1, 10).getValues();
    data.forEach((row, i) => {
      if (row[5]) existingCalIds[row[5]] = DATA_START_ROW + i;
    });
  }

  events.forEach(event => {
    const eventId = event.getId();
    const desc = event.getDescription() || '';
    const routineIdMatch = desc.match(/routineId:(\S+)/);

    // recurring event의 개별 인스턴스 변경 감지
    if (routineIdMatch || event.isRecurringEvent()) {
      const parentId = event.isRecurringEvent() ? event.getId() : null;
      const routineId = routineIdMatch ? routineIdMatch[1] : (routineMap[parentId] || '');

      // 이미 일정시트에 있는지 확인
      if (!existingCalIds[eventId] && routineId) {
        // 이 인스턴스가 원래 루틴과 다른지 확인 (예외 감지)
        const eventStart = event.getStartTime();
        const eventEnd = event.getEndTime();
        const dateStr = Utilities.formatDate(eventStart, 'Asia/Seoul', 'yyyy-MM-dd');
        const startTimeStr = Utilities.formatDate(eventStart, 'Asia/Seoul', 'HH:mm');
        const endTimeStr = Utilities.formatDate(eventEnd, 'Asia/Seoul', 'HH:mm');

        // 루틴 원본과 시간이 다르면 예외로 기록
        const id = generateId('event');
        eventSheet.appendRow([
          id, event.getTitle(), dateStr, startTimeStr, endTimeStr,
          eventId, toKSTString(event.getLastUpdated()), 'calendar',
          routineId, 'modified'
        ]);
        synced++;
      }
    }
  });

  // 삭제된 인스턴스 감지 (Calendar API 한계로, 주기적 폴링 시 처리)
  // Note: Google Apps Script의 CalendarApp은 삭제된 인스턴스를 직접 감지하기 어려움
  // Calendar Advanced Service를 사용하면 가능 (아래 함수 참고)

  return synced;
}

// Calendar Advanced Service를 이용한 삭제 감지 (선택적 활성화)
function detectDeletedInstances() {
  try {
    const routineSheet = getSheet(SHEET_ROUTINE);
    const eventSheet = getSheet(SHEET_EVENT);
    const routineLastRow = routineSheet.getLastRow();
    if (routineLastRow < DATA_START_ROW) return 0;

    const routineData = routineSheet.getRange(DATA_START_ROW, 1, routineLastRow - DATA_START_ROW + 1, 7).getValues();
    let synced = 0;

    routineData.forEach(routine => {
      if (!routine[5]) return;

      const calEventId = routine[5].replace('@google.com', '');
      const now_date = new Date();
      const futureDate = new Date(now_date.getTime() + 14 * 24 * 60 * 60 * 1000);

      try {
        const instances = Calendar.Events.instances(CALENDAR_ID_ROUTINE, calEventId, {
          timeMin: now_date.toISOString(),
          timeMax: futureDate.toISOString(),
          showDeleted: true
        });

        if (instances.items) {
          instances.items.forEach(inst => {
            if (inst.status === 'cancelled') {
              const dateStr = inst.originalStartTime.dateTime
                ? inst.originalStartTime.dateTime.substring(0, 10)
                : inst.originalStartTime.date;

              // 이미 기록되어 있는지 확인
              const existingEvents = getEvents(dateStr, dateStr);
              const alreadyRecorded = existingEvents.some(e =>
                e.routineId === routine[0] && e.date === dateStr && e.status === 'cancelled'
              );

              if (!alreadyRecorded) {
                const id = generateId('event');
                const days = routine[2].split(',').map(d => d.trim());
                eventSheet.appendRow([
                  id, routine[1], dateStr, routine[3], routine[4],
                  '', now(), 'calendar', routine[0], 'cancelled'
                ]);
                synced++;
              }
            }
          });
        }
      } catch (e) {
        // Calendar Advanced Service 미활성화 시 무시
        Logger.log('Advanced Calendar not available: ' + e.message);
      }
    });

    return synced;
  } catch (e) {
    Logger.log('detectDeletedInstances error: ' + e.message);
    return 0;
  }
}

// ============================================================
// 주간 뷰 생성
// ============================================================

function getWeekView(dateStr) {
  const targetDate = dateStr ? new Date(dateStr) : new Date();
  const dayOfWeek = targetDate.getDay();
  const monday = new Date(targetDate);
  monday.setDate(targetDate.getDate() - ((dayOfWeek + 6) % 7));

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDays.push(Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'));
  }

  const startDate = weekDays[0];
  const endDate = weekDays[6];

  // 루틴에서 이번 주 일정 생성
  const routines = getRoutines();
  const events = getEvents(startDate, endDate);

  const weekItems = [];

  // 루틴 → 요일별 매핑
  routines.forEach(routine => {
    const days = routine.dayOfWeek.split(',').map(d => d.trim());
    days.forEach(day => {
      const dayIndex = DAY_MAP[day];
      const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
      const dateForDay = weekDays[adjustedIndex];

      // 시작일 이전 또는 기한 이후의 루틴은 건너뛰기
      if (routine.startDate && dateForDay < routine.startDate) return;
      if (routine.endDate && dateForDay > routine.endDate) return;

      // 이 날짜에 예외가 있는지 확인
      const exception = events.find(e =>
        e.routineId === routine.id && e.date === dateForDay
      );

      if (exception) {
        weekItems.push({
          ...exception,
          isException: true,
          originalRoutine: routine
        });
      } else {
        weekItems.push({
          id: routine.id + '_' + dateForDay,
          title: routine.title,
          date: dateForDay,
          startTime: routine.startTime,
          endTime: routine.endTime,
          status: 'active',
          routineId: routine.id,
          isRoutine: true
        });
      }
    });
  });

  // 순수 개별 일정 추가
  events.filter(e => !e.routineId).forEach(e => {
    weekItems.push({ ...e, isEvent: true });
  });

  // 날짜 + 시간 순 정렬
  weekItems.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });

  return {
    weekStart: startDate,
    weekEnd: endDate,
    items: weekItems
  };
}

// ============================================================
// 시간 기반 자동 동기화 트리거 설정
// ============================================================

function setupSyncTrigger() {
  // 기존 트리거 제거
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 10분마다 실행
  ScriptApp.newTrigger('autoSync')
    .timeBased()
    .everyMinutes(10)
    .create();

  return { success: true, message: '10분 간격 자동 동기화 트리거 설정됨' };
}

function autoSync() {
  try {
    fullSync();
    detectDeletedInstances();
  } catch (e) {
    Logger.log('Auto sync error: ' + e.message);
  }
}

// ============================================================
// 초기 설정: 시트 헤더 생성
// ============================================================

function initializeSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 루틴 시트
  let routineSheet = ss.getSheetByName(SHEET_ROUTINE);
  if (!routineSheet) {
    routineSheet = ss.insertSheet(SHEET_ROUTINE);
  }
  routineSheet.getRange(1, 1).setValue('한얼 스케줄 관리 시스템 - 루틴');
  routineSheet.getRange(3, 1, 1, 11).setValues([[
    '아이디', '이름', '요일', '시작시간', '종료시간', '캘린더ID', '수정일시', '시작일', '기한', '주소', '메모'
  ]]);

  // 일정 시트
  let eventSheet = ss.getSheetByName(SHEET_EVENT);
  if (!eventSheet) {
    eventSheet = ss.insertSheet(SHEET_EVENT);
  }
  eventSheet.getRange(1, 1).setValue('한얼 스케줄 관리 시스템 - 일정');
  eventSheet.getRange(3, 1, 1, 12).setValues([[
    '아이디', '이름', '날짜', '시작시간', '종료시간', '캘린더ID', '수정일시', '출처', '루틴ID', '상태', '주소', '메모'
  ]]);

  // 케어 시트
  let careSheet = ss.getSheetByName(SHEET_CARE);
  if (!careSheet) {
    careSheet = ss.insertSheet(SHEET_CARE);
  }
  careSheet.getRange(1, 1).setValue('한얼 스케줄 관리 시스템 - 케어');
  careSheet.getRange(3, 1, 1, 8).setValues([[
    '아이디', '이름', '주기(일)', '소요기간(일)', '마지막완료일', '예정일', '키워드', '메모'
  ]]);

  return { success: true, message: '시트 초기화 완료' };
}