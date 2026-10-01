/**
 * parser.js — Надежный движок парсинга Excel-расписания ФИиИТ
 * Обрабатывает листы "1неделя" и "2неделя", координатную сетку курсов и групп,
 * а также гибридный разбор ячеек пар на дисциплину, преподавателя, тип и аудиторию.
 */

const ScheduleParser = (function () {
  'use strict';

  // Дни недели по порядку
  const DAYS_ORDER = [
    'Понедельник',
    'Вторник',
    'Среда',
    'Четверг',
    'Пятница',
    'Суббота'
  ];

  // Регулярные выражения для разбора ячейки пары
  const PATTERNS = {
    // Подгруппы
    subgroupBoth: /1\s*,\s*2\s*п[\/\.]?г/i,
    subgroup: /(?:^|\s|\()([12])\s*п[\/\.]?г\)?/i,
    subgroupAlt: /(?:^|\s|\()([12])\s*подгруппа\)?/i,

    // Аудитории: 2.10, 4.16, 2.48, 1.17 ФТФ, 308 ЭФ, 3.90 ФМиКН, ВЦ, ПО, МИЦ, спортзал, планет
    roomEnd: /(\d+\.\d+(?:,\s*\d+\.\d+)?(?:\s+(?:ВЦ|ПО|МИЦ|спортзал|планет|ФТФ|ФМиКН|ЭФ))?|\d+\s+[А-ЯЁа-яё]+|(?:ВЦ|ПО|МИЦ|спортзал|планет|ФТФ|ФМиКН))\s*$/i,
    roomAnywhere: /\b(\d+\.\d+)\b/,

    // Преподаватель (Фамилия И.О. с поддержкой дефисов)
    teacher: /([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.(?:[А-ЯЁ]|\.|[-–])*\.?)/,

    // Тип занятия (лк, лек, лаб, пр, сем, л/р, практ)
    lessonType: /(?:^|\s)(лек|лк|лаб|пр|сем|л\/р|практ)(?:\.|\s|$)/i
  };

  /**
   * Нормализация названия дня недели
   */
  function normalizeDay(text) {
    if (!text || typeof text !== 'string') return '';
    const clean = text.trim();
    for (const d of DAYS_ORDER) {
      if (clean.toLowerCase().includes(d.toLowerCase())) {
        return d;
      }
    }
    return '';
  }

  /**
   * Гибридный парсинг содержимого ячейки пары
   * @param {string} rawText Исходный текст ячейки
   * @returns {Array<Object>} Массив подгрупп/занятий
   */
  function parsePairCell(rawText) {
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return [];
    }

    const cleanRaw = rawText.trim();
    // Разбиваем строку по ";"
    const rawSegments = cleanRaw
      .split(';')
      .map(s => s.trim().replace(/^;+|;+$/g, '').trim())
      .filter(Boolean);

    if (rawSegments.length === 0) return [];

    const subgroups = [];
    let prevSubject = '';
    let prevType = '';

    for (let i = 0; i < rawSegments.length; i++) {
      let segment = rawSegments[i].trim();
      let subGroupNum = null;

      // 1. Определение метки подгруппы: 1п/г, 2п/г, 1,2 п/г
      if (PATTERNS.subgroupBoth.test(segment)) {
        subGroupNum = null;
        segment = segment.replace(PATTERNS.subgroupBoth, ' ').trim();
      } else {
        const sgMatch = segment.match(PATTERNS.subgroup) || segment.match(PATTERNS.subgroupAlt);
        if (sgMatch) {
          subGroupNum = parseInt(sgMatch[1], 10);
          segment = segment.replace(PATTERNS.subgroup, ' ').replace(PATTERNS.subgroupAlt, ' ').trim();
        } else if (rawSegments.length > 1 && i === 1 && subgroups[0]?.subGroupNum === 1) {
          // Если 1-й сегмент был для 1 п/г, а у 2-го метки нет — логически это 2 п/г
          subGroupNum = 2;
        }
      }

      // 2. Выделение аудитории
      let room = '';
      const roomMatch = segment.match(PATTERNS.roomEnd);
      if (roomMatch) {
        room = roomMatch[1].trim();
        segment = segment.slice(0, roomMatch.index).trim();
      } else {
        const roomMatch2 = segment.match(PATTERNS.roomAnywhere);
        if (roomMatch2) {
          room = roomMatch2[1].trim();
          segment = (segment.slice(0, roomMatch2.index) + ' ' + segment.slice(roomMatch2.index + roomMatch2[0].length)).trim();
        }
      }

      // 3. Выделение преподавателя
      let teacher = '';
      const teacherMatch = segment.match(PATTERNS.teacher);
      if (teacherMatch) {
        teacher = teacherMatch[1].trim().replace(/\.+$/, '') + '.';
        segment = (segment.slice(0, teacherMatch.index) + ' ' + segment.slice(teacherMatch.index + teacherMatch[0].length)).trim();
      }

      // 4. Выделение типа занятия
      let type = '';
      const typeMatch = segment.match(PATTERNS.lessonType);
      if (typeMatch) {
        const rawType = typeMatch[1].toLowerCase();
        if (rawType === 'лек' || rawType === 'лк') type = 'лек';
        else if (rawType === 'лаб' || rawType === 'л/р') type = 'лаб';
        else if (rawType === 'пр' || rawType === 'сем' || rawType === 'практ') type = 'пр';
        else type = rawType;
        segment = (segment.slice(0, typeMatch.index) + ' ' + segment.slice(typeMatch.index + typeMatch[0].length)).trim();
      }

      // 5. Название дисциплины (оставшаяся часть строки)
      let subject = segment
        .replace(/\s+/g, ' ')
        .replace(/^[\s,;.:-]+|[\s,;.:-]+$/g, '')
        .trim();

      // Наследование предмета и типа при делении лабораторных по преподавателям
      if (!subject && prevSubject) {
        subject = prevSubject;
        if (!type && prevType) type = prevType;
      }

      // ОТКАЗОУСТОЙЧИВОСТЬ (Fallback):
      if (!subject && !teacher && !room) {
        subject = rawSegments[i];
      }

      if (subject) {
        prevSubject = subject;
        prevType = type;
      }

      subgroups.push({
        subGroupNum: subGroupNum,
        subject: subject || cleanRaw,
        type: type,
        teacher: teacher,
        room: room
      });
    }

    return subgroups;
  }

  /**
   * Обнаружение курсов и их колоночных диапазонов (Строка 5, индекс 4)
   * @param {Array<string>} row4 Данные 5-й строки (индекс 4)
   * @returns {Array<Object>} Список курсов с границами колонок
   */
  function detectCourses(row4) {
    const courses = [];
    for (let c = 0; c < row4.length; c++) {
      const val = String(row4[c] || '').trim();
      const match = val.match(/([1-4])\s*КУРС/i);
      if (match) {
        courses.push({
          num: parseInt(match[1], 10),
          name: `${match[1]} КУРС`,
          colStart: c,
          colEnd: row4.length
        });
      }
    }

    // Сортируем по возрастанию начальной колонки
    courses.sort((a, b) => a.colStart - b.colStart);

    // Устанавливаем правую границу каждого курса
    for (let i = 0; i < courses.length; i++) {
      if (i < courses.length - 1) {
        let end = courses[i + 1].colStart;
        // Проверяем служебные колонки (день, №) перед следующим курсом
        for (let c = courses[i + 1].colStart - 1; c > courses[i].colStart; c--) {
          const header = String(row4[c] || '').trim().toLowerCase();
          if (header === 'день' || header === 'время' || header === '№' || header === 'номер') {
            end = c;
          } else {
            break;
          }
        }
        courses[i].colEnd = end;
      } else {
        courses[i].colEnd = row4.length;
      }
    }

    return courses;
  }

  /**
   * Парсинг одного листа расписания
   * @param {Array<Array<any>>} sheetData Данные листа в виде 2D массива
   * @param {string} weekName Имя недели ("1неделя" или "2неделя")
   * @returns {Object} Объект курсов и групп для этой недели
   */
  function parseSheetData(sheetData, weekName) {
    if (!sheetData || sheetData.length < 8) {
      return {};
    }

    const row4 = sheetData[4] || []; // Строка 5 (курсы)
    const row5 = sheetData[5] || []; // Строка 6 (направления)
    const row6 = sheetData[6] || []; // Строка 7 (группы)

    const courses = detectCourses(row4);
    const resultCourses = {};

    // Стандартные интервалы времени
    const DEFAULT_TIMES = {
      1: '08.30-10.05',
      2: '10.15-11.50',
      3: '12.20-13.55',
      4: '14.10-15.20',
      5: '15.30-16.40',
      6: '16.50-17.40'
    };

    for (const course of courses) {
      const courseName = course.name;
      resultCourses[courseName] = { groups: {} };

      // Определение колонок дня, номера пары и времени для курса
      let dayCol = 0;
      let pnumCol = 2;
      let timeCol = 1;

      if (course.num > 1) {
        // Ищем служебные колонки непосредственно перед блоком курса
        for (let c = course.colStart - 1; c >= Math.max(0, course.colStart - 6); c--) {
          const val = String(row4[c] || '').trim().toLowerCase();
          if (val === 'день') {
            dayCol = c;
          } else if (val === '№' || val === 'номер') {
            pnumCol = c;
          } else if (val === 'время') {
            timeCol = c;
          }
        }
      }

      // Поиск групп (Строка 7, индекс 6) только в диапазоне колонок курса
      const groups = [];
      for (let c = course.colStart; c < course.colEnd; c++) {
        const val = String(row6[c] || '').trim();
        if (val) {
          const groupName = val.trim().toUpperCase();
          const directionName = String(row5[c] || '').trim();
          groups.push({
            col: c,
            name: groupName,
            direction: directionName
          });

          if (!resultCourses[courseName].groups[groupName]) {
            resultCourses[courseName].groups[groupName] = [];
          }
        }
      }

      // Если в 7-й строке группы не найдены, проверяем 6-ю строку
      if (groups.length === 0) {
        for (let c = course.colStart; c < course.colEnd; c++) {
          const val = String(row5[c] || '').trim();
          if (val && !val.match(/КУРС|ПЕРВАЯ|ВТОРАЯ/i)) {
            const groupName = val.trim().toUpperCase();
            groups.push({ col: c, name: groupName, direction: '' });
            if (!resultCourses[courseName].groups[groupName]) {
              resultCourses[courseName].groups[groupName] = [];
            }
          }
        }
      }

      // Парсинг строк занятий (начиная со строки 8, индекс 7)
      let currentDay = '';

      for (let r = 7; r < sheetData.length; r++) {
        const row = sheetData[r];
        if (!row || row.every(cell => !cell || String(cell).trim() === '')) {
          continue;
        }

        // Значение дня недели (с Forward Fill)
        let dayVal = String(row[dayCol] || '').trim();
        if (!dayVal && dayCol !== 0 && row[0]) {
          dayVal = String(row[0]).trim();
        }
        const normalizedDay = normalizeDay(dayVal);
        if (normalizedDay) {
          currentDay = normalizedDay;
        }

        // Номер пары
        let pnumVal = String(row[pnumCol] || '').trim();
        if (!pnumVal && pnumCol !== 2 && row[2]) {
          pnumVal = String(row[2]).trim();
        }
        let pairNum = parseInt(pnumVal, 10);
        if (isNaN(pairNum) || pairNum <= 0) {
          continue;
        }

        // Время пары
        let timeVal = String(row[timeCol] || '').trim();
        if (!timeVal && row[1]) {
          timeVal = String(row[1]).trim();
        }
        if (!timeVal && DEFAULT_TIMES[pairNum]) {
          timeVal = DEFAULT_TIMES[pairNum];
        }

        if (!currentDay) continue;

        // Считываем ячейки для каждой группы курса
        for (const g of groups) {
          const cellContent = String(row[g.col] || '').trim();
          if (cellContent) {
            const parsedSubgroups = parsePairCell(cellContent);

            resultCourses[courseName].groups[g.name].push({
              week: weekName,
              day: currentDay,
              pairNum: pairNum,
              time: timeVal,
              subgroups: parsedSubgroups,
              rawText: cellContent,
              direction: g.direction
            });
          }
        }
      }
    }

    return resultCourses;
  }

  /**
   * Парсинг всей книги Excel (SheetJS Workbook)
   * @param {Object} workbook Объект книги SheetJS
   * @returns {Object} Структура { courses: { [courseName]: { groups: { [groupName]: [pairs] } } } }
   */
  function parseWorkbook(workbook) {
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Файл не содержит листов для чтения.');
    }

    const allCourses = {};

    // Поиск листов 1 и 2 недели
    const sheetMap = {};
    for (const name of workbook.SheetNames) {
      const clean = name.trim().toLowerCase().replace(/\s+/g, '');
      if (clean.includes('1недел') || clean === '1' || clean.includes('первая')) {
        sheetMap['1неделя'] = name;
      } else if (clean.includes('2недел') || clean === '2' || clean.includes('вторая')) {
        sheetMap['2неделя'] = name;
      }
    }

    // Если стандартные имена не нашлись, берем первые два листа
    if (!sheetMap['1неделя'] && workbook.SheetNames[0]) {
      sheetMap['1неделя'] = workbook.SheetNames[0];
    }
    if (!sheetMap['2неделя'] && workbook.SheetNames[1]) {
      sheetMap['2неделя'] = workbook.SheetNames[1];
    }

    // Обработка каждой недели
    for (const [targetWeekKey, actualSheetName] of Object.entries(sheetMap)) {
      const sheet = workbook.Sheets[actualSheetName];
      if (!sheet) continue;

      // Преобразуем лист в 2D массив строк
      const sheetData = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        blankrows: false
      });

      const parsedWeekCourses = parseSheetData(sheetData, targetWeekKey);

      // Сливаем данные недель в единую структуру
      for (const [cName, cObj] of Object.entries(parsedWeekCourses)) {
        if (!allCourses[cName]) {
          allCourses[cName] = { groups: {} };
        }
        for (const [gName, pairs] of Object.entries(cObj.groups)) {
          if (!allCourses[cName].groups[gName]) {
            allCourses[cName].groups[gName] = [];
          }
          allCourses[cName].groups[gName].push(...pairs);
        }
      }
    }

    return { courses: allCourses };
  }

  return {
    parsePairCell,
    detectCourses,
    parseSheetData,
    parseWorkbook
  };
})();

// Поддержка Node.js и браузера
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScheduleParser;
}
