// app.c - Шаг 1. Стойка инвертора на ePWM1
// TMS320F2837xD: SYSCLK = 200 МГц, EPWMCLK = 100 МГц
// Нагрузка: R-L между средней точкой стойки и средней точкой звена постоянного тока

#include "F2837xD_device.h"
#include "F2837xD_Examples.h"

#define FSW_HZ        10000.0f    // частота ШИМ, Гц
#define TBPRD_VAL     5000        // 100 МГц / (2 * 10 кГц) при счете вверх-вниз
#define DEADBAND_TCK  100         // мертвое время 1 мкс = 100 тактов TBCLK
#define TS            (1.0f / FSW_HZ)
#define TWO_PI        6.2831853f

volatile float  m_index   = 0.8f;   // глубина модуляции
volatile float  f_out     = 50.0f;  // частота выходного напряжения, Гц
volatile float  theta     = 0.0f;   // фаза задания, рад
volatile float  duty      = 0.5f;   // коэффициент заполнения
volatile Uint32 isr_count = 0;      // число вызовов обработчика

void InitEPwm1Gpio(void);
void InitEPwm1(void);
__interrupt void epwm1_isr(void);

void main(void)
{
    InitSysCtrl();                          // тактирование, отключение сторожевого таймера

    InitEPwm1Gpio();                        // GPIO0 = EPWM1A, GPIO1 = EPWM1B

    DINT;                                   // запрет прерываний на время настройки
    InitPieCtrl();                          // PIE в исходное состояние
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();                     // таблица векторов, включение PIE

    EALLOW;
    PieVectTable.EPWM1_INT = &epwm1_isr;    // свой обработчик для EPWM1_INT
    EDIS;

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 0;   // остановить счетчики всех ePWM
    EDIS;

    InitEPwm1();

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 1;   // одновременный пуск счетчиков
    EDIS;

    IER |= M_INT3;                          // группа 3 (ePWM) в ядре
    PieCtrlRegs.PIEIER3.bit.INTx1 = 1;      // EPWM1_INT в PIE
    EINT;                                   // глобальное разрешение прерываний
    ERTM;

    for(;;)
    {
        // фоновый цикл: связь, индикация, медленные защиты
    }
}

void InitEPwm1Gpio(void)
{
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO0  = 1;     // отключить подтяжку
    GpioCtrlRegs.GPAPUD.bit.GPIO1  = 1;
    GpioCtrlRegs.GPAMUX1.bit.GPIO0 = 1;     // GPIO0 -> EPWM1A
    GpioCtrlRegs.GPAMUX1.bit.GPIO1 = 1;     // GPIO1 -> EPWM1B
    EDIS;
}

void InitEPwm1(void)
{
    // Счетчик
    EPwm1Regs.TBPRD = TBPRD_VAL;                       // период
    EPwm1Regs.TBCTR = 0;                               // сброс счетчика
    EPwm1Regs.TBCTL.bit.CTRMODE   = TB_COUNT_UPDOWN;   // счет вверх-вниз
    EPwm1Regs.TBCTL.bit.PHSEN     = TB_DISABLE;        // синхронизация не используется
    EPwm1Regs.TBCTL.bit.PRDLD     = TB_SHADOW;
    EPwm1Regs.TBCTL.bit.HSPCLKDIV = TB_DIV1;           // после сброса здесь /2
    EPwm1Regs.TBCTL.bit.CLKDIV    = TB_DIV1;

    // Сравнение: новое значение CMPA вступает в силу при TBCTR = 0
    EPwm1Regs.CMPCTL.bit.SHDWAMODE = CC_SHADOW;
    EPwm1Regs.CMPCTL.bit.LOADAMODE = CC_CTR_ZERO;
    EPwm1Regs.CMPA.bit.CMPA = TBPRD_VAL / 2;

    // Выход A: высокий уровень, пока TBCTR < CMPA
    EPwm1Regs.AQCTLA.bit.CAU = AQ_CLEAR;
    EPwm1Regs.AQCTLA.bit.CAD = AQ_SET;

    // Мертвое время: B - инверсия A, оба фронта задержаны
    EPwm1Regs.DBCTL.bit.IN_MODE  = DBA_ALL;
    EPwm1Regs.DBCTL.bit.OUT_MODE = DB_FULL_ENABLE;
    EPwm1Regs.DBCTL.bit.POLSEL   = DB_ACTV_HIC;
    EPwm1Regs.DBRED.bit.DBRED    = DEADBAND_TCK;
    EPwm1Regs.DBFED.bit.DBFED    = DEADBAND_TCK;

    // Аварийное отключение: оба ключа закрыты
    EALLOW;
    EPwm1Regs.TZCTL.bit.TZA = TZ_FORCE_LO;
    EPwm1Regs.TZCTL.bit.TZB = TZ_FORCE_LO;
    EDIS;

    // Прерывание в начале каждого периода (TBCTR = 0)
    EPwm1Regs.ETSEL.bit.INTSEL = ET_CTR_ZERO;
    EPwm1Regs.ETSEL.bit.INTEN  = 1;
    EPwm1Regs.ETPS.bit.INTPRD  = ET_1ST;
}

__interrupt void epwm1_isr(void)
{
    theta += TWO_PI * f_out * TS;
    if (theta >= TWO_PI) theta -= TWO_PI;

    duty = 0.5f + 0.5f * m_index * sinf(theta);
    EPwm1Regs.CMPA.bit.CMPA = (Uint16)(duty * TBPRD_VAL);

    isr_count++;

    // Опыт: программное аварийное отключение через 45 мс
    if (isr_count == 450)
    {
        EALLOW;
        EPwm1Regs.TZFRC.bit.OST = 1;
        EDIS;
    }

    EPwm1Regs.ETCLR.bit.INT = 1;               // сбросить флаг прерывания ePWM1
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP3;    // разрешить следующие прерывания группы 3
}
