/* Ядро учебного симулятора C2000 (TMS320F2837xD, модуль ePWM1)
 * - схема регистров и доступ к ним из пользовательского кода
 * - транслятор подмножества C в JavaScript
 * - тактовая модель ePWM (TB, CC, AQ, DB, TZ, ET), PIE, ядра C28x
 * - стойка инвертора с R-L нагрузкой
 */
var C2K = (function () {
  'use strict';

  var BASE_HZ = 100e6;                 // шаг модели = EPWMCLK после InitSysCtrl
  var DT = 1 / BASE_HZ;
  var WD_TICKS = Math.round(13.1072e-3 * BASE_HZ); // 512*256 тактов INTOSC1 10 МГц

  /* ------------------------------------------------------------ */
  /* Схема регистров                                              */
  /* ------------------------------------------------------------ */
  var RW = 0, RO = 1;
  function F(name, lsb, width, acc, en) { return { name: name, lsb: lsb, width: width, acc: acc || RW, en: en || null }; }
  function seq(prefix, n, width, from) {
    var a = [];
    for (var k = 0; k < n; k++) a.push(F(prefix + (k + (from === undefined ? 1 : from)), k * width, width));
    return a;
  }
  var AQF = [F('ZRO', 0, 2, RW, 'AQ'), F('PRD', 2, 2, RW, 'AQ'), F('CAU', 4, 2, RW, 'AQ'), F('CAD', 6, 2, RW, 'AQ'), F('CBU', 8, 2, RW, 'AQ'), F('CBD', 10, 2, RW, 'AQ')];

  var ENUMS = {
    CTRMODE: ['TB_COUNT_UP', 'TB_COUNT_DOWN', 'TB_COUNT_UPDOWN', 'TB_FREEZE'],
    PHSEN: ['TB_DISABLE', 'TB_ENABLE'],
    PRDLD: ['TB_SHADOW', 'TB_IMMEDIATE'],
    HSPCLKDIV: ['TB_DIV1, /1', 'TB_DIV2, /2', 'TB_DIV4, /4', '/6', '/8', '/10', '/12', '/14'],
    CLKDIV: ['TB_DIV1, /1', 'TB_DIV2, /2', 'TB_DIV4, /4', '/8', '/16', '/32', '/64', '/128'],
    LOADMODE: ['CC_CTR_ZERO', 'CC_CTR_PRD', 'CC_CTR_ZERO_PRD', 'CC_LD_DISABLE'],
    SHDWMODE: ['CC_SHADOW', 'CC_IMMEDIATE'],
    AQ: ['AQ_NO_ACTION', 'AQ_CLEAR', 'AQ_SET', 'AQ_TOGGLE'],
    OUT_MODE: ['DB_DISABLE', 'DBB_ENABLE', 'DBA_ENABLE', 'DB_FULL_ENABLE'],
    POLSEL: ['DB_ACTV_HI', 'DB_ACTV_LOC', 'DB_ACTV_HIC', 'DB_ACTV_LO'],
    IN_MODE: ['DBA_ALL', 'DBB_RED_DBA_FED', 'DBA_RED_DBB_FED', 'DBB_ALL'],
    TZ: ['TZ_HIZ', 'TZ_FORCE_HI', 'TZ_FORCE_LO', 'TZ_NO_CHANGE'],
    INTSEL: ['не выбрано', 'ET_CTR_ZERO', 'ET_CTR_PRD', 'ET_CTR_PRDZERO', 'ET_CTRU_CMPA', 'ET_CTRD_CMPA', 'ET_CTRU_CMPB', 'ET_CTRD_CMPB'],
    INTPRD: ['ET_DISABLE', 'ET_1ST', 'ET_2ND', 'ET_3RD'],
    MUX: ['GPIO', 'периферия 1 (EPWM)', 'периферия 2', 'периферия 3'],
    DCEVT: ['событие запрещено', 'DCxH = 0', 'DCxH = 1', 'DCxL = 0', 'DCxL = 1', 'DCxL = 1 и DCxH = 0', '-', '-'],
    DCSEL: ['TRIPIN1 (TZ1)', 'TRIPIN2 (TZ2)', 'TRIPIN3 (TZ3)', 'TRIPIN4', 'TRIPIN5', 'TRIPIN6', 'TRIPIN7', 'TRIPIN8', 'TRIPIN9', 'TRIPIN10', 'TRIPIN11', 'TRIPIN12', '-', 'TRIPIN14', 'TRIPIN15', 'комбинация'],
    CTRIP: ['асинхронный выход', 'синхронный выход', 'выход фильтра', 'выход фильтра с защелкой'],
    CMPSRC: ['ЦАП', 'внешний вывод'],
    XBARMUX: ['вход 0', 'вход 1', 'вход 2', 'вход 3']
  };

  var gpioMux = [];
  for (var g0 = 0; g0 < 16; g0++) gpioMux.push(F('GPIO' + g0, g0 * 2, 2, RW, 'MUX'));
  var gpioMux2 = [];
  for (var g1 = 0; g1 < 16; g1++) gpioMux2.push(F('GPIO' + (g1 + 16), g1 * 2, 2));

  var SCHEMA = {
    EPwm1Regs: {
      title: 'ePWM1', clock: { reg: 'PCLKCR2', bit: 0, name: 'ePWM1 (CpuSysRegs.PCLKCR2.bit.EPWM1 = 0)' }, regs: {
        TBCTL: { w: 16, reset: 0x0083, doc: 'Управление счетчиком', f: [F('CTRMODE', 0, 2, RW, 'CTRMODE'), F('PHSEN', 2, 1, RW, 'PHSEN'), F('PRDLD', 3, 1, RW, 'PRDLD'), F('SYNCOSEL', 4, 2), F('SWFSYNC', 6, 1), F('HSPCLKDIV', 7, 3, RW, 'HSPCLKDIV'), F('CLKDIV', 10, 3, RW, 'CLKDIV'), F('PHSDIR', 13, 1), F('FREE_SOFT', 14, 2)] },
        TBCTR: { w: 16, reset: 0, plain: true, doc: 'Счетчик' },
        TBPRD: { w: 16, reset: 0, plain: true, doc: 'Период, теневой' },
        TBPHS: { w: 32, reset: 0, doc: 'Фаза счетчика при синхронизации', f: [F('TBPHSHR', 0, 16), F('TBPHS', 16, 16)] },
        CMPCTL: { w: 16, reset: 0, doc: 'Управление сравнением', f: [F('LOADAMODE', 0, 2, RW, 'LOADMODE'), F('LOADBMODE', 2, 2, RW, 'LOADMODE'), F('SHDWAMODE', 4, 1, RW, 'SHDWMODE'), F('SHDWBMODE', 6, 1, RW, 'SHDWMODE'), F('SHDWAFULL', 8, 1, RO), F('SHDWBFULL', 9, 1, RO)] },
        CMPA: { w: 32, reset: 0, doc: 'Уставка сравнения A, теневая', f: [F('CMPAHR', 0, 16), F('CMPA', 16, 16)] },
        AQCTLA: { w: 16, reset: 0, doc: 'Формирование выхода A', f: AQF },
        AQCTLB: { w: 16, reset: 0, doc: 'Формирование выхода B', f: AQF },
        DBCTL: { w: 16, reset: 0, doc: 'Мертвое время', f: [F('OUT_MODE', 0, 2, RW, 'OUT_MODE'), F('POLSEL', 2, 2, RW, 'POLSEL'), F('IN_MODE', 4, 2, RW, 'IN_MODE'), F('LOADREDMODE', 6, 2), F('LOADFEDMODE', 8, 2), F('SHDWDBREDMODE', 10, 1), F('SHDWDBFEDMODE', 11, 1), F('OUTSWAP', 12, 2), F('DEDB_MODE', 14, 1), F('HALFCYCLE', 15, 1)] },
        DBRED: { w: 16, reset: 0, doc: 'Задержка фронта', f: [F('DBRED', 0, 14)] },
        DBFED: { w: 16, reset: 0, doc: 'Задержка спада', f: [F('DBFED', 0, 14)] },
        TZCTL: { w: 16, reset: 0, prot: true, doc: 'Действие при аварии', f: [F('TZA', 0, 2, RW, 'TZ'), F('TZB', 2, 2, RW, 'TZ'), F('DCAEVT1', 4, 2, RW, 'TZ'), F('DCAEVT2', 6, 2, RW, 'TZ'), F('DCBEVT1', 8, 2, RW, 'TZ'), F('DCBEVT2', 10, 2, RW, 'TZ')] },
        TZSEL: { w: 16, reset: 0, prot: true, doc: 'Источники аварии', f: [F('CBC1', 0, 1), F('CBC2', 1, 1), F('CBC3', 2, 1), F('CBC4', 3, 1), F('CBC5', 4, 1), F('CBC6', 5, 1), F('DCAEVT2', 6, 1), F('DCBEVT2', 7, 1), F('OSHT1', 8, 1), F('OSHT2', 9, 1), F('OSHT3', 10, 1), F('OSHT4', 11, 1), F('OSHT5', 12, 1), F('OSHT6', 13, 1), F('DCAEVT1', 14, 1), F('DCBEVT1', 15, 1)] },
        TZFLG: { w: 16, reset: 0, ro: true, doc: 'Флаги аварии', f: [F('INT', 0, 1, RO), F('CBC', 1, 1, RO), F('OST', 2, 1, RO), F('DCAEVT1', 3, 1, RO), F('DCAEVT2', 4, 1, RO), F('DCBEVT1', 5, 1, RO), F('DCBEVT2', 6, 1, RO)] },
        TZCLR: { w: 16, reset: 0, prot: true, wo: true, doc: 'Сброс флагов аварии', f: [F('INT', 0, 1), F('CBC', 1, 1), F('OST', 2, 1), F('DCAEVT1', 3, 1), F('DCAEVT2', 4, 1), F('DCBEVT1', 5, 1), F('DCBEVT2', 6, 1)] },
        TZFRC: { w: 16, reset: 0, prot: true, wo: true, doc: 'Программная авария', f: [F('CBC', 1, 1), F('OST', 2, 1)] },
        TZOSTFLG: { w: 16, reset: 0, ro: true, doc: 'Источники однократного отключения', f: seq('OST', 6, 1).concat([F('DCAEVT1', 6, 1, RO), F('DCBEVT1', 7, 1, RO)]).map(function (x) { x.acc = RO; return x; }) },
        TZOSTCLR: { w: 16, reset: 0, prot: true, wo: true, doc: 'Сброс флагов источников однократного отключения', f: seq('OST', 6, 1).concat([F('DCAEVT1', 6, 1), F('DCBEVT1', 7, 1)]) },
        TZCBCFLG: { w: 16, reset: 0, ro: true, doc: 'Источники циклического отключения', f: seq('CBC', 6, 1).concat([F('DCAEVT2', 6, 1, RO), F('DCBEVT2', 7, 1, RO)]).map(function (x) { x.acc = RO; return x; }) },
        TZCBCCLR: { w: 16, reset: 0, prot: true, wo: true, doc: 'Сброс флагов источников циклического отключения', f: seq('CBC', 6, 1).concat([F('DCAEVT2', 6, 1), F('DCBEVT2', 7, 1)]) },
        TZDCSEL: { w: 16, reset: 0, prot: true, doc: 'Условия событий цифрового сравнения', f: [F('DCAEVT1', 0, 3, RW, 'DCEVT'), F('DCAEVT2', 3, 3, RW, 'DCEVT'), F('DCBEVT1', 6, 3, RW, 'DCEVT'), F('DCBEVT2', 9, 3, RW, 'DCEVT')] },
        DCTRIPSEL: { w: 16, reset: 0, prot: true, doc: 'Входы цифрового сравнения', f: [F('DCAHCOMPSEL', 0, 4, RW, 'DCSEL'), F('DCALCOMPSEL', 4, 4, RW, 'DCSEL'), F('DCBHCOMPSEL', 8, 4, RW, 'DCSEL'), F('DCBLCOMPSEL', 12, 4, RW, 'DCSEL')] },
        DCACTL: { w: 16, reset: 0, prot: true, doc: 'Событие DCAEVT1, DCAEVT2', f: [F('EVT1SRCSEL', 0, 1), F('EVT1FRCSYNCSEL', 1, 1), F('EVT1SOCE', 2, 1), F('EVT1SYNCE', 3, 1), F('EVT2SRCSEL', 8, 1), F('EVT2FRCSYNCSEL', 9, 1)] },
        DCBCTL: { w: 16, reset: 0, prot: true, doc: 'Событие DCBEVT1, DCBEVT2', f: [F('EVT1SRCSEL', 0, 1), F('EVT1FRCSYNCSEL', 1, 1), F('EVT1SOCE', 2, 1), F('EVT1SYNCE', 3, 1), F('EVT2SRCSEL', 8, 1), F('EVT2FRCSYNCSEL', 9, 1)] },
        ETSEL: { w: 16, reset: 0, doc: 'Выбор событий', f: [F('INTSEL', 0, 3, RW, 'INTSEL'), F('INTEN', 3, 1), F('SOCASEL', 8, 3, RW, 'INTSEL'), F('SOCAEN', 11, 1), F('SOCBSEL', 12, 3, RW, 'INTSEL'), F('SOCBEN', 15, 1)] },
        ETPS: { w: 16, reset: 0, doc: 'Делитель событий', f: [F('INTPRD', 0, 2, RW, 'INTPRD'), F('INTCNT', 2, 2, RO), F('SOCAPRD', 8, 2), F('SOCACNT', 10, 2, RO), F('SOCBPRD', 12, 2), F('SOCBCNT', 14, 2, RO)] },
        ETFLG: { w: 16, reset: 0, ro: true, doc: 'Флаги событий', f: [F('INT', 0, 1, RO), F('SOCA', 2, 1, RO), F('SOCB', 3, 1, RO)] },
        ETCLR: { w: 16, reset: 0, wo: true, doc: 'Сброс флагов событий', f: [F('INT', 0, 1), F('SOCA', 2, 1), F('SOCB', 3, 1)] }
      }
    },
    CpuSysRegs: {
      title: 'Тактирование', prot: true, regs: {
        PCLKCR0: { w: 32, reset: 0, doc: 'Такт периферии 0', f: [F('CLA1', 0, 1), F('DMA', 2, 1), F('CPUTIMER0', 3, 1), F('CPUTIMER1', 4, 1), F('CPUTIMER2', 5, 1), F('HRPWM', 16, 1), F('TBCLKSYNC', 18, 1), F('GTBCLKSYNC', 19, 1)] },
        PCLKCR2: { w: 32, reset: 0, doc: 'Такт модулей ePWM', f: seq('EPWM', 12, 1) },
        PCLKCR4: { w: 32, reset: 0, doc: 'Такт модулей eQEP', f: [F('EQEP1', 0, 1), F('EQEP2', 1, 1), F('EQEP3', 2, 1)] },
        PCLKCR13: { w: 32, reset: 0, doc: 'Такт модулей АЦП', f: [F('ADC_A', 0, 1), F('ADC_B', 1, 1), F('ADC_C', 2, 1), F('ADC_D', 3, 1)] },
        PCLKCR14: { w: 32, reset: 0, doc: 'Такт компараторов CMPSS', f: seq('CMPSS', 8, 1) }
      }
    },
    GpioCtrlRegs: {
      title: 'GPIO', prot: true, regs: {
        GPAMUX1: { w: 32, reset: 0, doc: 'Функции выводов 0..15', f: gpioMux },
        GPAMUX2: { w: 32, reset: 0, doc: 'Функции выводов 16..31', f: gpioMux2 },
        GPAGMUX2: { w: 32, reset: 0, doc: 'Группа функций выводов 16..31', f: gpioMux2 },
        GPAQSEL2: { w: 32, reset: 0, doc: 'Квалификация входов 16..31', f: gpioMux2 },
        GPADIR: { w: 32, reset: 0, doc: 'Направление: 1 - выход', f: seq('GPIO', 32, 1, 0) },
        GPAPUD: { w: 32, reset: 0xFFFFFFFF, doc: 'Отключение подтяжки', f: seq('GPIO', 32, 1, 0) }
      }
    },
    InputXbarRegs: {
      title: 'Input X-BAR', prot: true, regs: {
        INPUT1SELECT: { w: 16, reset: 0, plain: true, doc: 'Вывод GPIO для INPUT1 (TZ1)' },
        INPUT2SELECT: { w: 16, reset: 0, plain: true, doc: 'Вывод GPIO для INPUT2 (TZ2)' },
        INPUT3SELECT: { w: 16, reset: 0, plain: true, doc: 'Вывод GPIO для INPUT3 (TZ3)' }
      }
    },
    AdcaRegs: {
      title: 'АЦП A', clock: { reg: 'PCLKCR13', bit: 0, name: 'АЦП A (CpuSysRegs.PCLKCR13.bit.ADC_A = 0)' }, regs: {
        ADCCTL1: { w: 16, reset: 0, prot: true, doc: 'Управление 1', f: [F('INTPULSEPOS', 2, 1), F('ADCPWDNZ', 7, 1), F('ADCBSYCHN', 8, 4, RO), F('ADCBSY', 13, 1, RO)] },
        ADCCTL2: { w: 16, reset: 0, prot: true, doc: 'Управление 2', f: [F('PRESCALE', 0, 4), F('RESOLUTION', 6, 1), F('SIGNALMODE', 7, 1)] },
        ADCINTFLG: { w: 16, reset: 0, ro: true, doc: 'Флаги прерываний', f: [F('ADCINT1', 0, 1, RO), F('ADCINT2', 1, 1, RO), F('ADCINT3', 2, 1, RO), F('ADCINT4', 3, 1, RO)] },
        ADCINTFLGCLR: { w: 16, reset: 0, wo: true, doc: 'Сброс флагов прерываний', f: [F('ADCINT1', 0, 1), F('ADCINT2', 1, 1), F('ADCINT3', 2, 1), F('ADCINT4', 3, 1)] },
        ADCINTOVF: { w: 16, reset: 0, ro: true, doc: 'Переполнение прерываний', f: [F('ADCINT1', 0, 1, RO), F('ADCINT2', 1, 1, RO), F('ADCINT3', 2, 1, RO), F('ADCINT4', 3, 1, RO)] },
        ADCINTOVFCLR: { w: 16, reset: 0, wo: true, doc: 'Сброс переполнения', f: [F('ADCINT1', 0, 1), F('ADCINT2', 1, 1), F('ADCINT3', 2, 1), F('ADCINT4', 3, 1)] },
        ADCINTSEL1N2: { w: 16, reset: 0, prot: true, doc: 'Источники ADCINT1, ADCINT2', f: [F('INT1SEL', 0, 4), F('INT1E', 5, 1), F('INT1CONT', 6, 1), F('INT2SEL', 8, 4), F('INT2E', 13, 1), F('INT2CONT', 14, 1)] },
        ADCSOCFRC1: { w: 16, reset: 0, wo: true, doc: 'Программный запуск', f: seq('SOC', 16, 1, 0) },
        ADCSOC0CTL: { w: 32, reset: 0, prot: true, doc: 'Настройка SOC0', f: [F('ACQPS', 0, 9), F('CHSEL', 15, 4), F('TRIGSEL', 20, 5)] },
        ADCSOC1CTL: { w: 32, reset: 0, prot: true, doc: 'Настройка SOC1', f: [F('ACQPS', 0, 9), F('CHSEL', 15, 4), F('TRIGSEL', 20, 5)] },
        ADCSOC2CTL: { w: 32, reset: 0, prot: true, doc: 'Настройка SOC2', f: [F('ACQPS', 0, 9), F('CHSEL', 15, 4), F('TRIGSEL', 20, 5)] },
        ADCSOC3CTL: { w: 32, reset: 0, prot: true, doc: 'Настройка SOC3', f: [F('ACQPS', 0, 9), F('CHSEL', 15, 4), F('TRIGSEL', 20, 5)] }
      }
    },
    AdcaResultRegs: {
      title: 'Результаты АЦП A', regs: {
        ADCRESULT0: { w: 16, reset: 0, plain: true, ro: true, doc: 'Результат SOC0' },
        ADCRESULT1: { w: 16, reset: 0, plain: true, ro: true, doc: 'Результат SOC1' },
        ADCRESULT2: { w: 16, reset: 0, plain: true, ro: true, doc: 'Результат SOC2' },
        ADCRESULT3: { w: 16, reset: 0, plain: true, ro: true, doc: 'Результат SOC3' }
      }
    },
    EQep1Regs: {
      title: 'eQEP1', clock: { reg: 'PCLKCR4', bit: 0, name: 'eQEP1 (CpuSysRegs.PCLKCR4.bit.EQEP1 = 0)' }, regs: {
        QPOSCNT: { w: 32, reset: 0, plain: true, doc: 'Счетчик положения' },
        QPOSINIT: { w: 32, reset: 0, plain: true, doc: 'Начальное значение счетчика положения' },
        QPOSMAX: { w: 32, reset: 0, plain: true, doc: 'Наибольшее значение счетчика положения' },
        QPOSCMP: { w: 32, reset: 0, plain: true, doc: 'Уставка сравнения положения' },
        QPOSILAT: { w: 32, reset: 0, plain: true, ro: true, doc: 'Положение, защелкнутое по метке' },
        QPOSSLAT: { w: 32, reset: 0, plain: true, ro: true, doc: 'Положение, защелкнутое по стробу' },
        QPOSLAT: { w: 32, reset: 0, plain: true, ro: true, doc: 'Положение, защелкнутое по таймеру' },
        QUTMR: { w: 32, reset: 0, plain: true, doc: 'Таймер интервала (SYSCLK)' },
        QUPRD: { w: 32, reset: 0, plain: true, doc: 'Период таймера интервала' },
        QWDTMR: { w: 16, reset: 0, plain: true, doc: 'Сторожевой таймер' },
        QWDPRD: { w: 16, reset: 0, plain: true, doc: 'Период сторожевого таймера' },
        QDECCTL: { w: 16, reset: 0, doc: 'Декодер квадратурных сигналов', f: [F('QSP', 5, 1), F('QIP', 6, 1), F('QBP', 7, 1), F('QAP', 8, 1), F('IGATE', 9, 1), F('SWAP', 10, 1), F('XCR', 11, 1), F('SPSEL', 12, 1), F('SOEN', 13, 1), F('QSRC', 14, 2)] },
        QEPCTL: { w: 16, reset: 0, doc: 'Управление eQEP', f: [F('WDE', 0, 1), F('UTE', 1, 1), F('QCLM', 2, 1), F('QPEN', 3, 1), F('IEL', 4, 2), F('SEL', 6, 1), F('SWI', 7, 1), F('IEI', 8, 2), F('SEI', 10, 2), F('PCRM', 12, 2), F('FREE_SOFT', 14, 2)] },
        QCAPCTL: { w: 16, reset: 0, doc: 'Блок захвата', f: [F('UPPS', 0, 4), F('CCPS', 4, 3), F('CEN', 15, 1)] },
        QPOSCTL: { w: 16, reset: 0, doc: 'Сравнение положения', f: [F('PCSPW', 0, 12), F('PCE', 12, 1), F('PCPOL', 13, 1), F('PCLOAD', 14, 1), F('PCSHDW', 15, 1)] },
        QEINT: { w: 16, reset: 0, doc: 'Разрешение прерываний', f: [F('PCE', 1, 1), F('QPE', 2, 1), F('QDC', 3, 1), F('WTO', 4, 1), F('PCU', 5, 1), F('PCO', 6, 1), F('PCR', 7, 1), F('PCM', 8, 1), F('SEL', 9, 1), F('IEL', 10, 1), F('UTO', 11, 1)] },
        QFLG: { w: 16, reset: 0, ro: true, doc: 'Флаги прерываний', f: [F('INT', 0, 1, RO)].concat([F('PCE', 1, 1, RO), F('QPE', 2, 1, RO), F('QDC', 3, 1, RO), F('WTO', 4, 1, RO), F('PCU', 5, 1, RO), F('PCO', 6, 1, RO), F('PCR', 7, 1, RO), F('PCM', 8, 1, RO), F('SEL', 9, 1, RO), F('IEL', 10, 1, RO), F('UTO', 11, 1, RO)]) },
        QCLR: { w: 16, reset: 0, wo: true, doc: 'Сброс флагов', f: [F('INT', 0, 1)].concat([F('PCE', 1, 1), F('QPE', 2, 1), F('QDC', 3, 1), F('WTO', 4, 1), F('PCU', 5, 1), F('PCO', 6, 1), F('PCR', 7, 1), F('PCM', 8, 1), F('SEL', 9, 1), F('IEL', 10, 1), F('UTO', 11, 1)]) },
        QFRC: { w: 16, reset: 0, wo: true, doc: 'Программная установка флагов', f: [F('PCE', 1, 1), F('QPE', 2, 1), F('QDC', 3, 1), F('WTO', 4, 1), F('PCU', 5, 1), F('PCO', 6, 1), F('PCR', 7, 1), F('PCM', 8, 1), F('SEL', 9, 1), F('IEL', 10, 1), F('UTO', 11, 1)] },
        QEPSTS: { w: 16, reset: 0, doc: 'Состояние (биты UPEVNT, COEF, CDEF, FIMF сбрасываются записью 1)', f: [F('PCEF', 0, 1, RO), F('FIMF', 1, 1), F('CDEF', 2, 1), F('COEF', 3, 1), F('QDLF', 4, 1, RO), F('QDF', 5, 1, RO), F('FIDF', 6, 1, RO), F('UPEVNT', 7, 1)] },
        QCTMR: { w: 16, reset: 0, plain: true, doc: 'Таймер захвата' },
        QCPRD: { w: 16, reset: 0, plain: true, doc: 'Период захвата' },
        QCTMRLAT: { w: 16, reset: 0, plain: true, ro: true, doc: 'Таймер захвата, защелка' },
        QCPRDLAT: { w: 16, reset: 0, plain: true, ro: true, doc: 'Период захвата, защелка' }
      }
    },
    PieCtrlRegs: {
      title: 'PIE', regs: {
        PIECTRL: { w: 16, reset: 0, doc: 'Управление PIE', f: [F('ENPIE', 0, 1), F('PIEVECT', 1, 15, RO)] },
        PIEACK: { w: 16, reset: 0, w1c: true, doc: 'Подтверждение групп', f: seq('ACK', 12, 1) },
        PIEIER1: { w: 16, reset: 0, doc: 'Разрешения группы 1', f: seq('INTx', 16, 1) },
        PIEIFR1: { w: 16, reset: 0, doc: 'Флаги группы 1', f: seq('INTx', 16, 1) },
        PIEIER3: { w: 16, reset: 0, doc: 'Разрешения группы 3', f: seq('INTx', 16, 1) },
        PIEIFR3: { w: 16, reset: 0, doc: 'Флаги группы 3', f: seq('INTx', 16, 1) },
        PIEIER5: { w: 16, reset: 0, doc: 'Разрешения группы 5', f: seq('INTx', 16, 1) },
        PIEIFR5: { w: 16, reset: 0, doc: 'Флаги группы 5', f: seq('INTx', 16, 1) }
      }
    }
  };

  // компараторы CMPSS1..CMPSS8 и ePWM X-BAR
  (function () {
    for (var k = 1; k <= 8; k++) {
      var filt = function () { return [F('SAMPWIN', 4, 5), F('THRESH', 9, 5), F('FILINIT', 15, 1)]; };
      SCHEMA['Cmpss' + k + 'Regs'] = { title: 'CMPSS' + k, clock: { reg: 'PCLKCR14', bit: k - 1, name: 'CMPSS' + k + ' (CpuSysRegs.PCLKCR14.bit.CMPSS' + k + ' = 0)' }, regs: {
        COMPCTL: { w: 16, reset: 0, prot: true, doc: 'Управление компараторами', f: [F('COMPHSOURCE', 0, 1, RW, 'CMPSRC'), F('COMPHINV', 1, 1), F('CTRIPHSEL', 2, 2, RW, 'CTRIP'), F('CTRIPOUTHSEL', 4, 2, RW, 'CTRIP'), F('ASYNCHEN', 6, 1), F('COMPLSOURCE', 8, 1, RW, 'CMPSRC'), F('COMPLINV', 9, 1), F('CTRIPLSEL', 10, 2, RW, 'CTRIP'), F('CTRIPOUTLSEL', 12, 2, RW, 'CTRIP'), F('ASYNCLEN', 14, 1), F('COMPDACE', 15, 1)] },
        COMPHYSCTL: { w: 16, reset: 0, prot: true, doc: 'Гистерезис', f: [F('COMPHYS', 0, 3)] },
        COMPSTS: { w: 16, reset: 0, ro: true, doc: 'Состояние', f: [F('COMPHSTS', 0, 1, RO), F('COMPHLATCH', 1, 1, RO), F('COMPLSTS', 8, 1, RO), F('COMPLLATCH', 9, 1, RO)] },
        COMPSTSCLR: { w: 16, reset: 0, prot: true, wo: true, doc: 'Сброс защелок', f: [F('HLATCHCLR', 1, 1), F('HSYNCCLREN', 2, 1), F('LLATCHCLR', 9, 1), F('LSYNCCLREN', 10, 1)] },
        COMPDACCTL: { w: 16, reset: 0, prot: true, doc: 'Управление ЦАП', f: [F('DACSOURCE', 0, 1), F('RAMPSOURCE', 1, 4), F('SELREF', 5, 1), F('RAMPLOADSEL', 6, 1), F('SWLOADSEL', 7, 1), F('FREESOFT', 14, 2)] },
        DACHVALS: { w: 16, reset: 0, doc: 'Код ЦАП верхнего компаратора, теневой', f: [F('DACVAL', 0, 12)] },
        DACHVALA: { w: 16, reset: 0, ro: true, doc: 'Код ЦАП верхнего компаратора, действующий', f: [F('DACVAL', 0, 12, RO)] },
        DACLVALS: { w: 16, reset: 0, doc: 'Код ЦАП нижнего компаратора, теневой', f: [F('DACVAL', 0, 12)] },
        DACLVALA: { w: 16, reset: 0, ro: true, doc: 'Код ЦАП нижнего компаратора, действующий', f: [F('DACVAL', 0, 12, RO)] },
        CTRIPHFILCTL: { w: 16, reset: 0, prot: true, doc: 'Цифровой фильтр верхнего компаратора', f: filt() },
        CTRIPHFILCLKCTL: { w: 16, reset: 0, prot: true, doc: 'Делитель частоты фильтра верхнего компаратора', f: [F('CLKPRESCALE', 0, 10)] },
        CTRIPLFILCTL: { w: 16, reset: 0, prot: true, doc: 'Цифровой фильтр нижнего компаратора', f: filt() },
        CTRIPLFILCLKCTL: { w: 16, reset: 0, prot: true, doc: 'Делитель частоты фильтра нижнего компаратора', f: [F('CLKPRESCALE', 0, 10)] }
      } };
    }
    var xr = {}, trips = [4, 5, 7, 8, 9, 10, 11, 12];
    trips.forEach(function (t) {
      var lo = [], hi = [], en = [];
      for (var m = 0; m < 16; m++) { lo.push(F('MUX' + m, 2 * m, 2, RW, 'XBARMUX')); hi.push(F('MUX' + (m + 16), 2 * m, 2, RW, 'XBARMUX')); }
      for (var e = 0; e < 32; e++) en.push(F('MUX' + e, e, 1));
      xr['TRIP' + t + 'MUX0TO15CFG'] = { w: 32, reset: 0, doc: 'TRIP' + t + ': выбор входов мультиплексоров 0..15', f: lo };
      xr['TRIP' + t + 'MUX16TO31CFG'] = { w: 32, reset: 0, doc: 'TRIP' + t + ': выбор входов мультиплексоров 16..31', f: hi };
    });
    trips.forEach(function (t) { var en = []; for (var e = 0; e < 32; e++) en.push(F('MUX' + e, e, 1)); xr['TRIP' + t + 'MUXENABLE'] = { w: 32, reset: 0, doc: 'TRIP' + t + ': разрешение мультиплексоров', f: en }; });
    xr.TRIPOUTINV = { w: 32, reset: 0, doc: 'Инверсия выходов TRIP', f: trips.map(function (t, i) { return F('TRIP' + t, i, 1); }) };
    SCHEMA.EPwmXbarRegs = { title: 'ePWM X-BAR', prot: true, regs: xr };
  })();

  // модули ePWM2, ePWM3 - копии описания ePWM1
  var NMOD = 3;
  (function () {
    var src = SCHEMA.EPwm1Regs.regs;
    for (var n = 2; n <= NMOD; n++) {
      var regs = {};
      Object.keys(src).forEach(function (r) { var d = src[r], c = {}; Object.keys(d).forEach(function (k) { c[k] = d[k]; }); regs[r] = c; });
      SCHEMA['EPwm' + n + 'Regs'] = { title: 'ePWM' + n, clock: { reg: 'PCLKCR2', bit: n - 1, name: 'ePWM' + n + ' (CpuSysRegs.PCLKCR2.bit.EPWM' + n + ' = 0)' }, regs: regs };
    }
    // порядок групп: модули ePWM подряд
    var order = ['EPwm1Regs', 'EPwm2Regs', 'EPwm3Regs'], rest = {};
    Object.keys(SCHEMA).forEach(function (g) { if (order.indexOf(g) < 0) rest[g] = SCHEMA[g]; });
    var keep = {}; order.forEach(function (g) { keep[g] = SCHEMA[g]; });
    Object.keys(SCHEMA).forEach(function (g) { delete SCHEMA[g]; });
    order.forEach(function (g) { SCHEMA[g] = keep[g]; });
    Object.keys(rest).forEach(function (g) { SCHEMA[g] = rest[g]; });
  })();

  // служебные маски
  Object.keys(SCHEMA).forEach(function (g) {
    var regs = SCHEMA[g].regs;
    Object.keys(regs).forEach(function (r) {
      var d = regs[r];
      d.fmap = {}; d.roMask = 0;
      (d.f || []).forEach(function (fd) {
        fd.max = Math.pow(2, fd.width) - 1;
        fd.mask = (fd.max * Math.pow(2, fd.lsb)) | 0;
        d.fmap[fd.name] = fd;
        if (fd.acc === RO) d.roMask |= fd.mask;
      });
    });
  });

  var CONSTS = {
    TB_COUNT_UP: 0, TB_COUNT_DOWN: 1, TB_COUNT_UPDOWN: 2, TB_FREEZE: 3,
    TB_DISABLE: 0, TB_ENABLE: 1, TB_SHADOW: 0, TB_IMMEDIATE: 1,
    TB_DIV1: 0, TB_DIV2: 1, TB_DIV4: 2,
    TB_SYNC_IN: 0, TB_CTR_ZERO: 1, TB_CTR_CMPB: 2, TB_SYNC_DISABLE: 3,
    CC_SHADOW: 0, CC_IMMEDIATE: 1, CC_CTR_ZERO: 0, CC_CTR_PRD: 1, CC_CTR_ZERO_PRD: 2, CC_LD_DISABLE: 3,
    AQ_NO_ACTION: 0, AQ_CLEAR: 1, AQ_SET: 2, AQ_TOGGLE: 3,
    DB_DISABLE: 0, DBB_ENABLE: 1, DBA_ENABLE: 2, DB_FULL_ENABLE: 3,
    DB_ACTV_HI: 0, DB_ACTV_LOC: 1, DB_ACTV_HIC: 2, DB_ACTV_LO: 3,
    DBA_ALL: 0, DBB_RED_DBA_FED: 1, DBA_RED_DBB_FED: 2, DBB_ALL: 3,
    TZ_HIZ: 0, TZ_FORCE_HI: 1, TZ_FORCE_LO: 2, TZ_NO_CHANGE: 3,
    ET_CTR_ZERO: 1, ET_CTR_PRD: 2, ET_CTR_PRDZERO: 3, ET_CTRU_CMPA: 4, ET_CTRD_CMPA: 5, ET_CTRU_CMPB: 6, ET_CTRD_CMPB: 7,
    ET_DISABLE: 0, ET_1ST: 1, ET_2ND: 2, ET_3RD: 3,
    TRUE: 1, FALSE: 0, NULL: 0,
    ADC_ADCA: 0, ADC_ADCB: 1, ADC_ADCC: 2, ADC_ADCD: 3,
    ADC_RESOLUTION_12BIT: 0, ADC_RESOLUTION_16BIT: 1, ADC_SIGNALMODE_SINGLE: 0, ADC_SIGNALMODE_DIFFERENTIAL: 1
  };
  for (var gk = 1; gk <= 12; gk++) CONSTS['PIEACK_GROUP' + gk] = 1 << (gk - 1);
  for (var mk = 1; mk <= 14; mk++) CONSTS['M_INT' + mk] = 1 << (mk - 1);

  var MATH = {
    sinf: Math.sin, cosf: Math.cos, tanf: Math.tan, sqrtf: Math.sqrt, fabsf: Math.abs, atan2f: Math.atan2, atanf: Math.atan,
    expf: Math.exp, logf: Math.log, powf: Math.pow, floorf: Math.floor, ceilf: Math.ceil, fminf: Math.min, fmaxf: Math.max,
    fmodf: function (a, b) { return a % b; },
    sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, fabs: Math.abs, atan2: Math.atan2, atan: Math.atan,
    exp: Math.exp, log: Math.log, pow: Math.pow, floor: Math.floor, ceil: Math.ceil, fmin: Math.min, fmax: Math.max,
    fmod: function (a, b) { return a % b; }, abs: Math.abs, labs: Math.abs
  };

  var CASTS = {
    Uint16: function (v) { return Math.trunc(v) & 0xFFFF; },
    Uint32: function (v) { return Math.trunc(v) >>> 0; },
    int16: function (v) { return (Math.trunc(v) << 16) >> 16; },
    int32: function (v) { return Math.trunc(v) | 0; },
    float: function (v) { return Math.fround(v); },
    bool: function (v) { return v ? 1 : 0; }
  };
  var CAST_KIND = {
    'Uint16': 'Uint16', 'Uint32': 'Uint32', 'Uint64': 'Uint32', 'int16': 'int16', 'int32': 'int32', 'int64': 'int32',
    'int': 'int16', 'short': 'int16', 'char': 'int16', 'long': 'int32', 'unsigned': 'Uint16', 'signed': 'int16',
    'unsigned int': 'Uint16', 'unsigned short': 'Uint16', 'unsigned char': 'Uint16', 'unsigned long': 'Uint32',
    'signed int': 'int16', 'signed long': 'int32', 'signed short': 'int16', 'signed char': 'int16',
    'float': 'float', 'double': 'float', 'float32': 'float', 'float64': 'float', 'bool': 'bool'
  };

  /* ------------------------------------------------------------ */
  /* Транслятор подмножества C                                    */
  /* ------------------------------------------------------------ */
  function stripComments(src) {
    var out = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') {
        while (i < n && src[i] !== '\n') { out.push(' '); i++; }
      } else if (c === '/' && d === '*') {
        out.push('  '); i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out.push(src[i] === '\n' ? '\n' : ' '); i++; }
        if (i < n) { out.push('  '); i += 2; }
      } else if (c === '"' || c === "'") {
        var q = c; out.push(c); i++;
        while (i < n && src[i] !== q && src[i] !== '\n') {
          if (src[i] === '\\') { out.push(src[i], src[i + 1] || ''); i += 2; continue; }
          out.push(src[i++]);
        }
        if (i < n && src[i] === q) { out.push(q); i++; }
      } else { out.push(c); i++; }
    }
    return out.join('');
  }

  function matchParen(t, k) {
    var open = t[k], close = open === '(' ? ')' : open === '[' ? ']' : '}';
    var depth = 0;
    for (var j = k; j < t.length; j++) {
      var ch = t[j];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) return j + 1; }
    }
    return t.length;
  }

  function lineAt(t, idx) { var n = 1; for (var k = 0; k < idx && k < t.length; k++) if (t[k] === '\n') n++; return n; }
  function nlCount(s) { var m = s.match(/\n/g); return m ? m.length : 0; }
  function padNL(orig, repl) { var d = nlCount(orig) - nlCount(repl); return d > 0 ? repl + new Array(d + 1).join('\n') : repl; }

  function splitTop(s) {
    var parts = [], depth = 0, cur = '';
    for (var k = 0; k < s.length; k++) {
      var ch = s[k];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts;
  }

  function preprocess(text, errs, warns) {
    var lines = text.split('\n');
    for (var k = 0; k < lines.length; k++) {
      var j = k;
      while (/\\\s*$/.test(lines[k]) && j + 1 < lines.length) {
        j++; lines[k] = lines[k].replace(/\\\s*$/, ' ') + lines[j]; lines[j] = '';
      }
    }
    var macros = {};
    for (k = 0; k < lines.length; k++) {
      var m = /^\s*#\s*(\w+)(.*)$/.exec(lines[k]);
      if (!m) continue;
      var dir = m[1], rest = m[2];
      if (dir === 'define') {
        var dm = /^\s+([A-Za-z_]\w*)(\([^)]*\))?(.*)$/.exec(rest);
        if (!dm) { errs.push({ line: k + 1, text: 'неверная директива #define' }); }
        else {
          var params = null;
          if (dm[2] !== undefined && rest.indexOf(dm[1] + '(') >= 0) {
            params = dm[2].slice(1, -1).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          }
          var body = (dm[2] !== undefined && params === null ? dm[2] : '') + dm[3];
          macros[dm[1]] = { params: params, body: body.trim(), line: k + 1 };
        }
      } else if (dir === 'include' || dir === 'pragma' || dir === 'undef') {
        // заголовки TI заменены встроенной моделью
      } else {
        warns.push({ line: k + 1, text: 'директива #' + dir + ' не поддерживается и пропущена' });
      }
      lines[k] = '';
    }
    var t = lines.join('\n');
    var names = Object.keys(macros);
    if (!names.length) return { text: t, macros: macros };
    var objNames = names.filter(function (n) { return !macros[n].params; });
    var fnNames = names.filter(function (n) { return macros[n].params; });
    var reObj = objNames.length ? new RegExp('(?<![\\w.])(' + objNames.join('|') + ')\\b', 'g') : null;
    for (var pass = 0; pass < 16; pass++) {
      var before = t;
      if (reObj) t = t.replace(reObj, function (_, n) { return macros[n].body; });
      fnNames.forEach(function (n) {
        var re = new RegExp('(?<![\\w.])' + n + '\\s*\\(', 'g'), mm, out = '', last = 0;
        while ((mm = re.exec(t))) {
          var open = mm.index + mm[0].length - 1, end = matchParen(t, open);
          var args = splitTop(t.slice(open + 1, end - 1)).map(function (s) { return s.trim(); });
          var mac = macros[n], body = mac.body;
          mac.params.forEach(function (p, ix) {
            body = body.replace(new RegExp('(?<![\\w.])' + p + '\\b', 'g'), '(' + (args[ix] || '') + ')');
          });
          var orig = t.slice(mm.index, end);
          out += t.slice(last, mm.index) + padNL(orig, '(' + body + ')');
          last = end; re.lastIndex = end;
        }
        t = out + t.slice(last);
      });
      if (t === before) break;
    }
    return { text: t, macros: macros };
  }

  function operandEnd(t, j) {
    while (/[ \t]/.test(t[j])) j++;
    if (t[j] === '-' || t[j] === '+' || t[j] === '!' || t[j] === '~') return operandEnd(t, j + 1);
    if (t[j] === '(') j = matchParen(t, j);
    else {
      var m = /^(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_]\w*)/.exec(t.slice(j));
      if (!m) return j;
      j += m[0].length;
    }
    for (;;) {
      var k = j;
      while (/[ \t]/.test(t[k])) k++;
      if (t[k] === '(' || t[k] === '[') { j = matchParen(t, k); continue; }
      if (t[k] === '.' && /[A-Za-z_]/.test(t[k + 1] || '')) { var mm = /^\.[A-Za-z_]\w*/.exec(t.slice(k)); j = k + mm[0].length; continue; }
      break;
    }
    return j;
  }

  var TYPE_WORDS = 'Uint16|Uint32|Uint64|int16|int32|int64|int|long|short|char|float|double|float32|float64|bool|void|unsigned|signed';
  var KEYWORDS = ['if', 'else', 'for', 'while', 'do', 'return', 'switch', 'case', 'default', 'break', 'continue', 'var', 'function', 'new', 'typeof', 'sizeof', 'goto'];

  function translate(src) {
    var errs = [], warns = [];
    var t = stripComments(src);

    var sm = /\b(typedef|union|goto)\b|\bstruct\s+\w*\s*\{/.exec(t);
    if (sm) errs.push({ line: lineAt(t, sm.index), text: 'конструкция «' + (sm[1] || 'struct {...}') + '» в симуляторе не поддерживается; указатели на структуры регистров (struct EPWM_REGS *) допускаются' });
    // указатели на структуры регистров: p->X -> p.X, &EPwm1Regs -> EPwm1Regs
    t = t.replace(/->/g, '.');
    t = t.replace(/&\s*((?:EPwm\d+|EQep\d+|Cmpss\d|Adca|AdcaResult|GpioCtrl|InputXbar|EPwmXbar|CpuSys|PieCtrl)Regs)\b/g, '$1');

    var pp = preprocess(t, errs, warns);
    t = pp.text;

    // ассемблерные вставки и макросы TI
    t = t.replace(/\b(?:__)?asm\s*\(\s*"([^"]*)"\s*\)\s*;/g, function (_, a) {
      var s = a.trim().toUpperCase().replace(/\s+/g, ' ');
      if (s === 'CLRC INTM') return '__EINT();';
      if (s === 'SETC INTM') return '__DINT();';
      if (s === 'EALLOW') return '__EALLOW();';
      if (s === 'EDIS') return '__EDIS();';
      if (s === 'ESTOP0') return '__ESTOP0();';
      if (s === 'CLRC DBGM') return '__ERTM();';
      return ';';
    });
    t = t.replace(/\b(EALLOW|EDIS|EINT|DINT|ERTM|DRTM|ESTOP0)\b\s*;/g, '__$1();');

    // фоновый цикл main()
    t = t.replace(/\bfor\s*\(\s*;\s*;\s*\)/g, 'while(__bg())');
    t = t.replace(/\bwhile\s*\(\s*(?:1|true|TRUE)\s*\)/g, 'while(__bg())');

    // суффиксы чисел
    t = t.replace(/(\b\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\b\d+[eE][+-]?\d+)[fFlL]\b/g, '$1');
    t = t.replace(/\b(0[xX][0-9a-fA-F]+|\d+)(?:[uU][lL]{0,2}|[lL]{1,2}[uU]?)\b/g, '$1');

    // определения и прототипы функций
    var fnNames = [], fnParams = [];
    var reFn = new RegExp('(?<=^|[;{}\\n])([ \\t]*)(?:(?:static|inline|extern|__interrupt|interrupt|const|volatile)[ \\t]+)*(?:(?:unsigned|signed)[ \\t]+)?(?:' + TYPE_WORDS + ')(?:[ \\t]+(?:int|long))?[ \\t]+([A-Za-z_]\\w*)\\s*\\(([^()]*)\\)\\s*(\\{|;)', 'g');
    t = t.replace(reFn, function (m, ind, name, params, end) {
      var ps = params.trim();
      var names = (ps === '' || ps === 'void') ? [] : splitTop(ps).map(function (p) {
        var r = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/.exec(p.trim());
        return r ? r[1] : '_';
      });
      names.forEach(function (p) { fnParams.push(p); });
      if (end === ';') return padNL(m, ind);
      if (fnNames.indexOf(name) < 0) fnNames.push(name);
      return padNL(m, ind + 'function ' + name + '(' + names.join(', ') + '){');
    });

    // объявления указателей на структуры регистров
    t = t.replace(/(^|[;{}(,\n])([ \t]*)(?:(?:static|volatile|const)[ \t]+)*struct[ \t]+\w+[ \t]*\*[ \t]*(?=[A-Za-z_])/g, function (m, a, b) { return a + b + (a === '(' || a === ',' ? '' : 'var '); });

    // приведения типов
    var reCast = /\(\s*((?:unsigned|signed)[ \t]+(?:int|long|short|char)|unsigned|signed|Uint16|Uint32|Uint64|int16|int32|int64|int|long|short|char|float|double|float32|float64|bool)\s*\)/g;
    var pos = 0, guard = 0;
    for (;;) {
      if (++guard > 5000) break;
      reCast.lastIndex = pos;
      var cm = reCast.exec(t);
      if (!cm) break;
      var st = cm.index, p = st - 1;
      while (p >= 0 && /[ \t]/.test(t[p])) p--;
      if (p >= 0 && /[\w)\]]/.test(t[p])) { pos = st + 1; continue; }
      var opStart = st + cm[0].length, opEnd = operandEnd(t, opStart);
      var kind = CAST_KIND[cm[1].replace(/\s+/g, ' ')] || 'int32';
      t = t.slice(0, st) + '__c_' + kind + '(' + t.slice(opStart, opEnd) + ')' + t.slice(opEnd);
      pos = st;
    }

    // целочисленные переменные: при присваивании значение приводится к типу (деление нацело, переполнение)
    var intVars = {};
    (function () {
      var reI = /(?<=^|[;{}(\n])[ \t]*(?:(?:static|volatile|const|extern|register)[ \t]+)*(unsigned[ \t]+(?:int|long|short|char)|signed[ \t]+(?:int|long|short|char)|unsigned|signed|Uint16|Uint32|Uint64|int16|int32|int64|int|long(?:[ \t]+long)?|short|char)[ \t]+(?:(?:volatile|const)[ \t]+)?([^;(){}]*);/g, im;
      while ((im = reI.exec(t))) {
        var kind = CAST_KIND[im[1].replace(/\s+/g, ' ').replace('long long', 'long')] || 'int32';
        splitTop(im[2]).forEach(function (d) { var r = /^\s*([A-Za-z_]\w*)\s*(\[)?/.exec(d); if (r && !r[2]) intVars[r[1]] = kind; });
      }
    })();

    // объявления переменных
    var reDecl = /(?<=^|[;{}(\n])([ \t]*)(?:(?:static|volatile|const|extern|register)[ \t]+)*(?:(?:unsigned|signed)[ \t]+(?:(?:int|long|short|char)[ \t]+)?|(?:Uint16|Uint32|Uint64|int16|int32|int64|int|long(?:[ \t]+long)?|short|char|float|double|float32|float64|bool)[ \t]+)(?:(?:volatile|const)[ \t]+)?(?=[A-Za-z_])/g;
    t = t.replace(reDecl, '$1var ');
    t = t.replace(/\bvar\s+([A-Za-z_]\w*)\s*\[[^\]]*\]\s*=\s*\{([^}]*)\}/g, function (m, n, list) { return padNL(m, 'var ' + n + ' = [' + list + ']'); });
    t = t.replace(/\bvar\s+([A-Za-z_]\w*)\s*\[([^\]]+)\]/g, 'var $1 = new Float64Array($2)');

    // взятие адреса функции
    t = t.replace(/(=|\(|,)\s*&(?!&)\s*([A-Za-z_]\w*)/g, '$1 $2');

    // защита от зацикливания
    (function () {
      var re = /\b(for|while)\s*\(/g, out = '', last = 0, m;
      while ((m = re.exec(t))) {
        var open = m.index + m[0].length - 1, close = matchParen(t, open);
        if (t.slice(m.index, close).indexOf('__bg()') >= 0) continue;
        var k = close;
        while (/[ \t\n]/.test(t[k])) k++;
        if (t[k] === '{') { out += t.slice(last, k + 1) + '__guard();'; last = k + 1; re.lastIndex = k + 1; }
      }
      t = out + t.slice(last);
      t = t.replace(/\bdo\s*\{/g, function (s) { return s + '__guard();'; });
    })();

    // объявленные имена
    var depth = new Int32Array(t.length + 1), dd = 0;
    for (var q = 0; q < t.length; q++) { depth[q] = dd; if (t[q] === '{') dd++; else if (t[q] === '}') dd--; }
    var declared = {}, topVars = [];
    var reVar = /\bvar\s+([^;]*)/g, vm;
    while ((vm = reVar.exec(t))) {
      splitTop(vm[1]).forEach(function (piece) {
        var nm = /^\s*([A-Za-z_]\w*)/.exec(piece);
        if (!nm) return;
        declared[nm[1]] = true;
        if (depth[vm.index] === 0 && topVars.indexOf(nm[1]) < 0) topVars.push(nm[1]);
      });
    }
    fnNames.forEach(function (n) { declared[n] = true; });
    fnParams.forEach(function (n) { declared[n] = true; });

    // присваивание необъявленным переменным
    var reAsg = /(?<![\w.\]])([A-Za-z_]\w*)\s*(?:[-+*\/%&|^]|<<|>>)?=(?!=)/g, am;
    while ((am = reAsg.exec(t))) {
      var id = am[1];
      if (declared[id] || ENV_NAMES[id] || KEYWORDS.indexOf(id) >= 0) continue;
      errs.push({ line: lineAt(t, am.index), text: 'переменная «' + id + '» не объявлена' });
      declared[id] = true;
    }

    if (fnNames.indexOf('main') < 0) errs.push({ line: null, text: 'нет функции main()' });

    // приведение при присваивании целочисленным переменным
    (function () {
      var names = Object.keys(intVars).filter(function (n) { return fnNames.indexOf(n) < 0; });
      if (!names.length) return;
      var re = new RegExp('(?<![\\w.\\]])(' + names.join('|') + ')\\s*((?:[-+*\\/%&|^]|<<|>>)?)=(?!=)', 'g'), m, reps = [];
      while ((m = re.exec(t))) {
        var a = m.index + m[0].length, k = a, dep = 0;
        for (; k < t.length; k++) { var ch = t[k]; if (ch === '(' || ch === '[') dep++; else if (ch === ')' || ch === ']') { if (dep === 0) break; dep--; } else if ((ch === ';' || ch === ',') && dep === 0) break; }
        var ex = t.slice(a, k);
        if (!ex.trim()) continue;
        var nl = (ex.match(/\n/g) || []).length;
        var body = m[2] ? m[1] + ' ' + m[2] + ' (' + ex.replace(/\n/g, ' ') + ')' : ex.replace(/\n/g, ' ');
        reps.push({ a: m.index, b: k, s: m[1] + ' = __c_' + intVars[m[1]] + '(' + body + ')' + new Array(nl + 1).join('\n') });
      }
      for (var q = reps.length - 1; q >= 0; q--) t = t.slice(0, reps[q].a) + reps[q].s + t.slice(reps[q].b);
    })();

    return { js: t, errors: errs, warnings: warns, topVars: topVars, fnNames: fnNames, macros: pp.macros };
  }

  var ENV_NAMES = {};
  ['EPwm1Regs', 'EPwm2Regs', 'EPwm3Regs', 'EQep1Regs', 'CpuSysRegs', 'GpioCtrlRegs', 'InputXbarRegs', 'EPwmXbarRegs', 'AdcaRegs', 'AdcaResultRegs', 'PieCtrlRegs', 'PieVectTable', 'IER', 'IFR'].forEach(function (n) { ENV_NAMES[n] = true; });
  for (var cmpN = 1; cmpN <= 8; cmpN++) ENV_NAMES['Cmpss' + cmpN + 'Regs'] = true;

  /* ------------------------------------------------------------ */
  /* Компиляция: функция-фабрика                                   */
  /* ------------------------------------------------------------ */
  function factorySource(tr) {
    var vars = tr.topVars.map(function (v) {
      return JSON.stringify(v) + ':(typeof ' + v + "!=='undefined'?" + v + ':undefined)';
    }).join(',');
    var sets = tr.topVars.map(function (v) {
      return 'if(__n===' + JSON.stringify(v) + '){' + v + '=__v;return true;}';
    }).join('');
    return "\n;return {main:(typeof main==='function')?main:null, vars:function(){return {" + vars + '};}, set:function(__n,__v){' + sets + 'return false;}};';
  }

  var compileFn = {
    offset: null,
    build: function (body) { return new Function('__env', 'with(__env){\n' + body + '\n}\n//# sourceURL=app.c.js'); },
    compile: function (tr) {
      if (this.offset === null) this.offset = calibrate(this);
      try { return { factory: this.build(tr.js + factorySource(tr)) }; }
      catch (e) { return { error: { line: null, text: syntaxRu(e) } }; }
    }
  };
  function calibrate(cm) {
    try { cm.build('throw new Error("c2k-cal")')({}); } catch (e) {
      var l = stackLine(e);
      if (l !== null) return l - 1;
    }
    return 0;
  }
  function stackLine(e) {
    var s = String(e && e.stack || '');
    var m = /app\.c\.js:(\d+)/.exec(s);
    return m ? +m[1] : null;
  }
  function syntaxRu(e) {
    var m = String(e && e.message || e).replace(/^.*?Node'?:\s*/, '');
    m = m.replace(/^Unexpected token '?(.+?)'?$/, 'неожиданный символ «$1»').replace(/^Unexpected end of input$/, 'неожиданный конец текста: не закрыта скобка');
    return 'синтаксическая ошибка: ' + m;
  }
  function runtimeRu(e) {
    if (e && e.c2k) return e.message;
    var m = String(e && e.message || e), r;
    if ((r = /^(\S+) is not defined/.exec(m))) return 'идентификатор «' + r[1] + '» не объявлен';
    if ((r = /(\S+) is not a function/.exec(m))) return '«' + r[1] + '» не является функцией';
    if ((r = /Cannot (?:read|set) propert(?:y|ies) of undefined.*'(\w+)'/.exec(m))) return 'обращение к полю «' + r[1] + '» несуществующего объекта';
    return m;
  }
  function cErr(text) { var e = new Error(text); e.c2k = true; return e; }

  /* ------------------------------------------------------------ */
  /* Прогон                                                       */
  /* ------------------------------------------------------------ */
  function createRun(code, params, opts) {
    opts = opts || {};
    var P = {
      Vdc: +params.Vdc || 48, R: +params.R || 2, L: (+params.L || 5) * 1e-3,
      Tsim: Math.min(Math.max(+params.Tsim || 60, 1), 700) * 1e-3,
      encoder: params.encoder || null,      // {lines, qerr, lerr, ecc, seed}
      traceExtra: (params.traceExtra || []).slice(),
      plant: params.plant || 'leg',          // leg - стойка с R-L нагрузкой, hbdc - H-мост с двигателем постоянного тока
      motor: params.motor ? JSON.parse(JSON.stringify(params.motor)) : null,
      von: +params.von || 0, vonI: +params.vonI || 0.05,             // vonI - ток, при котором падение достигает von, А
                                              // падение напряжения на открытом ключе или диоде, В
      varEvents: (params.varEvents || []).slice().sort(function (a, b) { return a.t - b.t; }),
      traceVar: params.traceVar || null,
      overrides: params.overrides || null,
      faults: (params.faults || []).slice().sort(function (a, b) { return a.t0 - b.t0; }),
      seed: params.seed || 1,
      sense: params.sense || null,          // датчик тока: {ch, rsh, g, pol, voff, gerr, tauAmp, tauS}
      loadEvents: (params.loadEvents || []).slice(),
      scFault: params.scFault || null,      // межфазное КЗ: {t, a, b, sign, lk, rk, mph, ith}
      capture: params.capture || null,      // запись каждого такта: {t, n, ch} - напряжение входа и выходы CMPSS
      spike: params.spike || null           // импульсные помехи на выходах датчиков при переключениях: {amp, dur, tail}, В и с
    };
    var NT = Math.round(P.Tsim * BASE_HZ);
    var DEC = 20;                          // шаг записи тока: 0.2 мкс

    var msgs = [];
    var st = {
      tick: 0, eallow: false, sysInit: false, wdOn: true, IER: 0, IFR: 0, INTM: 1,
      cfgDirty: true, halted: false, haltReason: null, phase: 'init', guard: 0,
      reachedBg: false, isrCount: 0, qepLatchReads: 0, tbSteps: 0, etSupp: 0, ignored: 0, tripTick: null,
      blockSince: 0, blockReported: false, warnSeen: {}, lineOffset: 0,
      tripSrc: null, cbcActive: false, mainDelayUs: 0, isrDelayUs: 0, adcPwrDelay: null, adcPwrTick: null, adcModeSet: false, isrBy: { adc: 0, epwm: 0, qep: 0 }, cmpaMin: Infinity, cmpaMax: -Infinity, cmpaWrites: 0, ovf: 0, missingVars: []
    };
    var S = {};
    Object.keys(SCHEMA).forEach(function (g) {
      S[g] = {};
      Object.keys(SCHEMA[g].regs).forEach(function (r) { S[g][r] = SCHEMA[g].regs[r].reset >>> 0; });
    });
    var DEFAULTS = { EPWM1_INT: function EPWM1_INT_ISR() {}, ADCA1_INT: function ADCA1_ISR() {}, EQEP1_INT: function EQEP1_INT_ISR() {} };
    var vect = { EPWM1_INT: undefined, ADCA1_INT: undefined, EQEP1_INT: undefined };
    var SRC = [
      { key: 'adc', vec: 'ADCA1_INT', ifr: 'PIEIFR1', ier: 'PIEIER1', grp: 1, mask: 1, ack: 1, src: 'АЦП A (ADCINT1)', ackName: 'PIEACK_GROUP1', ierName: 'M_INT1', isrName: 'adca1_isr' },
      { key: 'epwm', vec: 'EPWM1_INT', ifr: 'PIEIFR3', ier: 'PIEIER3', grp: 3, mask: 4, ack: 4, src: 'ePWM1', ackName: 'PIEACK_GROUP3', ierName: 'M_INT3', isrName: 'epwm1_isr' },
      { key: 'qep', vec: 'EQEP1_INT', ifr: 'PIEIFR5', ier: 'PIEIER5', grp: 5, mask: 16, ack: 16, src: 'eQEP1', ackName: 'PIEACK_GROUP5', ierName: 'M_INT5', isrName: 'eqep1_isr' }
    ];

    function tms() { return st.tick / BASE_HZ * 1e3; }
    function msg(lvl, text, line) { msgs.push({ lvl: lvl, text: text, t: st.phase === 'init' ? null : tms(), line: line || null, phase: st.phase }); }
    function warnOnce(key, lvl, text, line) { if (st.warnSeen[key]) return; st.warnSeen[key] = true; msg(lvl, text, line); }
    function halt(reason, text) { if (st.halted) return; st.halted = true; st.haltReason = reason; msg('err', text); }
    function errLine(e) { var l = stackLine(e); return l === null ? null : l - st.lineOffset; }

    /* ---- запись и чтение регистров ---- */
    function regRead(g, r) {
      var d = SCHEMA[g].regs[r];
      if (d.wo) return 0;
      if (g === 'EQep1Regs' && r === 'QPOSCNT' && st.phase !== 'init') {
        var Q = S.EQep1Regs;
        if (!((Q.QEPCTL >> 2) & 1)) { Q.QCTMRLAT = Q.QCTMR; Q.QCPRDLAT = Q.QCPRD; st.qepLatchReads++; }
      }
      return S[g][r];
    }
    function regWrite(g, r, v) {
      var G = SCHEMA[g], d = G.regs[r], name = g + '.' + r;
      if ((G.prot || d.prot) && !st.eallow) {
        st.ignored++;
        warnOnce('ea:' + name, 'warn', 'Запись в ' + name + ' без EALLOW не выполнена: регистр защищен от записи.');
        return;
      }
      if (G.clock && !((S.CpuSysRegs[G.clock.reg] >>> G.clock.bit) & 1)) {
        st.ignored++;
        warnOnce('clk:' + g, 'warn', 'Запись в ' + name + ' не выполнена: на модуль не подан такт: ' + G.clock.name + '. Такт периферии включает InitSysCtrl().');
        return;
      }
      if (d.ro) { warnOnce('ro:' + name, 'warn', name + ' доступен только для чтения, запись не действует.'); return; }
      v = v >>> 0; if (d.w === 16) v &= 0xFFFF;
      var grp = S[g];
      if (d.wo) { command(g, r, v); return; }
      if (d.w1c) { grp[r] = (grp[r] & ~v) >>> 0; return; }
      if (g === 'EQep1Regs' && r === 'QEPSTS') { grp[r] = (grp[r] & ~(v & 0x8E)) & 0xFFFF; return; }
      if (g === 'EQep1Regs' && r === 'QEPCTL' && (v & 0x80)) { S.EQep1Regs.QPOSCNT = S.EQep1Regs.QPOSINIT; v &= ~0x80; }
      var roM = d.roMask;
      var nv = ((grp[r] & roM) | (v & ~roM)) >>> 0;
      if (d.w === 16) nv &= 0xFFFF;
      grp[r] = nv;
      var cmm = /^Cmpss(\d)Regs$/.exec(g);
      if (cmm) {
        var csx = CS[+cmm[1] - 1];
        if (r === 'DACHVALS') grp.DACHVALA = nv & 0xFFF;
        if (r === 'DACLVALS') grp.DACLVALA = nv & 0xFFF;
        if ((r === 'CTRIPHFILCTL' || r === 'CTRIPLFILCTL') && (nv & 0x8000)) { csx.init[r === 'CTRIPHFILCTL' ? 0 : 1] = true; grp[r] = nv & 0x7FFF; }
      }
      if (g === 'AdcaRegs' && r === 'ADCCTL1') {
        var on = (nv >> 7) & 1;
        if (on && st.adcPwrTick === null) { st.adcPwrTick = st.phase === 'main' ? 0 : st.tick; st.adcPwrDelay = st.phase === 'main' ? st.mainDelayUs : null; }
        if (!on) st.adcPwrTick = null;
      }
      if (g === 'EPwm1Regs' && r === 'CMPA' && st.phase !== 'init') {
        var cv = (nv >>> 16) & 0xFFFF;
        if (cv < st.cmpaMin) st.cmpaMin = cv;
        if (cv > st.cmpaMax) st.cmpaMax = cv;
        st.cmpaWrites++;
      }
      st.cfgDirty = true;
    }
    function command(g, r, v) {
      var E = S.EPwm1Regs;
      if (g === 'EQep1Regs') {
        var Qr = S.EQep1Regs;
        if (r === 'QCLR') Qr.QFLG = (Qr.QFLG & ~v) & 0xFFFF;
        else if (r === 'QFRC') { Qr.QFLG |= (v & 0xFFE); if (Qr.QFLG & Qr.QEINT & 0xFFE) qepInt(); }
        return;
      }
      if (g === 'AdcaRegs') {
        var A = S.AdcaRegs;
        if (r === 'ADCINTFLGCLR') A.ADCINTFLG &= ~v;
        else if (r === 'ADCINTOVFCLR') A.ADCINTOVF &= ~v;
        else if (r === 'ADCSOCFRC1') { for (var k = 0; k < 4; k++) if (v & (1 << k)) adcQueue(k, true); }
        st.cfgDirty = true;
        return;
      }
      var cmc = /^Cmpss(\d)Regs$/.exec(g);
      if (cmc) {
        if (r === 'COMPSTSCLR') { var cso = CS[+cmc[1] - 1]; if (v & 2) cso.f[0].latch = 0; if (v & 0x200) cso.f[1].latch = 0; S[g].COMPSTS &= ~((v & 2) | (v & 0x200)); }
        return;
      }
      var mm = /^EPwm(\d)Regs$/.exec(g);
      if (!mm) return;
      E = S[g];
      var sfx = mm[1] === '1' ? '' : ':' + mm[1];
      if (r === 'TZFRC') {
        if ((v & 4) && !(E.TZFLG & 4)) L.tzEv.push(st.tick, 'FRC' + sfx);
        if (v & 4) { E.TZFLG |= 5; if (st.tripTick === null && !sfx) { st.tripTick = st.tick; st.tripSrc = 'TZFRC'; msg('info', 'EPwm1Regs.TZFRC.bit.OST = 1: программное аварийное отключение, выходы переведены в состояние по TZCTL.'); } }
        if (v & 2) E.TZFLG |= 2;
      } else if (r === 'TZCLR') {
        if ((v & 4) && (E.TZFLG & 4)) L.tzEv.push(st.tick, 'CLR' + sfx);
        E.TZFLG &= ~v;
      } else if (r === 'TZOSTCLR') {
        E.TZOSTFLG &= ~v;
      } else if (r === 'TZCBCCLR') {
        E.TZCBCFLG &= ~v;
      } else if (r === 'ETCLR') {
        E.ETFLG &= ~v;
      }
      st.cfgDirty = true;
    }
    function toInt(v, what, bits) {
      var n = Number(v);
      if (typeof v === 'function') throw cErr('в ' + what + ' записывается функция, ожидается число');
      if (!isFinite(n)) { warnOnce('nan:' + what, 'warn', 'В ' + what + ' записано нечисловое значение (' + v + '), записан 0.'); return 0; }
      n = Math.trunc(n);
      if (bits === 32 && n < 0 && n >= -2147483648) n = n >>> 0;
      var max = Math.pow(2, bits) - 1;
      if (n < 0 || n > max) {
        var kept = ((n % (max + 1)) + (max + 1)) % (max + 1);
        st.ovf++;
        warnOnce('ovf:' + what, 'warn', 'Значение ' + n + ' не помещается в ' + what + ' (' + bits + ' бит), записано ' + kept + '.');
        return kept;
      }
      return n;
    }

    function makeRegProxy(g, r) {
      var d = SCHEMA[g].regs[r], name = g + '.' + r;
      var bit = new Proxy({}, {
        get: function (_, p) {
          if (typeof p === 'symbol') return undefined;
          var fd = d.fmap[p];
          if (!fd) throw cErr('В регистре ' + name + ' нет поля ' + String(p) + '.');
          return (regRead(g, r) >>> fd.lsb) & fd.max;
        },
        set: function (_, p, v) {
          var fd = d.fmap[p];
          if (!fd) throw cErr('В регистре ' + name + ' нет поля ' + String(p) + '.');
          if (fd.acc === RO) { warnOnce('rof:' + name + p, 'warn', 'Поле ' + name + '.bit.' + p + ' доступно только для чтения.'); return true; }
          var n = toInt(v, name + '.bit.' + p, fd.width);
          var cur = regRead(g, r);
          var nv = ((cur & ~fd.mask) | ((n << fd.lsb) & fd.mask)) >>> 0;
          regWrite(g, r, nv);
          return true;
        }
      });
      return new Proxy({}, {
        get: function (_, p) {
          if (typeof p === 'symbol') return undefined;
          if (p === 'bit') return bit;
          if (p === 'all') return regRead(g, r);
          throw cErr('У регистра ' + name + ' есть только .bit и .all, а не .' + String(p) + '.');
        },
        set: function (_, p, v) {
          if (p === 'all') { regWrite(g, r, toInt(v, name + '.all', d.w)); return true; }
          throw cErr('Запись в ' + name + '.' + String(p) + ': используйте .bit.ПОЛЕ или .all.');
        }
      });
    }
    function makeGroupProxy(g) {
      var regs = SCHEMA[g].regs, cache = {};
      Object.keys(regs).forEach(function (r) { if (!regs[r].plain) cache[r] = makeRegProxy(g, r); });
      return new Proxy({}, {
        get: function (_, p) {
          if (typeof p === 'symbol') return undefined;
          var d = regs[p];
          if (!d) throw cErr('В ' + g + ' нет регистра ' + String(p) + ' (в симуляторе описана только часть регистров).');
          if (d.plain) return regRead(g, p);
          return cache[p];
        },
        set: function (_, p, v) {
          var d = regs[p];
          if (!d) throw cErr('В ' + g + ' нет регистра ' + String(p) + '.');
          if (!d.plain) throw cErr(g + '.' + p + ' - регистр с полями, запись через .bit.ПОЛЕ или .all.');
          regWrite(g, p, toInt(v, g + '.' + p, d.w));
          return true;
        }
      });
    }
    var vectProxy = new Proxy({}, {
      get: function (_, p) { if (typeof p === 'symbol') return undefined; if (!(p in vect)) throw cErr('Вектор PieVectTable.' + String(p) + ' в симуляторе не моделируется.'); return vect[p]; },
      set: function (_, p, v) {
        if (!(p in vect)) throw cErr('Вектор PieVectTable.' + String(p) + ' в симуляторе не моделируется (доступны EPWM1_INT, ADCA1_INT и EQEP1_INT).');
        if (!st.eallow) { st.ignored++; warnOnce('ea:vect', 'warn', 'Запись в PieVectTable без EALLOW не выполнена: таблица векторов защищена.'); return true; }
        if (typeof v !== 'function') throw cErr('PieVectTable.' + p + ' ожидает адрес функции-обработчика.');
        vect[p] = v; return true;
      }
    });

    /* ---- окружение пользовательского кода ---- */
    var env = {};
    Object.keys(CONSTS).forEach(function (k) { env[k] = CONSTS[k]; });
    Object.keys(MATH).forEach(function (k) { env[k] = MATH[k]; });
    Object.keys(CASTS).forEach(function (k) { env['__c_' + k] = CASTS[k]; });
    env.EPwm1Regs = makeGroupProxy('EPwm1Regs');
    env.EPwm2Regs = makeGroupProxy('EPwm2Regs');
    env.EPwm3Regs = makeGroupProxy('EPwm3Regs');
    env.CpuSysRegs = makeGroupProxy('CpuSysRegs');
    env.GpioCtrlRegs = makeGroupProxy('GpioCtrlRegs');
    env.InputXbarRegs = makeGroupProxy('InputXbarRegs');
    env.AdcaRegs = makeGroupProxy('AdcaRegs');
    env.AdcaResultRegs = makeGroupProxy('AdcaResultRegs');
    env.PieCtrlRegs = makeGroupProxy('PieCtrlRegs');
    env.EQep1Regs = makeGroupProxy('EQep1Regs');
    env.EPwmXbarRegs = makeGroupProxy('EPwmXbarRegs');
    for (var cg = 1; cg <= 8; cg++) env['Cmpss' + cg + 'Regs'] = makeGroupProxy('Cmpss' + cg + 'Regs');
    env.PieVectTable = vectProxy;
    Object.defineProperty(env, 'IER', { get: function () { return st.IER; }, set: function (v) { st.IER = toInt(v, 'IER', 16); }, enumerable: true });
    Object.defineProperty(env, 'IFR', { get: function () { return st.IFR; }, set: function (v) { st.IFR = toInt(v, 'IFR', 16); }, enumerable: true });
    env.__EALLOW = function () { st.eallow = true; };
    env.__EDIS = function () { st.eallow = false; };
    env.__EINT = function () { st.INTM = 0; };
    env.__DINT = function () { st.INTM = 1; };
    env.__ERTM = function () {};
    env.__DRTM = function () {};
    env.__ESTOP0 = function () { halt('estop', 'ESTOP0: программная точка останова, выполнение остановлено.'); throw cErr('__stop'); };
    env.__bg = function () { st.reachedBg = true; return false; };
    env.__guard = function () { if (++st.guard > 2e6) throw cErr('Цикл выполнил более 2 млн итераций без выхода: похоже на бесконечный цикл.'); };
    env.InitSysCtrl = function () {
      st.sysInit = true; st.wdOn = false;
      S.CpuSysRegs.PCLKCR2 = 0xFFF;
      S.CpuSysRegs.PCLKCR13 = 0xF;
      S.CpuSysRegs.PCLKCR4 = 0x7;
      S.CpuSysRegs.PCLKCR14 = 0xFF;
      S.CpuSysRegs.PCLKCR0 = (S.CpuSysRegs.PCLKCR0 | 0x3D | (1 << 16) | (1 << 18)) >>> 0;
      st.cfgDirty = true;
      msg('info', 'InitSysCtrl(): сторожевой таймер отключен, SYSCLK = 200 МГц, EPWMCLK = 100 МГц, такт подан на ePWM1..ePWM12, eQEP1..eQEP3, АЦП и CMPSS1..CMPSS8, TBCLKSYNC = 1.');
    };
    env.InitPieCtrl = function () {
      st.INTM = 1;
      S.PieCtrlRegs.PIECTRL &= ~1; S.PieCtrlRegs.PIEIER3 = 0; S.PieCtrlRegs.PIEIFR3 = 0; S.PieCtrlRegs.PIEIER1 = 0; S.PieCtrlRegs.PIEIFR1 = 0; S.PieCtrlRegs.PIEIER5 = 0; S.PieCtrlRegs.PIEIFR5 = 0;
    };
    env.InitPieVectTable = function () {
      vect.EPWM1_INT = DEFAULTS.EPWM1_INT; vect.ADCA1_INT = DEFAULTS.ADCA1_INT; vect.EQEP1_INT = DEFAULTS.EQEP1_INT;
      S.PieCtrlRegs.PIECTRL |= 1;
    };
    env.DisableDog = function () { st.wdOn = false; };
    env.ServiceDog = function () {};
    env.DELAY_US = function (us) { us = +us || 0; if (st.phase === 'main') st.mainDelayUs += us; else st.isrDelayUs += us; };
    env.F28x_usDelay = function () {};
    env.AdcSetMode = function (adc, res, mode) {
      if (adc !== 0) { warnOnce('adcsetmode', 'warn', 'AdcSetMode: в модели есть только АЦП A (ADC_ADCA).'); return; }
      if (!(S.CpuSysRegs.PCLKCR13 & 1)) { warnOnce('clk:AdcaRegs', 'warn', 'AdcSetMode(): на АЦП A не подан такт.'); return; }
      if (res === 1 && mode === 0) warnOnce('adc16', 'warn', 'Разрешение 16 бит допустимо только в дифференциальном режиме; в модели используется 12 бит.');
      S.AdcaRegs.ADCCTL2 = (S.AdcaRegs.ADCCTL2 & ~0xC0) | ((res & 1) << 6) | ((mode & 1) << 7);
      st.adcModeSet = true; st.cfgDirty = true;
    };

    /* ---- кэш конфигурации и состояние модулей ePWM ---- */
    var HSP = [1, 2, 4, 6, 8, 10, 12, 14];
    var C = { running: false };
    var M = newM();
    var E = S.EPwm1Regs;
    function newM() { return { socCnt: 0, presc: 0, dirUp: 1, prdA: 0, cmpA: 0, aqA: 0, aqB: 0, hi: 0, lo: 1e9, redPrev: 0, fedPrev: 0, dbA: 0, dbB: 0, etCnt: 0, lastD: NaN, prevStepTick: 0, syncIn: false, outA: 0, outB: 0, lastPA: -1, lastPB: -1 }; }
    var MODS = [];
    for (var mi = 1; mi <= NMOD; mi++) MODS.push(mi === 1 ? { n: 1, E: E, C: C, M: M, ed: { A: null, B: null } } : { n: mi, E: S['EPwm' + mi + 'Regs'], C: { running: false }, M: newM(), ed: { A: [], B: [] } });

    /* ---- журналы ---- */
    var L = {
      varEv: [], tripEd: [], zeroT2: [], zeroT3: [], edA: [], edB: [], vEd: [], ctrV: [0, 0], zeroT: [], prdT: [], tzEv: [], adcS: [], csS: null, csN: 0, cmpEv: [], prdEv: [], isrT: [], shoot: [], varT: [],
      iS: new Float32Array(Math.floor(NT / DEC) + 2), iN: 0, dec: DEC, wS: null,
      lastA: -1, lastB: -1, lastV: NaN, lastCmp: -1, lastPrd: -1, inShoot: false, plant: P.plant
    };
    MODS[0].ed.A = L.edA; MODS[0].ed.B = L.edB;
    L.varX = {}; P.traceExtra.forEach(function (n) { L.varX[n] = []; });
    L.ed = MODS.map(function (md) { return md.ed; });
    var plant = { i: 0, w: P.motor && P.motor.w0 ? +P.motor.w0 : 0, th: 0, vleg: P.Vdc / 2 };
    var R = P.R, ldIdx = 0, lastVl = NaN, veIdx = 0;
    var dtL = DT / P.L;
    var MOT = P.motor;
    if (MOT) L.wS = new Float32Array(Math.floor(NT / DEC) + 2);
    var IM = null, ITOT = [0, 0, 0];
    var SC = P.scFault ? { a: P.scFault.a, b: P.scFault.b, sign: P.scFault.sign || 1, lk: P.scFault.lk, rk: P.scFault.rk || 0.05, t0: Math.round(P.scFault.t * BASE_HZ), minInt: Math.round((P.scFault.minInt || 0) * BASE_HZ), run: 0, lastRun: 0, mph: P.scFault.mph, ith: P.scFault.ith || Infinity, prev: null, on: false, i: 0, act: null, cross: null, off: null, peak: 0, peakF: 0 } : null;
    L.sc = SC;
    if (P.plant === 'pm3' && MOT) {
      // СДПМ в осях d, q; нагрузочная машина: M_н = b (w - w_уст) + M_тр sign w + M_с
      IM = { pm: true, rs: MOT.rs, ld: MOT.ld, lq: MOT.lq, psi: MOT.psi, p: MOT.p, id: 0, iq: 0, te: 0, iph: [0, 0, 0] };
      plant.th = MOT.th0 || 0;
      if (MOT.wset === undefined) MOT.wset = 0;
      if (MOT.wsetT === undefined) MOT.wsetT = MOT.wset;
      var NL = Math.floor(NT / DEC) + 2;
      L.iS2 = new Float32Array(NL); L.psiS = new Float32Array(NL);
      L.thS = new Float32Array(NL); L.pmS = new Float32Array(NL); L.teS = new Float32Array(NL); L.idS = new Float32Array(NL); L.iqS = new Float32Array(NL);
    }
    if (P.plant === 'im3' && MOT) {
      IM = { rs: MOT.rs, rr: MOT.rr, lm: MOT.lm, ls: MOT.lls + MOT.lm, lr: MOT.llr + MOT.lm, p: MOT.p, sa: 0, sb: 0, ra: 0, rb: 0, te: 0, iph: [0, 0, 0] };
      IM.D = IM.ls * IM.lr - IM.lm * IM.lm;
      L.iS2 = new Float32Array(Math.floor(NT / DEC) + 2); L.psiS = new Float32Array(Math.floor(NT / DEC) + 2);
    }

    function recfg() {
      var cs = S.CpuSysRegs, gp = S.GpioCtrlRegs;
      C.sync = (cs.PCLKCR0 >>> 18) & 1;
      var AD = S.AdcaRegs;
      C.adcPwr = (AD.ADCCTL1 >> 7) & 1; C.pulsePos = (AD.ADCCTL1 >> 2) & 1;
      var pres = AD.ADCCTL2 & 0xF; C.adcDiv = pres === 1 ? 0 : 1 + pres / 2;
      C.int1sel = AD.ADCINTSEL1N2 & 0xF; C.int1e = (AD.ADCINTSEL1N2 >> 5) & 1; C.int1cont = (AD.ADCINTSEL1N2 >> 6) & 1;
      C.soc = [];
      for (var q = 0; q < 4; q++) { var sc = AD['ADCSOC' + q + 'CTL']; C.soc.push({ acqps: sc & 0x1FF, ch: (sc >>> 15) & 0xF, trig: (sc >>> 20) & 0x1F }); }
      C.mux0 = gp.GPAMUX1 & 3; C.mux1 = (gp.GPAMUX1 >> 2) & 3;
      C.pud0 = gp.GPAPUD & 1; C.pud1 = (gp.GPAPUD >> 1) & 1;
      C.x1 = S.InputXbarRegs.INPUT1SELECT;
      C.x1mux = C.x1 < 16 ? (gp.GPAMUX1 >>> (C.x1 * 2)) & 3 : 0;
      C.x1pu = C.x1 < 32 ? !((gp.GPAPUD >>> C.x1) & 1) : false;
      C.x1out = C.x1 < 32 ? (gp.GPADIR >>> C.x1) & 1 : 0;
      C.anyTz = false;
      MODS.forEach(function (md) {
        var c = md.C, e = md.E, m = md.M, n = md.n;
        c.clk = (cs.PCLKCR2 >>> (n - 1)) & 1;
        c.sync = C.sync;
        var tb = e.TBCTL;
        c.ctrmode = tb & 3; c.phsen = (tb >> 2) & 1; c.prdld = (tb >> 3) & 1; c.syncosel = (tb >> 4) & 3; c.phsdir = (tb >> 13) & 1;
        c.div = HSP[(tb >> 7) & 7] * (1 << ((tb >> 10) & 7)) * (st.sysInit ? 1 : 20);
        var cc = e.CMPCTL; c.loadamode = cc & 3; c.shdwamode = (cc >> 4) & 1;
        c.aqa = e.AQCTLA; c.aqb = e.AQCTLB;
        var db = e.DBCTL; c.outmode = db & 3; c.polsel = (db >> 2) & 3; c.inmode = (db >> 4) & 3;
        c.dbred = e.DBRED & 0x3FFF; c.dbfed = e.DBFED & 0x3FFF;
        c.tza = e.TZCTL & 3; c.tzb = (e.TZCTL >> 2) & 3;
        c.intsel = e.ETSEL & 7; c.inten = (e.ETSEL >> 3) & 1; c.intprd = e.ETPS & 3;
        c.socasel = (e.ETSEL >> 8) & 7; c.socaen = (e.ETSEL >> 11) & 1; c.socaprd = (e.ETPS >> 8) & 3;
        var tzs = e.TZSEL; c.ost1 = (tzs >> 8) & 1; c.cbc1 = tzs & 1;
        if (c.ost1 || c.cbc1) C.anyTz = true;
        c.muxA = (gp.GPAMUX1 >>> ((2 * n - 2) * 2)) & 3; c.muxB = (gp.GPAMUX1 >>> ((2 * n - 1) * 2)) & 3;
        c.pudA = (gp.GPAPUD >>> (2 * n - 2)) & 1; c.pudB = (gp.GPAPUD >>> (2 * n - 1)) & 1;
        if (c.prdld === 1) m.prdA = e.TBPRD;
        if (c.shdwamode === 1) m.cmpA = (e.CMPA >>> 16) & 0xFFFF;
        var running = !!(c.clk && c.sync && c.ctrmode !== 3);
        if (running !== c.running) {
          if (n === 1) L.ctrV.push(st.tick, e.TBCTR);
          m.lastD = NaN; m.prevStepTick = st.tick;
          c.running = running;
        }
      });
      C.clk = MODS[0].C.clk;
      cmpCfg();
      if (ENC) qepCfg();
      st.cfgDirty = false;
    }

    function aqAct(cur, act) { return act === 1 ? 0 : act === 2 ? 1 : act === 3 ? (cur ^ 1) : cur; }

    function tbStep(md) {
      var E = md.E, C = md.C, M = md.M, n = md.n, first = n === 1;
      var old = E.TBCTR, prd = M.prdA, c, up;
      if (M.syncIn) {
        M.syncIn = false;
        if (C.phsen) { E.TBCTR = old = (E.TBPHS >>> 16) & 0xFFFF; if (C.ctrmode === 2) M.dirUp = C.phsdir ? 1 : 0; }
      }
      if (C.ctrmode === 0) { c = old >= prd ? 0 : old + 1; up = 1; }
      else if (C.ctrmode === 1) { c = old === 0 ? prd : old - 1; up = 0; }
      else {
        if (prd === 0) { c = 0; }
        else if (M.dirUp) { if (old >= prd) { M.dirUp = 0; c = old - 1; } else c = old + 1; }
        else { if (old === 0) { M.dirUp = 1; c = 1; } else c = old - 1; }
        up = c > old ? 1 : 0;
      }
      E.TBCTR = c;
      if (first) {
        var d = c - old;
        if (d !== M.lastD) { L.ctrV.push(M.prevStepTick, old); M.lastD = d; }
        M.prevStepTick = st.tick;
      }

      if (prd === 0) {
        if (E.TBPRD !== 0 && c === 0) { M.prdA = prd = E.TBPRD; }   // загрузка тени при TBCTR = 0
        else {
          warnOnce('prd0:' + n, 'warn', 'EPwm' + n + 'Regs.TBPRD = 0: период не задан, счетчик ePWM' + n + ' стоит на нуле, событий и прерываний нет.');
          M.dbA = M.aqA; M.dbB = M.aqB;
          return;
        }
      }
      var zero = c === 0, atPrd = c === prd && prd > 0;
      if (C.ctrmode === 2) { if (zero) up = 1; else if (atPrd) up = 0; }

      if (first && atPrd) L.prdT.push(st.tick);
      if (zero) {
        if (first) { L.zeroT.push(st.tick); st.tbSteps++; } else if (n === 2) L.zeroT2.push(st.tick); else if (n === 3) L.zeroT3.push(st.tick);
        if (C.prdld === 0) M.prdA = E.TBPRD;
        if (!st.cbcActive && !st.dcCbc) { E.TZFLG &= ~2; E.TZCBCFLG = 0; }   // циклическая авария снимается в начале периода
        if (C.syncosel === 1 && n < NMOD) MODS[n].M.syncIn = true;
      }
      var cmpSh = (E.CMPA >>> 16) & 0xFFFF;
      if (C.shdwamode === 1) M.cmpA = cmpSh;
      else {
        var lm = C.loadamode;
        if ((zero && (lm === 0 || lm === 2)) || (atPrd && (lm === 1 || lm === 2))) M.cmpA = cmpSh;
      }
      if (first) {
        if (M.cmpA !== L.lastCmp) { L.cmpEv.push(st.tick, M.cmpA); L.lastCmp = M.cmpA; }
        if (M.prdA !== L.lastPrd) { L.prdEv.push(st.tick, M.prdA); L.lastPrd = M.prdA; }
      }

      // формирователь выходов
      var q = C.aqa, a = M.aqA, eq = c === M.cmpA;
      if (zero) a = aqAct(a, q & 3);
      if (atPrd) a = aqAct(a, (q >> 2) & 3);
      if (eq) a = up ? aqAct(a, (q >> 4) & 3) : aqAct(a, (q >> 6) & 3);
      M.aqA = a;
      var qb = C.aqb, b = M.aqB;
      if (zero) b = aqAct(b, qb & 3);
      if (atPrd) b = aqAct(b, (qb >> 2) & 3);
      if (eq) b = up ? aqAct(b, (qb >> 4) & 3) : aqAct(b, (qb >> 6) & 3);
      M.aqB = b;

      // мертвое время
      var redIn = (C.inmode & 1) ? M.aqB : M.aqA;
      var fedIn = (C.inmode & 2) ? M.aqB : M.aqA;
      if (redIn) { if (!M.redPrev) M.hi = 0; else if (M.hi < 1e9) M.hi++; }
      M.redPrev = redIn;
      if (!fedIn) { if (M.fedPrev) M.lo = 0; else if (M.lo < 1e9) M.lo++; }
      M.fedPrev = fedIn;
      var red = (redIn && M.hi >= C.dbred) ? 1 : 0;
      var fed = (fedIn || M.lo < C.dbfed) ? 1 : 0;
      M.dbA = (C.outmode & 2) ? (red ^ (C.polsel & 1)) : M.aqA;
      M.dbB = (C.outmode & 1) ? (fed ^ ((C.polsel >> 1) & 1)) : M.aqB;

      // запуск АЦП и прерывание
      var sel = C.intsel;
      var ev = (sel === 1 && zero) || (sel === 2 && atPrd) || (sel === 3 && (zero || atPrd)) ||
        (sel === 4 && eq && up) || (sel === 5 && eq && !up);
      if (C.socaen && C.socaprd > 0) {
        var ss = C.socasel;
        var evs = (ss === 1 && zero) || (ss === 2 && atPrd) || (ss === 3 && (zero || atPrd)) || (ss === 4 && eq && up) || (ss === 5 && eq && !up);
        var trg = 5 + 2 * (n - 1);
        if (evs && ++M.socCnt >= C.socaprd) { M.socCnt = 0; E.ETFLG |= 4; for (var sk = 0; sk < 4; sk++) if (GC.soc[sk].trig === trg) adcQueue(sk, false); }
      }
      if (ev && C.inten && C.intprd > 0) {
        if (E.ETFLG & 1) { if (first) st.etSupp++; }
        else {
          M.etCnt++;
          if (M.etCnt >= C.intprd) { M.etCnt = 0; E.ETFLG |= 1; S.PieCtrlRegs.PIEIFR3 |= (1 << (n - 1)); }
        }
        E.ETPS = (E.ETPS & ~0xC) | (M.etCnt << 2);
      }
    }
    var GC = C;

    /* ---- вход аварии TZ1 через Input X-BAR ---- */
    var rng = (function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(P.seed);
    var glitches = [];   // помехи на плавающем входе: [начало, конец] в тактах
    (function () { var t = Math.round((1 + 4 * rng()) * 1e-3 * BASE_HZ); while (t < NT) { var d = Math.round((0.5 + 2.5 * rng()) * 1e-6 * BASE_HZ); glitches.push(t, t + d); t += Math.round((0.6 + 5 * rng()) * 1e-3 * BASE_HZ); } })();
    var gIdx = 0, lastPin = -1;
    var faultsT = P.faults.map(function (f) { return { pin: f.pin, a: Math.round(f.t0 * BASE_HZ), b: Math.round(f.t1 * BASE_HZ) }; });
    L.pinEd = [];
    function pinLevel(p) {
      if (p < 2 * NMOD && C.x1mux === 1) { var mdp = MODS[p >> 1]; var lv0 = (p & 1) ? mdp.M.lastPB : mdp.M.lastPA; return lv0 === 1 ? 1 : 0; }
      if (C.x1mux !== 0) return 1;
      if (C.x1out) return 0;                       // вывод настроен как выход, GPADAT = 0
      for (var k = 0; k < faultsT.length; k++) { var f = faultsT[k]; if (f.pin === p && st.tick >= f.a && st.tick < f.b) return 0; }
      if (C.x1pu) return 1;
      while (gIdx < glitches.length && glitches[gIdx + 1] < st.tick) gIdx += 2;
      if (gIdx < glitches.length && st.tick >= glitches[gIdx]) {
        warnOnce('float', 'warn', 'Вход аварии GPIO' + p + ' без подтяжки: линия nFAULT с открытым стоком не подтянута к питанию, помехи вызывают ложные срабатывания. Подтяжку включает GpioCtrlRegs.GPAPUD.bit.GPIO' + p + ' = 0.');
        return 0;
      }
      return 1;
    }
    function tzInput() {
      var lv = pinLevel(C.x1);
      if (lv !== lastPin) { L.pinEd.push(st.tick, lv); lastPin = lv; }
      st.cbcActive = false;
      MODS.forEach(function (md) {
        var c = md.C, e = md.E, sfx = md.n === 1 ? '' : ':' + md.n;
        if (c.cbc1 && lv === 0) st.cbcActive = true;
        if (lv !== 0) return;
        if (c.ost1) e.TZOSTFLG |= 1;
        if (c.ost1 && !(e.TZFLG & 4)) {
          e.TZFLG |= 5;
          L.tzEv.push(st.tick, 'TZ1' + sfx);
          if (st.tripTick === null) {
            st.tripTick = st.tick; st.tripSrc = 'TZ1';
            msg('info', 'Аварийное отключение по входу TZ1 (Input X-BAR INPUT1 = GPIO' + C.x1 + '), однократное, с защелкой.');
          }
        }
        if (c.cbc1 && !(e.TZFLG & 2)) {
          e.TZFLG |= 3;
          if (st.cbcTick === undefined) { st.cbcTick = st.tick; msg('info', 'Циклическое отключение по входу TZ1 (GPIO' + C.x1 + '): выходы вернутся в начале периода, когда сигнал аварии снимется.'); }
        }
      });
    }

    /* ---- датчик тока и АЦП A ---- */
    var SN = P.sense;
    var amp = { v: SN ? 1.65 + (SN.voff || 0) : 0 }, capV = 0, lastEdge = -1e9;
    var ampN = SN && SN.chans ? SN.chans.map(function (q) { return 1.65 + q.voff; }) : null;
    var adcQ = [], adcCur = null;
    var kAmp = SN ? 1 - Math.exp(-DT / (SN.tauAmp || 0.25e-6)) : 0;
    var ringA = SN && (SN.type === 'hall' || SN.type === 'hall2') ? 0.025 : 0.22;
    if (SN) { L.csS = new Float32Array(Math.floor(NT / DEC) + 2); }
    function gauss() { var u = 1 - rng(), w = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); }
    function adcReady() {
      if (!C.adcPwr || st.adcPwrTick === null) return false;
      if (st.adcPwrTick === 0 && st.adcPwrDelay !== null && st.mainDelayUs - st.adcPwrDelay >= 500) return true;
      return st.tick - st.adcPwrTick >= 500e-6 * BASE_HZ;
    }
    function adcQueue(k, forced) {
      if (st.cfgDirty || !C.soc) recfg();
      adcQ.push({ soc: k, forced: forced, tReq: st.tick });
      if (!adcCur) adcStart();
    }
    function adcStart() {
      var q = adcQ.shift(); if (!q) return;
      var sc = C.soc[q.soc];
      var tw = (sc.acqps + 1) * 5e-9;                                // окно выборки, (ACQPS + 1) тактов SYSCLK
      var div = C.adcDiv || 1;
      var tconv = 10.5 * div * 5e-9;                                // 10,5 тактов ADCCLK на 12 бит
      adcCur = { soc: q.soc, ch: sc.ch, acqps: sc.acqps, t0: st.tick, tS: st.tick + Math.max(1, Math.round(tw * BASE_HZ)), tE: 0, tw: tw, done: false };
      adcCur.tE = adcCur.tS + Math.max(1, Math.round(tconv * BASE_HZ));
    }
    // помехи при переключениях стойки, к которой подключен датчик
    var SP = P.spike ? { durT: Math.round(P.spike.dur * BASE_HZ), tailT: Math.max(1, Math.round((P.spike.tail || 20e-9) * BASE_HZ)), amp: P.spike.amp, t: [-1e9, -1e9, -1e9], sg: [0, 0, 0], lvl: [-1, -1, -1] } : null;
    function spikeV(ph) {
      if (!SP) return 0;
      var d = st.tick - SP.t[ph];
      if (d < SP.durT) return SP.amp * SP.sg[ph];
      d -= SP.durT;
      return d < 8 * SP.tailT ? SP.amp * SP.sg[ph] * Math.exp(-d / SP.tailT) : 0;
    }
    function nodeV(ch, noSpike) {                      // напряжение на входе ADCINA<ch>; помехи - только для компараторов
      if (SN && SN.chans) {
        for (var cq = 0; cq < SN.chans.length; cq++) if (SN.chans[cq].ch === ch) {
          var dq = (st.tick - lastEdge) * DT, rq = 0;
          if (dq < 3e-6) rq = ringA * Math.exp(-dq / 0.35e-6) * Math.cos(2 * Math.PI * 7e6 * dq);
          return Math.min(3.3, Math.max(0, ampN[cq] + rq + (noSpike ? 0 : spikeV(SN.chans[cq].ph))));
        }
        return 0.01;
      }
      return 0.01;
    }
    function chanV(ch) {
      if (SN && SN.chans) return nodeV(ch, true);
      if (SN && ch === SN.ch) {
        var d = (st.tick - lastEdge) * DT, ring = 0;
        if (d < 3e-6) ring = ringA * Math.exp(-d / 0.35e-6) * Math.cos(2 * Math.PI * 7e6 * d);
        return Math.min(3.3, Math.max(0, amp.v + ring));
      }
      return 0.01;
    }
    function adcStep() {
      var c = adcCur;
      if (!c.sampled && st.tick >= c.tS) {
        c.sampled = true;
        var vin = chanV(c.ch);
        var tau = SN && (c.ch === SN.ch || (SN.chans && SN.chans.some(function (q) { return q.ch === c.ch; }))) ? SN.tauS : 20e-9;
        capV = capV + (vin - capV) * (1 - Math.exp(-c.tw / tau));
        c.vs = capV;
        if (c.acqps < 14) warnOnce('acqps', 'warn', 'ADCSOC' + c.soc + 'CTL.ACQPS = ' + c.acqps + ': окно выборки ' + Math.round(c.tw * 1e9) + ' нс меньше минимального 75 нс (ACQPS >= 14) для 12-разрядного режима.');
        if (!C.pulsePos) adcFlag(c.soc);
        var tm = SN ? currentAt(c.ch) : 0;
        L.adcS.push(c.t0, st.tick, tm, c.ch, Math.round(c.tw * 1e9), c.soc);
      }
      if (st.tick >= c.tE) {
        var code;
        if (!adcReady()) { code = 0; warnOnce('adcready', 'warn', 'Преобразование АЦП до окончания включения: после ADCPWDNZ = 1 требуется пауза не менее 500 мкс (DELAY_US(1000) в примерах C2000Ware). Результат недостоверен.'); }
        else {
          var vv = c.vs + gauss() * 0.0011;
          if (!C.adcDiv || C.adcDiv < 4) { warnOnce('adcclk', 'warn', 'ADCCLK = ' + (C.adcDiv ? (200 / C.adcDiv).toFixed(0) : '?') + ' МГц превышает допустимые 50 МГц: задайте ADCCTL2.PRESCALE = 6 (деление на 4). Результаты недостоверны.'); vv += gauss() * 0.15; }
          code = Math.max(0, Math.min(4095, Math.floor(vv / 3.3 * 4096)));
        }
        S.AdcaResultRegs['ADCRESULT' + c.soc] = code;
        L.adcS.push(code);
        if (C.pulsePos) adcFlag(c.soc);
        adcCur = null;
        if (adcQ.length) adcStart();
      }
    }
    function adcFlag(soc) {
      var AD = S.AdcaRegs;
      if (!C.int1e || C.int1sel !== soc) return;
      if (AD.ADCINTFLG & 1) { if (!C.int1cont) { AD.ADCINTOVF |= 1; warnOnce('adcovf', 'warn', 'Переполнение ADCINT1: новое преобразование завершилось, а флаг ADCINTFLG.ADCINT1 не сброшен. Прерывания от АЦП прекратились: в обработчике нет AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1.'); return; } }
      AD.ADCINTFLG |= 1;
      S.PieCtrlRegs.PIEIFR1 |= 1;
    }
    var curI = 0;
    function currentAt(ch) {
      if (SN && SN.chans && IM) { for (var cq = 0; cq < SN.chans.length; cq++) if (SN.chans[cq].ch === ch) return IM.pm ? ITOT[SN.chans[cq].ph] : IM.iph[SN.chans[cq].ph]; return 0; }
      return curI;
    }

    /* ---- инкрементальный энкодер и модуль eQEP1 ---- */
    var ENC = P.encoder && MOT ? P.encoder : null;
    var enc = null, QC = { on: false };
    if (ENC) {
      var er = (function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(ENC.seed || 7);
      var lerr = new Float32Array(ENC.lines);
      for (var li = 0; li < ENC.lines; li++) lerr[li] = (er() * 2 - 1) * (ENC.lerr || 0);
      enc = { cpr: 4 * ENC.lines, k: 4 * ENC.lines / (2 * Math.PI), c: 0, lerr: lerr, qerr: ENC.qerr || 0, ecc: ENC.ecc || 0, eccPh: er() * 6.283, capAcc: 0, upCnt: 0, lastDir: 0, upDir: 0, counted: 0, ignored: 0, coef: 0, firstIndex: false, edges: 0 };
      L.qepUp = [];
    }
    function encOff(k) { var n = enc.cpr; var li = ((k >> 2) % ENC.lines + ENC.lines) % ENC.lines; return enc.qerr * ((k & 1) ? 0.5 : -0.5) + enc.lerr[li]; }
    function qepCfg() {
      var Q = S.EQep1Regs, gp = S.GpioCtrlRegs;
      QC.clk = (S.CpuSysRegs.PCLKCR4 & 1) === 1;
      QC.muxA = (gp.GPAMUX2 >>> 8) & 3; QC.muxB = (gp.GPAMUX2 >>> 10) & 3; QC.muxI = (gp.GPAMUX2 >>> 14) & 3;
      QC.gmux = ((gp.GPAGMUX2 >>> 8) & 0xF) !== 0;
      var dc = Q.QDECCTL, ct = Q.QEPCTL, cp = Q.QCAPCTL;
      QC.qsrc = (dc >> 14) & 3; QC.xcr = (dc >> 11) & 1; QC.swap = (dc >> 10) & 1; QC.inv = ((dc >> 8) & 1) ^ ((dc >> 7) & 1);
      QC.qpen = (ct >> 3) & 1; QC.pcrm = (ct >> 12) & 3; QC.ute = (ct >> 1) & 1; QC.qclm = (ct >> 2) & 1;
      QC.cen = (cp >> 15) & 1; QC.ccps = (cp >> 4) & 7; QC.upps = cp & 0xF;
      QC.pins = QC.muxA === 1 && QC.muxB === 1 && !QC.gmux;
      QC.on = QC.clk;
    }
    function qepInt() { var Q = S.EQep1Regs; if (!(Q.QFLG & 1)) { Q.QFLG |= 1; S.PieCtrlRegs.PIEIFR5 |= 1; } }
    function qepEdge(dir, k) {
      enc.edges++;
      if (!QC.on) return;
      if (!QC.pins) { enc.ignored++; if (enc.ignored > 50) warnOnce('qepmux', 'warn', 'Сигналы энкодера не поступают в eQEP1: выводы GPIO20 и GPIO21 не подключены к EQEP1A и EQEP1B (GpioCtrlRegs.GPAMUX2.bit.GPIO20 = 1, GPIO21 = 1).'); return; }
      if (!QC.qpen) { enc.ignored++; if (enc.ignored > 50) warnOnce('qepen', 'warn', 'Счетчик положения eQEP1 выключен: EQep1Regs.QEPCTL.bit.QPEN = 0.'); return; }
      var Q = S.EQep1Regs;
      if (QC.qsrc !== 0) { warnOnce('qsrc', 'warn', 'EQep1Regs.QDECCTL.bit.QSRC = ' + QC.qsrc + ': выбран режим счета по направлению или по одному каналу; для квадратурного энкодера нужен QSRC = 0.'); }
      var d = dir * (QC.swap ? -1 : 1) * (QC.inv ? -1 : 1);
      if (QC.qsrc === 2) d = 1; else if (QC.qsrc === 3) d = -1;
      if (QC.qsrc === 1 && (k & 1)) return;
      if (QC.xcr && (k & 1)) { Q.QEPSTS = d > 0 ? (Q.QEPSTS | 0x20) : (Q.QEPSTS & ~0x20); return; }
      var mx = Q.QPOSMAX >>> 0, pc = Q.QPOSCNT >>> 0;
      if (mx === 0) warnOnce('qposmax', 'warn', 'EQep1Regs.QPOSMAX = 0: счетчик положения сбрасывается на каждом шаге и не считает. Задайте QPOSMAX (обычно 0xFFFFFFFF).');
      if (d > 0) pc = pc >= mx ? 0 : pc + 1; else pc = pc === 0 ? mx : pc - 1;
      Q.QPOSCNT = pc >>> 0;
      if ((d > 0) !== (enc.lastDir > 0) && enc.lastDir !== 0) Q.QFLG |= 0x8;
      enc.lastDir = d;
      Q.QEPSTS = d > 0 ? (Q.QEPSTS | 0x20) : (Q.QEPSTS & ~0x20);
      enc.counted++;
      if (QC.cen) {
        if (enc.upDir !== 0 && enc.upDir !== d) Q.QEPSTS |= 0x4;
        enc.upDir = d;
        if (++enc.upCnt >= (1 << QC.upps)) {
          enc.upCnt = 0; Q.QCPRD = Q.QCTMR; Q.QCTMR = 0; Q.QEPSTS |= 0x80; enc.upDir = 0;
          if (L.qepUp.length < 400000) L.qepUp.push(st.tick);
        }
      }
    }
    function qepIndex(fwd) {
      if (!QC.on || QC.muxI !== 1 || !QC.qpen) return;
      var Q = S.EQep1Regs;
      Q.QPOSILAT = Q.QPOSCNT; Q.QEPSTS |= 0x40; Q.QFLG |= 0x400;
      if (QC.pcrm === 0 || (QC.pcrm === 2 && !enc.firstIndex)) { Q.QPOSCNT = fwd ? 0 : Q.QPOSMAX >>> 0; }
      enc.firstIndex = true;
    }
    function qepTick() {
      var Q = S.EQep1Regs;
      if (QC.ute && Q.QUPRD > 0) {
        Q.QUTMR = (Q.QUTMR + 2) >>> 0;
        if (Q.QUTMR >= Q.QUPRD) {
          Q.QUTMR = 0; Q.QFLG |= 0x800;
          if (QC.qclm) { Q.QPOSLAT = Q.QPOSCNT; Q.QCTMRLAT = Q.QCTMR; Q.QCPRDLAT = Q.QCPRD; }
          if (QC.pcrm === 3) { Q.QPOSLAT = Q.QPOSCNT; Q.QPOSCNT = 0; }
          if (Q.QEINT & 0x800) qepInt();
        }
      }
      if (QC.cen) {
        enc.capAcc += 2; var dv = 1 << QC.ccps;
        while (enc.capAcc >= dv) { enc.capAcc -= dv; if (Q.QCTMR < 0xFFFF) Q.QCTMR++; else { if (!(Q.QEPSTS & 8)) enc.coef++; Q.QEPSTS |= 8; } }
      }
    }
    function encStep() {
      var th = plant.th, x = (th + enc.ecc * Math.sin(th + enc.eccPh)) * enc.k, c = enc.c, g = 0;
      if (!enc.init) { enc.init = true; c = Math.floor(x); while (x >= c + 1 + encOff(c + 1)) c++; while (x < c + encOff(c)) c--; enc.c = c; return; }
      while (x >= c + 1 + encOff(c + 1) && g++ < 8) { c++; qepEdge(1, c); if (((c % enc.cpr) + enc.cpr) % enc.cpr === 0) qepIndex(true); }
      while (x < c + encOff(c) && g++ < 16) { if (((c % enc.cpr) + enc.cpr) % enc.cpr === 0) qepIndex(false); c--; qepEdge(-1, c + 1); }
      enc.c = c;
    }

    function tzv(mode, v) { return mode === 0 ? 2 : mode === 1 ? 1 : mode === 2 ? 0 : v; }

    /* ---- компараторы CMPSS, ePWM X-BAR, цифровое сравнение ePWM ---- */
    // входы компараторов F2837xD: CMPINxP / CMPINxN (номер канала АЦП A; -1 - вывод другого АЦП)
    var CMP_P = [2, 4, -1, 14, -1, -1, -1, -1], CMP_N = [3, 5, -1, 15, -1, -1, -1, -1];
    var CMP_PIN = ['ADCINA2', 'ADCINA4', 'ADCINB2', 'ADCIN14', 'ADCINC4', 'ADCINC2', 'ADCIND0', 'ADCIND2'];
    var TRIPS = [4, 5, 7, 8, 9, 10, 11, 12];
    var CMP_DLY = 3;                                   // задержка компаратора, такты (30 нс)
    function newFilt() { return { buf: [], ones: 0, out: 0, latch: 0, pc: 0 }; }
    var CS = [];
    for (var ck = 0; ck < 8; ck++) CS.push({ n: ck + 1, on: false, f: [newFilt(), newFilt()], init: [false, false], raw: [0, 0], q: [0, 0], as: [0, 0], ct: [0, 0] });
    var XB = { trip: {}, cfg: [] }, DCS = { prev: [] };
    TRIPS.forEach(function (t) { XB.trip[t] = 0; });
    st.dcCbc = false;
    function cmpCfg() {
      C.anyCmp = false; C.anyDc = false;
      var clk14 = S.CpuSysRegs.PCLKCR14;
      CS.forEach(function (c, k) {
        var R = S['Cmpss' + (k + 1) + 'Regs'], ct = R.COMPCTL;
        c.on = !!(((clk14 >>> k) & 1) && (ct >> 15) & 1);
        if (!c.on) return;
        C.anyCmp = true;
        c.src = [ct & 1, (ct >> 8) & 1]; c.inv = [(ct >> 1) & 1, (ct >> 9) & 1]; c.sel = [(ct >> 2) & 3, (ct >> 10) & 3]; c.asy = [(ct >> 6) & 1, (ct >> 14) & 1];
        c.hys = Math.min(4, R.COMPHYSCTL & 7) * 12 * 3.3 / 4096;
        var dc = R.COMPDACCTL; c.ref = (dc >> 5) & 1; c.dsrc = dc & 1;
        if (c.ref) warnOnce('selref' + k, 'warn', 'Cmpss' + (k + 1) + 'Regs.COMPDACCTL.bit.SELREF = 1: опорное напряжение ЦАП с вывода VDAC, который на стенде не подключен; уставки равны нулю. Опорное напряжение VDDA задает SELREF = 0.');
        if (c.dsrc) warnOnce('dsrc' + k, 'warn', 'Cmpss' + (k + 1) + 'Regs.COMPDACCTL.bit.DACSOURCE = 1: код ЦАП от генератора пилообразного сигнала, который в модели не используется; уставка верхнего компаратора равна нулю.');
        ['CTRIPHFIL', 'CTRIPLFIL'].forEach(function (nm, j) {
          var fc = R[nm + 'CTL'], f = c.f[j];
          var w = ((fc >> 4) & 0x1F) + 1, th = ((fc >> 9) & 0x1F) + 1, pr = (R[nm + 'CLKCTL'] & 0x3FF) + 1;
          if (w !== f.w) { f.buf = []; f.ones = 0; }
          f.w = w; f.th = th; f.pr = pr;
          if ((c.sel[j] >= 2) && th > w) warnOnce('filt' + k + j, 'warn', 'Cmpss' + (k + 1) + 'Regs.' + nm + 'CTL: THRESH + 1 = ' + th + ' больше окна SAMPWIN + 1 = ' + w + ', выход фильтра никогда не изменится.');
          if ((c.sel[j] >= 2) && 2 * th <= w) warnOnce('filtm' + k + j, 'warn', 'Cmpss' + (k + 1) + 'Regs.' + nm + 'CTL: порог THRESH + 1 = ' + th + ' не больше половины окна ' + w + ': условие мажоритарного голосования THRESH > SAMPWIN / 2 не выполнено.');
        });
      });
      var X = S.EPwmXbarRegs;
      XB.cfg = TRIPS.map(function (t, i) {
        var en = X['TRIP' + t + 'MUXENABLE'] >>> 0, lo = X['TRIP' + t + 'MUX0TO15CFG'] >>> 0, list = [];
        for (var m = 0; m < 16; m++) if ((en >>> m) & 1) list.push([m, (lo >>> (2 * m)) & 3]);
        for (var m2 = 16; m2 < 32; m2++) if ((en >>> m2) & 1) warnOnce('xmux' + t + m2, 'warn', 'EPwmXbarRegs.TRIP' + t + 'MUXENABLE.bit.MUX' + m2 + ': мультиплексоры 16..31 (события ADC, ECAP, EXTSYNCOUT) в модели не используются.');
        return { t: t, list: list, inv: (X.TRIPOUTINV >>> i) & 1 };
      });
      MODS.forEach(function (md) {
        var e = md.E, c = md.C;
        var ts = e.TZSEL, ds = e.DCTRIPSEL, zd = e.TZDCSEL;
        c.dcSel = [ds & 15, (ds >> 4) & 15, (ds >> 8) & 15, (ds >> 12) & 15];
        c.dcEvt = [zd & 7, (zd >> 3) & 7, (zd >> 6) & 7, (zd >> 9) & 7];   // DCAEVT1, DCAEVT2, DCBEVT1, DCBEVT2
        c.dcOst = [(ts >> 14) & 1, (ts >> 15) & 1]; c.dcCbcSel = [(ts >> 6) & 1, (ts >> 7) & 1];
        c.dcAsync = [(e.DCACTL >> 1) & 1, (e.DCACTL >> 9) & 1, (e.DCBCTL >> 1) & 1, (e.DCBCTL >> 9) & 1];
        if (c.dcEvt.some(function (x) { return x; })) C.anyDc = true;
        c.dcSel.forEach(function (sv) { if (sv === 15) warnOnce('dcomb', 'warn', 'DCTRIPSEL = 15 (комбинация входов через DCAHTRIPSEL) в модели не используется; выберите один вход TRIPINn.'); });
      });
    }
    function filtStep(f, x) {
      f.pc += 2;                                         // SYSCLK = 2 такта модели
      while (f.pc >= f.pr) {
        f.pc -= f.pr;
        f.buf.push(x); f.ones += x;
        if (f.buf.length > f.w) f.ones -= f.buf.shift();
        if (f.ones >= f.th) f.out = 1; else if (f.buf.length - f.ones >= f.th) f.out = 0;
        if (f.out) f.latch = 1;
      }
    }
    function trinIn(n) {                                 // сигнал TRIPINn
      if (n === 1) return lastPin < 0 ? 1 : lastPin;
      if (n === 2 || n === 3) return 1;
      return XB.trip[n] !== undefined ? XB.trip[n] : 0;
    }
    function dcStep() {
      if (C.anyCmp) CS.forEach(function (c, k) {
        if (!c.on) return;
        var R = S['Cmpss' + (k + 1) + 'Regs'];
        var vp = CMP_P[k] >= 0 ? nodeV(CMP_P[k]) : 0;
        var dac = [c.ref || c.dsrc ? 0 : R.DACHVALA * 3.3 / 4096, c.ref ? 0 : R.DACLVALA * 3.3 / 4096];
        for (var j = 0; j < 2; j++) {
          var vn = c.src[j] ? (CMP_N[k] >= 0 ? nodeV(CMP_N[k]) : 0) : dac[j];
          var raw = c.raw[j] ? (vp > vn - c.hys ? 1 : 0) : (vp > vn ? 1 : 0);
          c.raw[j] = raw;
          c.q[j] = ((c.q[j] << 1) | (raw ^ c.inv[j])) & ((1 << CMP_DLY) - 1);
          var a = (c.q[j] >> (CMP_DLY - 1)) & 1; c.as[j] = a;
          var f = c.f[j];
          if (c.init[j]) { c.init[j] = false; f.buf = []; for (var b = 0; b < f.w; b++) f.buf.push(a); f.ones = a * f.w; f.out = a; }
          filtStep(f, a);
          var sel = c.sel[j], o = sel <= 1 ? a : sel === 2 ? f.out : f.latch;
          if (c.asy[j]) o |= a;
          c.ct[j] = o;
        }
        R.COMPSTS = c.f[0].out | (c.f[0].latch << 1) | (c.f[1].out << 8) | (c.f[1].latch << 9);
      });
      XB.cfg.forEach(function (x) {
        var v = 0;
        for (var q = 0; q < x.list.length && !v; q++) {
          var m = x.list[q][0], sel = x.list[q][1], c = CS[m >> 1];
          if ((m & 1) === 0) v = sel === 0 ? (c.on ? c.ct[0] : 0) : sel === 1 ? (c.on ? (c.ct[0] | c.ct[1]) : 0) : 0;
          else v = sel === 0 ? (c.on ? c.ct[1] : 0) : sel === 1 ? ((m >> 1) === 0 ? trinIn(1) : 0) : 0;
        }
        v ^= x.inv;
        if (v !== XB.trip[x.t]) { XB.trip[x.t] = v; L.tripEd.push(st.tick, x.t, v); }
      });
      st.dcCbc = false;
      if (!C.anyDc) return;
      MODS.forEach(function (md, mi) {
        var c = md.C, e = md.E, sfx = md.n === 1 ? '' : ':' + md.n, prev = DCS.prev[mi] || (DCS.prev[mi] = [0, 0, 0, 0]);
        var h = [trinIn(c.dcSel[0] + 1), trinIn(c.dcSel[2] + 1)], l = [trinIn(c.dcSel[1] + 1), trinIn(c.dcSel[3] + 1)];
        for (var q = 0; q < 4; q++) {
          var side = q >> 1, sel = c.dcEvt[q], H = h[side], Lo = l[side];
          var ev = sel === 1 ? !H : sel === 2 ? H : sel === 3 ? !Lo : sel === 4 ? Lo : sel === 5 ? (Lo && !H) : false;
          ev = ev ? 1 : 0;
          var act = c.dcAsync[q] ? ev : prev[q];       // синхронизация с TBCLK: задержка на такт
          prev[q] = ev;
          if (!act) continue;
          var nm = ['DCAEVT1', 'DCAEVT2', 'DCBEVT1', 'DCBEVT2'][q], flg = [8, 16, 32, 64][q];
          e.TZFLG |= flg;
          if (q === 0 || q === 2) {
            if (!c.dcOst[side]) continue;
            e.TZOSTFLG |= side ? 0x80 : 0x40;
            if (!(e.TZFLG & 4)) {
              e.TZFLG |= 5;
              L.tzEv.push(st.tick, nm + sfx);
              if (!st.dcMsg) { st.dcMsg = true; msg('info', 'Аварийное отключение по событию ' + nm + ' модуля ePWM' + md.n + ': ' + tripDesc(c.dcSel[side * 2 + (sel >= 3 ? 1 : 0)] + 1) + '; однократное, с защелкой.'); }
            }
          } else if (c.dcCbcSel[side]) {
            st.dcCbc = true; e.TZCBCFLG |= side ? 0x80 : 0x40;
            if (!(e.TZFLG & 2)) { e.TZFLG |= 3; L.tzEv.push(st.tick, nm + sfx); }
          }
        }
      });
    }
    function tripDesc(n) {
      if (n <= 3) return 'вход TRIPIN' + n + ' (TZ' + n + ')';
      var x = null; XB.cfg.forEach(function (z) { if (z.t === n) x = z; });
      if (!x || !x.list.length) return 'вход TRIPIN' + n;
      return 'вход TRIPIN' + n + ' ← ' + x.list.map(function (q) { var m = q[0], k = (m >> 1) + 1; return (m & 1) === 0 ? (q[1] === 0 ? 'CMPSS' + k + '.CTRIPH' : q[1] === 1 ? 'CMPSS' + k + '.CTRIPH_OR_CTRIPL' : 'MUX' + m) : (q[1] === 0 ? 'CMPSS' + k + '.CTRIPL' : q[1] === 1 ? 'INPUTXBAR' + k : 'MUX' + m); }).join(', ');
    }

    var res = null;   // результат фабрики

    function blockReason(sr) {
      var pc = S.PieCtrlRegs;
      if (st.IFR & sr.mask) {
        if (!(st.IER & sr.mask)) return 'Запрос ' + sr.vec + ' дошел до ядра, но группа INT' + sr.grp + ' не разрешена: в IER нет ' + sr.ierName + ' (IER |= ' + sr.ierName + ').';
        if (st.INTM) return 'Запрос ' + sr.vec + ' дошел до ядра, но прерывания глобально запрещены (INTM = 1): не выполнен EINT.';
        return null;
      }
      if (!(pc.PIECTRL & 1)) return 'Запрос ' + sr.vec + ' не проходит: блок PIE выключен (PIECTRL.ENPIE = 0). PIE включает InitPieVectTable().';
      if (!(pc[sr.ier] & 1)) return 'Запрос ' + sr.vec + ' не проходит: прерывание не разрешено в PIE (PieCtrlRegs.' + sr.ier + '.bit.INTx1 = 0).';
      if (pc.PIEACK & sr.ack) return 'Запрос ' + sr.vec + ' не проходит: группа ' + sr.grp + ' PIE ждет подтверждения. В обработчике нет записи PieCtrlRegs.PIEACK.all = ' + sr.ackName + '.';
      return null;
    }

    function callIsr(sr) {
      var fn = vect[sr.vec];
      if (fn === DEFAULTS[sr.vec]) {
        halt('default', 'Вызван обработчик по умолчанию ' + fn.name + '(): вектор не переназначен на ваш обработчик (PieVectTable.' + sr.vec + ' = &' + sr.isrName + '). На кристалле процессор остановится в этом обработчике на ESTOP0.');
        return;
      }
      if (typeof fn !== 'function') {
        halt('novect', 'Пришло прерывание ' + sr.vec + ', но в таблице векторов нет адреса обработчика: не вызвана InitPieVectTable() и не задан PieVectTable.' + sr.vec + '. На кристалле процессор перейдет по случайному адресу.');
        return;
      }
      st.INTM = 1; st.phase = 'isr'; st.guard = 0;
      try { fn(); }
      catch (e) {
        if (!(e && e.c2k && e.message === '__stop')) {
          msg('err', 'Ошибка в обработчике прерывания: ' + runtimeRu(e), errLine(e));
          halt('rt', 'Моделирование остановлено из-за ошибки в обработчике.');
        }
        return;
      }
      st.phase = 'run';
      st.INTM = 0; st.isrCount++; st.isrBy[sr.key]++; L.isrT.push(st.tick);
      if (st.lastIsr !== undefined && st.tick - st.lastIsr < 200) {
        if (++st.fastIsr > 50) { halt('fastisr', 'Прерывание вызывается чаще, чем раз в 2 мкс: процессор не успевает выполнять фоновую программу. Проверьте TBPRD, делители и выбор событий.'); return; }
      } else st.fastIsr = 0;
      st.lastIsr = st.tick;
      st.blockSince = 0;
      if ((P.traceVar || P.traceExtra.length) && res && res.vars) {
        var vs = res.vars();
        if (P.traceVar) { var vv = vs[P.traceVar]; L.varT.push(st.tick, typeof vv === 'number' ? vv : NaN); }
        for (var tx = 0; tx < P.traceExtra.length; tx++) { var xv = vs[P.traceExtra[tx]]; L.varX[P.traceExtra[tx]].push(st.tick, typeof xv === 'number' ? xv : NaN); }
      }
      if (sr.key === 'epwm' && (E.ETFLG & 1)) warnOnce('etclr', 'warn', 'Обработчик завершился, а флаг EPwm1Regs.ETFLG.INT остался установленным: нет записи EPwm1Regs.ETCLR.bit.INT = 1. Новых запросов прерывания от ePWM1 не будет.');
      if (sr.key === 'adc' && (S.AdcaRegs.ADCINTFLG & 1) && !C.int1cont) warnOnce('adcclr', 'warn', 'Обработчик завершился, а флаг AdcaRegs.ADCINTFLG.ADCINT1 остался установленным: нет записи AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1. Новых прерываний от АЦП не будет.');
      if (S.PieCtrlRegs.PIEACK & sr.ack) warnOnce(sr.key === 'epwm' ? 'ack' : 'ack1', 'warn', 'Обработчик завершился без подтверждения группы ' + sr.grp + ' (PieCtrlRegs.PIEACK.all = ' + sr.ackName + '). Следующие прерывания группы ' + sr.grp + ' будут заблокированы.');
      if (st.eallow) warnOnce('eallowisr', 'warn', 'Обработчик завершился в состоянии EALLOW: защита регистров не восстановлена (нет EDIS).');
    }

    function dispatch() {
      var pc = S.PieCtrlRegs, any = false;
      for (var k = 0; k < SRC.length; k++) {
        var sr = SRC[k];
        if (!(pc[sr.ifr] & 1)) continue;
        any = true;
        if ((pc.PIECTRL & 1) && (pc[sr.ier] & 1) && !(pc.PIEACK & sr.ack) && !(st.IFR & sr.mask)) { st.IFR |= sr.mask; pc.PIEACK |= sr.ack; }
        if ((st.IFR & sr.mask) && (st.IER & sr.mask) && !st.INTM) {
          st.IFR &= ~sr.mask; pc[sr.ifr] &= ~1;
          callIsr(sr);
          return;
        }
        if (!st.blockSince) st.blockSince = st.tick;
        else if (!st.blockReported && st.tick - st.blockSince > 20000) {
          var r = blockReason(sr);
          if (r) { msg('warn', r); st.blockReported = true; st.blockSrc = sr; }
        }
      }
    }

    function modOut(md) {
      var c = md.C, m = md.M, e = md.E;
      if (c.running) { if (++m.presc >= c.div) { m.presc = 0; tbStep(md); } }
      var a = m.dbA, b = m.dbB;
      if (!c.clk) { a = 0; b = 0; }
      if (e.TZFLG & 6) { a = tzv(c.tza, a); b = tzv(c.tzb, b); }
      var pa = c.muxA === 1 ? a : (c.pudA ? 2 : 1);
      var pb = c.muxB === 1 ? b : (c.pudB ? 2 : 1);
      if (pa !== m.lastPA) { md.ed.A.push(st.tick, pa); m.lastPA = pa; }
      if (pb !== m.lastPB) { md.ed.B.push(st.tick, pb); m.lastPB = pb; }
      m.outA = pa; m.outB = pb;
    }
    function shootCheck(hiOn, loOn, legName) {
      if (hiOn && loOn) {
        if (!L.inShoot) { L.inShoot = true; L.shoot.push(st.tick, st.tick); warnOnce('shoot', 'err', 'Сквозной ток: оба ключа стойки ' + legName + ' открыты одновременно. Проверьте мертвое время и полярность (DBCTL.POLSEL).'); }
        L.shoot[L.shoot.length - 1] = st.tick;
        return true;
      }
      return false;
    }

    function advance(nTicks) {
      var Vdc = P.Vdc, half = Vdc / 2;
      var end = Math.min(st.tick + nTicks, NT);
      var hb = P.plant === 'hbdc', im = P.plant === 'im3' || P.plant === 'pm3';
      while (st.tick < end && !st.halted) {
        if (st.cfgDirty) recfg();
        st.tick++;
        modOut(MODS[0]);
        if (NMOD > 1) for (var k2 = 1; k2 < NMOD; k2++) modOut(MODS[k2]);
        if (C.anyTz) tzInput();
        else if (st.cbcActive) st.cbcActive = false;
        L.lastA = M.lastPA; L.lastB = M.lastPB;

        var i = plant.i, vleg, inew, lowCond, shoot = false;
        if (im) {
          var m2i = MODS[1].M, m3i = MODS[2].M;
          var on = [[M.outA === 1, M.outB === 1], [m2i.outA === 1, m2i.outB === 1], [m3i.outA === 1, m3i.outB === 1]];
          var sh = false, anyOn = false, vx = [0, 0, 0], ix = IM.iph, it = IM.pm ? ITOT : ix;
          for (var lg = 0; lg < 3; lg++) {
            var hO = on[lg][0], lO = on[lg][1];
            if (shootCheck(hO, lO, 'ABC'[lg])) { sh = true; vx[lg] = half; continue; }
            if (hO || lO) anyOn = true;
            vx[lg] = hO ? Vdc : lO ? 0 : (it[lg] > 1e-6 ? 0 : (it[lg] < -1e-6 ? Vdc : half));
          }
          if (!sh) L.inShoot = false;
          if (SP) for (var sp = 0; sp < 3; sp++) { var lvp = on[sp][0] ? 1 : on[sp][1] ? 0 : -1; if (lvp >= 0 && lvp !== SP.lvl[sp]) { SP.t[sp] = st.tick; SP.sg[sp] = lvp ? 1 : -1; } SP.lvl[sp] = lvp; }   // помеха при включении ключа
          if (P.von) for (var lv = 0; lv < 3; lv++) { var sv = it[lv] / P.vonI; vx[lv] -= P.von * (sv > 1 ? 1 : sv < -1 ? -1 : sv); }   // падение напряжения на открытых ключах и диодах
          if (SC) {
            var dvf = vx[SC.a] - vx[SC.b];
            if (!SC.on && st.tick >= SC.t0) {
              // замыкание в начале интервала нужной полярности, если предыдущий такой интервал был не короче minInt
              var frc = SC.sign > 0 ? (on[SC.a][0] && on[SC.b][1]) : (on[SC.a][1] && on[SC.b][0]);   // ключи задают напряжение нужной полярности
              if (frc) SC.run++; else { if (SC.run) SC.lastRun = SC.run; SC.run = 0; }
              if (SC.prev === false && frc && SC.lastRun >= SC.minInt) { SC.on = true; SC.act = st.tick; msg('info', 'Короткое замыкание между выводами фаз ' + 'ABC'[SC.a] + ' и ' + 'ABC'[SC.b] + ' (индуктивность контура ' + (SC.lk * 1e6).toFixed(0) + ' мкГн).'); }
              SC.prev = frc;
            }
            if (SC.on) {
              var lOff = !on[SC.a][0] && !on[SC.a][1] && !on[SC.b][0] && !on[SC.b][1];
              var nf = SC.i + (dvf - SC.rk * SC.i) * DT / SC.lk;
              if (lOff && (SC.i === 0 || (nf > 0) !== (SC.i > 0))) nf = 0;
              SC.i = nf;
              if (Math.abs(nf) > SC.peakF) SC.peakF = Math.abs(nf);
            }
          }
          var open3 = !anyOn && Math.abs(ix[0]) < 1e-4 && Math.abs(ix[1]) < 1e-4 && Math.abs(ix[2]) < 1e-4;
          var usa = (2 * vx[0] - vx[1] - vx[2]) / 3, usb = (vx[1] - vx[2]) / 1.7320508075688772;
          vleg = usa;
          var Q = IM, wr = Q.p * plant.w;
          if (Q.pm) {
            var the = Q.p * plant.th, ce = Math.cos(the), se = Math.sin(the);
            var openP = !anyOn && Math.abs(ix[0]) < 5e-3 && Math.abs(ix[1]) < 5e-3 && Math.abs(ix[2]) < 5e-3;
            if (openP) { Q.id = 0; Q.iq = 0; vleg = -wr * Q.psi * se; }
            else {
              var ud = usa * ce + usb * se, uq = -usa * se + usb * ce;
              var nid = Q.id + (ud - Q.rs * Q.id + wr * Q.lq * Q.iq) * DT / Q.ld;
              Q.iq += (uq - Q.rs * Q.iq - wr * Q.ld * Q.id - wr * Q.psi) * DT / Q.lq;
              Q.id = nid;
            }
            var tep = 1.5 * Q.p * (Q.psi * Q.iq + (Q.ld - Q.lq) * Q.id * Q.iq);
            Q.te = tep;
            if (MOT.wset !== MOT.wsetT) { var dw = (MOT.acc || 1e4) * DT; MOT.wset = Math.abs(MOT.wsetT - MOT.wset) <= dw ? MOT.wsetT : MOT.wset + (MOT.wsetT > MOT.wset ? dw : -dw); }
            var wmp = plant.w;
            var tlp = (MOT.b || 0) * (wmp - MOT.wset) + (MOT.tload || 0) + (MOT.tc ? (wmp > 1e-3 ? MOT.tc : wmp < -1e-3 ? -MOT.tc : 0) : 0);
            plant.w = wmp + (tep - tlp) * DT / MOT.j;
            plant.th += plant.w * DT;
            var ia_ = Q.id * ce - Q.iq * se, ib_ = Q.id * se + Q.iq * ce;
            ix[0] = ia_; ix[1] = -0.5 * ia_ + 0.8660254037844386 * ib_; ix[2] = -0.5 * ia_ - 0.8660254037844386 * ib_;
            ITOT[0] = ix[0]; ITOT[1] = ix[1]; ITOT[2] = ix[2];
            if (SC && SC.on) {
              ITOT[SC.a] += SC.i; ITOT[SC.b] -= SC.i;
              var im_ = Math.abs(ITOT[SC.mph]);
              if (im_ > SC.peak) SC.peak = im_;
              if (SC.cross === null && im_ >= SC.ith) SC.cross = st.tick;
              if (!SC.tr) SC.tr = [];
              if (SC.tr.length < 4 * 25000) SC.tr.push(st.tick, ITOT[SC.mph], anyOn ? 1 : 0, SC.i);
              if (SC.off === null && !anyOn) SC.off = st.tick;
            }
            inew = ITOT[0];
            lowCond = false;
            if (ENC) { if (QC.on) qepTick(); encStep(); }
          } else {
          if (open3) { Q.sa = Q.lm / Q.lr * Q.ra; Q.sb = Q.lm / Q.lr * Q.rb; vleg = 0; }
          var isa = (Q.lr * Q.sa - Q.lm * Q.ra) / Q.D, isb = (Q.lr * Q.sb - Q.lm * Q.rb) / Q.D;
          var ira = (Q.ls * Q.ra - Q.lm * Q.sa) / Q.D, irb = (Q.ls * Q.rb - Q.lm * Q.sb) / Q.D;
          if (open3) { isa = 0; isb = 0; ira = Q.ra / Q.lr; irb = Q.rb / Q.lr; }
          else { Q.sa += (usa - Q.rs * isa) * DT; Q.sb += (usb - Q.rs * isb) * DT; }
          var nra = Q.ra + (-Q.rr * ira - wr * Q.rb) * DT, nrb = Q.rb + (-Q.rr * irb + wr * Q.ra) * DT;
          Q.ra = nra; Q.rb = nrb;
          var te = 1.5 * Q.p * (Q.sa * isb - Q.sb * isa);
          Q.te = te;
          if (!MOT.locked) {
            var wm = plant.w, rel = wm / MOT.wn;
            var tl = MOT.mpn * rel * Math.abs(rel) + (MOT.tload || 0) + (MOT.tc ? (wm > 1e-3 ? MOT.tc : wm < -1e-3 ? -MOT.tc : 0) : 0);
            plant.w = wm + (te - tl) * DT / MOT.j;
            plant.th += plant.w * DT;
          } else plant.w = 0;
          ix[0] = isa; ix[1] = -0.5 * isa + 0.8660254037844386 * isb; ix[2] = -0.5 * isa - 0.8660254037844386 * isb;
          inew = ix[0];
          lowCond = false;
          }
        } else if (!hb) {
          var hiOn = M.outA === 1, loOn = M.outB === 1;
          if (shootCheck(hiOn, loOn, 'A')) vleg = half;
          else {
            L.inShoot = false;
            if (hiOn) vleg = Vdc; else if (loOn) vleg = 0;
            else vleg = i > 0 ? 0 : (i < 0 ? Vdc : half);
          }
          inew = i + (vleg - half - R * i) * dtL;
          if (!hiOn && !loOn && i !== 0 && (inew > 0) !== (i > 0)) inew = 0;
          lowCond = loOn || (!hiOn && inew > 0);
        } else {
          // H-мост: стойка A - ePWM1, стойка B - ePWM2, якорь двигателя между средними точками
          var m2 = MODS[1].M;
          var aH = M.outA === 1, aL = M.outB === 1, bH = m2.outA === 1, bL = m2.outB === 1;
          var sA = shootCheck(aH, aL, 'A'), sB = sA ? true : shootCheck(bH, bL, 'B');
          if (!sA && !sB) L.inShoot = false;
          var vA = aH ? Vdc : aL ? 0 : (i > 0 ? 0 : (i < 0 ? Vdc : NaN));
          var vB = bH ? Vdc : bL ? 0 : (i > 0 ? Vdc : (i < 0 ? 0 : NaN));
          var eb = MOT ? MOT.ke * plant.w : 0;
          if (isNaN(vA) || isNaN(vB)) vleg = eb;            // ток равен нулю, цепь разомкнута
          else vleg = vA - vB;
          if (sA || sB) vleg = 0;
          inew = i + (vleg - R * i - eb) * dtL;
          var open = (!aH && !aL) || (!bH && !bL);
          if (open && i !== 0 && (inew > 0) !== (i > 0)) inew = 0;
          if (open && i === 0 && (isNaN(vA) || isNaN(vB))) inew = 0;
          lowCond = aL || (!aH && inew > 0);
          if (MOT && !MOT.locked) {
            var w = plant.w, tl = MOT.tload || 0;
            var tf = MOT.tc ? (w > 1e-3 ? MOT.tc : w < -1e-3 ? -MOT.tc : 0) : 0;
            plant.w = w + (MOT.km * inew - tl - MOT.b * w - tf) * DT / MOT.j;
            plant.th += plant.w * DT;
          }
          if (ENC) { if (QC.on) qepTick(); encStep(); }
        }
        plant.i = inew;
        if (vleg !== L.lastV) { L.vEd.push(st.tick, vleg); L.lastV = vleg; }
        if (st.tick % DEC === 0) { L.iS[L.iN++] = inew; if (L.wS) L.wS[L.iN - 1] = plant.w; if (IM) { L.iS2[L.iN - 1] = IM.pm ? ITOT[1] : IM.iph[1]; if (IM.pm) { var thm = (IM.p * plant.th) % 6.283185307179586; L.thS[L.iN - 1] = thm < 0 ? thm + 6.283185307179586 : thm; L.pmS[L.iN - 1] = plant.th; L.teS[L.iN - 1] = IM.te; L.idS[L.iN - 1] = IM.id; L.iqS[L.iN - 1] = IM.iq; } else L.psiS[L.iN - 1] = Math.sqrt(IM.sa * IM.sa + IM.sb * IM.sb); } }

        if (SN) {
          if (vleg !== lastVl) { lastEdge = st.tick; lastVl = vleg; }
          curI = inew;
          if (SN.chans) {
            for (var cq = 0; cq < SN.chans.length; cq++) { var chq = SN.chans[cq]; var tq = 1.65 + chq.voff + chq.pol * chq.sens * (1 + chq.gerr) * (IM.pm ? ITOT[chq.ph] : IM.iph[chq.ph]); ampN[cq] += (tq - ampN[cq]) * kAmp; }
            amp.v = ampN[0];
          } else {
          var tgt = SN.type === 'hall' ? 1.65 + SN.voff + SN.pol * SN.sens * (1 + SN.gerr) * inew
            : 1.65 + SN.voff + SN.pol * SN.g * (1 + SN.gerr) * SN.rsh * (lowCond ? inew : 0);
          amp.v += (tgt - amp.v) * kAmp;
          }
          if (st.tick % DEC === 0) L.csS[L.csN++] = amp.v;
          if (adcCur) adcStep();
        } else if (adcCur) adcStep();
        if (C.anyCmp || C.anyDc) dcStep();
        if (P.capture && st.tick >= Math.round(P.capture.t * BASE_HZ) && (L.cap || (L.cap = [])).length < 8 * P.capture.n) {
          var kc = CMP_P.indexOf(P.capture.ch), cc = kc >= 0 ? CS[kc] : null;
          L.cap.push(st.tick, nodeV(P.capture.ch), cc ? cc.as[0] : 0, cc ? cc.as[1] : 0, cc ? cc.f[0].out : 0, cc ? cc.f[1].out : 0, cc ? S['Cmpss' + (kc + 1) + 'Regs'].DACHVALA : 0, cc ? S['Cmpss' + (kc + 1) + 'Regs'].DACLVALA : 0);
        }
        while (ldIdx < P.loadEvents.length && st.tick >= Math.round(P.loadEvents[ldIdx].t * BASE_HZ)) {
          var le = P.loadEvents[ldIdx++];
          if (le.R !== undefined) R = le.R; if (le.L !== undefined) dtL = DT / (le.L * 1e-3);
          if (MOT && le.locked !== undefined) MOT.locked = le.locked;
          if (MOT && le.tload !== undefined) MOT.tload = le.tload;
          if (MOT && le.wset !== undefined) { MOT.wsetT = le.wset; if (le.acc !== undefined) MOT.acc = le.acc; }
          if (MOT && le.b !== undefined) MOT.b = le.b;
          msg('info', 'Изменение нагрузки' + (le.R !== undefined || le.L !== undefined ? ': R = ' + R.toFixed(3) + ' Ом, L = ' + (DT / dtL * 1e3).toFixed(3) + ' мГн' : '') + (le.locked !== undefined ? (le.locked ? ', ротор заторможен' : ', ротор освобожден') : '') + (le.tload !== undefined ? ', момент нагрузки ' + le.tload + ' Н·м' : '') + (le.wset !== undefined ? ', нагрузочная машина: частота вращения ' + Math.round(le.wset * 30 / Math.PI) + ' об/мин' : (le.b === 0 ? ', нагрузочная машина переведена в режим момента' : '')) + '.');
        }
        while (veIdx < P.varEvents.length && st.tick >= Math.round(P.varEvents[veIdx].t * BASE_HZ)) {
          var ve = P.varEvents[veIdx++];
          if (res && res.set && !res.set(ve.name, ve.value)) { if (st.missingVars.indexOf(ve.name) < 0) { st.missingVars.push(ve.name); msg('err', 'Нет глобальной переменной «' + ve.name + '»: испытание задает ее значение, объявите ее в программе.'); } }
          L.varEv.push(st.tick, ve.name, ve.value);
        }
        if ((S.PieCtrlRegs.PIEIFR3 | S.PieCtrlRegs.PIEIFR1 | S.PieCtrlRegs.PIEIFR5) & 1) dispatch();
        if (st.wdOn && st.tick >= WD_TICKS) {
          halt('wd', 'Сброс по сторожевому таймеру: после сброса он включен и не обслуживается. Его отключает InitSysCtrl().');
        }
      }
      return { done: st.tick >= NT || st.halted, progress: st.tick / NT };
    }

    /* ---- запуск main() ---- */
    function start(compiled, lineOffset) {
      st.lineOffset = lineOffset || 0;
      st.phase = 'main';
      try { res = compiled.factory(env); }
      catch (e) { msg('err', 'Ошибка при инициализации глобальных переменных: ' + runtimeRu(e), errLine(e)); st.halted = true; return false; }
      if (!res || !res.main) { msg('err', 'Функция main() не найдена.'); st.halted = true; return false; }
      st.guard = 0;
      try { res.main(); }
      catch (e) {
        if (!(e && e.c2k && e.message === '__stop')) msg('err', 'Ошибка в main(): ' + runtimeRu(e), errLine(e));
        st.halted = true; return false;
      }
      if (st.eallow) warnOnce('eallowmain', 'warn', 'main() оставила EALLOW включенным: защита регистров не восстановлена (нет EDIS).');
      if (!st.reachedBg) msg('warn', 'main() завершилась без фонового цикла for(;;). На кристалле после выхода из main() вызывается exit(), и процессор останавливается в abort().');
      else msg('info', 'main() дошла до фонового цикла for(;;). Дальше работает аппаратура ePWM и обработчик прерывания.');
      if (P.overrides && res.set) {
        Object.keys(P.overrides).forEach(function (n) {
          if (!res.set(n, P.overrides[n])) { st.missingVars.push(n); msg('err', 'Нет глобальной переменной «' + n + '»: испытание задает ее значение, объявите ее в программе.'); }
        });
      }
      snapMain = snapshot();
      varsMain = res.vars ? res.vars() : {};
      st.phase = 'run';
      recfg();
      L.edA.push(0, -1); L.edA.length = 0; // начальные значения запишутся на первом такте
      return true;
    }

    var snapMain = null, varsMain = {};
    function snapshot() {
      var o = {};
      Object.keys(S).forEach(function (g) { o[g] = {}; Object.keys(S[g]).forEach(function (r) { o[g][r] = S[g][r]; }); });
      o.__core = { IER: st.IER, IFR: st.IFR, INTM: st.INTM, EALLOW: st.eallow ? 1 : 0 };
      o.__active = { TBPRD: M.prdA, CMPA: M.cmpA };
      o.__vect = {};
      Object.keys(vect).forEach(function (k) { o.__vect[k] = vect[k] === DEFAULTS[k] ? DEFAULTS[k].name + ' (по умолчанию)' : (typeof vect[k] === 'function' ? (vect[k].name || 'функция') : 'не задан'); });
      return o;
    }

    function finish() {
      L.ctrV.push(st.tick, E.TBCTR);
      if (st.tick > 0 && (st.tick - st.blockSince) > 20000 && st.blockSince && !st.blockReported) {
        for (var k = 0; k < SRC.length; k++) if (S.PieCtrlRegs[SRC[k].ifr] & 1) { var r = blockReason(SRC[k]); if (r) { msg('warn', r); break; } }
      }
      if (st.etSupp > 0 && st.isrCount > 0 && !st.warnSeen.etclr && !st.blockReported) {
        msg('warn', 'Пропущено событий ePWM1 из-за неснятого флага ETFLG.INT: ' + st.etSupp + '.');
      }
      if (st.ignored > 0) msg('warn', 'Записей в регистры, которые не выполнились: ' + st.ignored + '.');
      if (!st.halted || st.haltReason === 'wd') diagnoseIdle();
      return {
        P: P, NT: NT, tickHz: BASE_HZ, nmod: NMOD, endTick: st.tick, halted: st.halted, haltReason: st.haltReason,
        logs: L, msgs: msgs, snapMain: snapMain, snapEnd: snapshot(),
        varsMain: varsMain, varsEnd: res && res.vars ? safeVars() : {},
        isrCount: st.isrCount, tripTick: st.tripTick, tripSrc: st.tripSrc, cbcTick: st.cbcTick === undefined ? null : st.cbcTick, etSupp: st.etSupp, ignored: st.ignored,
        cmpa: { min: st.cmpaMin, max: st.cmpaMax, writes: st.cmpaWrites }, ovf: st.ovf, warnKeys: Object.keys(st.warnSeen), missingVars: st.missingVars,
        reachedBg: st.reachedBg, isrBy: st.isrBy, adcModeSet: st.adcModeSet,
        qep: enc ? { edges: enc.edges, counted: enc.counted, ignored: enc.ignored, coef: enc.coef, latchReads: st.qepLatchReads, cpr: enc.cpr } : null,
        measures: measure()
      };
    }
    function diagnoseIdle() {
      if (!L.zeroT.length) {
        var why = [];
        if (!C.clk) why.push('на модуль не подан такт (PCLKCR2.bit.EPWM1 = 0)');
        if (!C.sync) why.push('счетчики ePWM остановлены общим битом CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 0');
        if (C.ctrmode === 3) why.push('TBCTL.bit.CTRMODE = TB_FREEZE, это значение после сброса');
        if (M.prdA === 0 && E.TBPRD === 0) why.push('TBPRD = 0');
        if (why.length) msg('warn', 'Счетчик ePWM1 не работал: ' + why.join('; ') + '.');
      }
      var noA = C.mux0 !== 1, noB = C.mux1 !== 1;
      if (noA || noB) {
        msg('warn', 'Вывод ' + (noA && noB ? 'GPIO0 и GPIO1 не подключены' : noA ? 'GPIO0 не подключен' : 'GPIO1 не подключен') +
          ' к ePWM1 (GpioCtrlRegs.GPAMUX1). Сигналы ePWM есть внутри кристалла, но до драйвера ключей не доходят: на выводе ' +
          ((noA ? C.pud0 : C.pud1) ? 'высокоимпедансное состояние, ключ закрыт подтяжкой драйвера.' : 'единица от внутренней подтяжки, ключ открыт.'));
      }
    }
    function safeVars() { try { return res.vars(); } catch (e) { return {}; } }

    function measure() {
      var m = {};
      // частота ШИМ по моментам TBCTR = 0
      var z = L.zeroT;
      if (z.length >= 3) { var nz = Math.min(z.length - 1, 50); m.fpwm = nz / ((z[z.length - 1] - z[z.length - 1 - nz]) / BASE_HZ); }
      // мертвое время: спад одного выхода -> фронт другого, пока первый снова не включился
      function gaps(fall, rise) {
        var mn = Infinity, mx = -Infinity, j = 0, cnt = 0;
        for (var a = 2; a < fall.length; a += 2) {
          if (fall[a + 1] !== 0 || fall[a - 1] !== 1) continue;
          var tf = fall[a];
          var tNext = (a + 2 < fall.length) ? fall[a + 2] : Infinity;
          while (j < rise.length && rise[j] < tf) j += 2;
          for (var b = j; b < rise.length && rise[b] < tNext; b += 2) {
            if (rise[b + 1] === 1 && b >= 2 && rise[b - 1] !== 1) { var g = rise[b] - tf; if (g < mn) mn = g; if (g > mx) mx = g; cnt++; break; }
          }
        }
        return cnt ? { min: mn / BASE_HZ, max: mx / BASE_HZ, n: cnt } : null;
      }
      m.dtAB = gaps(L.edA, L.edB);
      m.dtBA = gaps(L.edB, L.edA);
      if (L.ed && L.ed[1]) { m.dt2AB = gaps(L.ed[1].A, L.ed[1].B); m.dt2BA = gaps(L.ed[1].B, L.ed[1].A); }
      if (L.ed && L.ed[2]) { m.dt3AB = gaps(L.ed[2].A, L.ed[2].B); m.dt3BA = gaps(L.ed[2].B, L.ed[2].A); }
      var shootT = 0;
      for (var s = 0; s < L.shoot.length; s += 2) shootT += L.shoot[s + 1] - L.shoot[s] + 1;
      m.shootTime = shootT / BASE_HZ; m.shootN = L.shoot.length / 2;
      var imax = 0;
      for (var q = 0; q < L.iN; q++) { var v = Math.abs(L.iS[q]); if (v > imax) imax = v; }
      m.imax = imax;
      if (L.isrT.length >= 2) m.fisr = (L.isrT.length - 1) / ((L.isrT[L.isrT.length - 1] - L.isrT[0]) / BASE_HZ);
      m.prdA = M.prdA; m.cmpA = M.cmpA;
      return m;
    }

    return {
      P: P, NT: NT, msgs: msgs,
      start: start, advance: advance, finish: finish,
      progress: function () { return st.tick / NT; }
    };
  }

  /* ------------------------------------------------------------ */
  /* Внешний интерфейс                                            */
  /* ------------------------------------------------------------ */
  function compileAndCreate(code, params, compiler) {
    var tr = translate(code);
    var out = { tr: tr, errors: tr.errors.slice(), warnings: tr.warnings.slice() };
    if (tr.errors.length) return out;
    var cm = (compiler || compileFn).compile(tr);
    if (cm.error) { out.errors.push(cm.error); return out; }
    out.compiled = cm;
    out.lineOffset = (compiler || compileFn).offset || 0;
    out.run = createRun(code, params);
    return out;
  }

  return {
    SCHEMA: SCHEMA, ENUMS: ENUMS, CONSTS: CONSTS, BASE_HZ: BASE_HZ,
    translate: translate, compileAndCreate: compileAndCreate, factorySource: factorySource,
    stackLine: stackLine, syntaxRu: syntaxRu
  };
})();
if (typeof module !== 'undefined') module.exports = C2K;
