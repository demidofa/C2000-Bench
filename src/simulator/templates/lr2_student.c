// ЛР2. Измерение тока стойки инвертора
// Заготовка программы. Вариант: __   Исполнитель: ________________
// TMS320F2837xD: SYSCLK = 200 МГц, EPWMCLK = 100 МГц, АЦП A 12 бит
//
// Основа - программа ЛР1. Определения ЛР1 перенести из своей программы.
// Строки с пометкой ЗАДАНИЕ заполняются по методическим указаниям.

#include "F2837xD_device.h"
#include "F2837xD_Examples.h"

// ---- Данные варианта: ЛР1 (перенести из своей программы ЛР1) ----
#define FSW_HZ        10000.0f
#define TBPRD_VAL     5000
#define DEADBAND_TCK  100
#define FAULT_GPIO    12

// ---- Данные варианта: ЛР2 ----
#define ADC_CH        0           // ЗАДАНИЕ 1: вход АЦП A датчика тока
#define ACQPS_VAL     14          // ЗАДАНИЕ 1: окно выборки (ACQPS + 1) * 5 нс >= t_S min
#define R_SHUNT       0.010f      // ЗАДАНИЕ 1: сопротивление шунта, Ом
#define G_AMP         20.0f       // ЗАДАНИЕ 1: коэффициент усиления
#define CS_POL        (1.0f)      // ЗАДАНИЕ 1: полярность датчика, +1 или -1
#define T_SETTLE      2.0e-6f     // ЗАДАНИЕ 1: время установления усилителя, с
#define I_TRIP        5.0f        // ЗАДАНИЕ 1: уставка защиты по току, А

#define TS            (1.0f / FSW_HZ)
#define TWO_PI        6.2831853f
#define CAL_N         256
#define ADC_LSB_V     (3.3f / 4096.0f)
#define K_ADC         (1.0f)      // ЗАДАНИЕ 1: ампер на единицу кода, со знаком полярности
#define T_SAMPLE      ((ACQPS_VAL + 1) * 5.0e-9f)
#define D_MAX         (1.0f)      // ЗАДАНИЕ 1: наибольший коэффициент заполнения

#define ST_CAL        0
#define ST_RUN        1
#define ST_FAULT      2

// ---- Интерфейсные переменные: не переименовывать ----
volatile float  m_index   = 0.8f;   // глубина модуляции (задается)
volatile float  f_out     = 50.0f;  // частота выходного напряжения, Гц (задается)
volatile float  i_meas    = 0.0f;   // измеренный ток, А (контролируется)

volatile float  theta       = 0.0f;
volatile float  duty        = 0.5f;
volatile float  offset_code = 2048.0f;
volatile float  cal_sum     = 0.0f;
volatile Uint16 cal_cnt     = 0;
volatile Uint16 adc_code    = 0;
volatile Uint16 state       = ST_CAL;
volatile Uint32 isr_count   = 0;

void InitEPwm1Gpio(void);
void InitFaultInput(void);
void InitAdcA(void);
void InitEPwm1(void);
__interrupt void adca1_isr(void);

void main(void)
{
    InitSysCtrl();

    InitEPwm1Gpio();
    InitFaultInput();
    InitAdcA();

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    // ЗАДАНИЕ 4: записать адрес adca1_isr в вектор ADCA1_INT.

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 0;
    EDIS;

    InitEPwm1();

    // ЗАДАНИЕ 4: отключить выходы стойки до окончания калибровки нуля.

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 1;
    EDIS;

    // ЗАДАНИЕ 4: разрешить прерывание ADCA1 (группа 1 PIE, INTx1) и глобально.
    ERTM;

    for(;;)
    {
    }
}

void InitEPwm1Gpio(void)
{
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO0  = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO1  = 1;
    GpioCtrlRegs.GPAMUX1.bit.GPIO0 = 1;
    GpioCtrlRegs.GPAMUX1.bit.GPIO1 = 1;
    EDIS;
}

void InitFaultInput(void)
{
    EALLOW;
    GpioCtrlRegs.GPADIR.all &= ~(1UL << FAULT_GPIO);
    GpioCtrlRegs.GPAPUD.all &= ~(1UL << FAULT_GPIO);
    InputXbarRegs.INPUT1SELECT = FAULT_GPIO;
    EDIS;
}

void InitAdcA(void)
{
    // ЗАДАНИЕ 2. Режим АЦП: делитель ADCCLK, 12 бит, однофазный вход,
    // флаг прерывания по окончании преобразования, включение АЦП,
    // пауза не менее 500 мкс после включения.

    // ЗАДАНИЕ 2. SOC0: вход ADC_CH, окно ACQPS_VAL, запуск от ePWM1 SOCA.
    // ADCINT1 по окончании SOC0, сброс флага ADCINT1.
}

void InitEPwm1(void)
{
    EPwm1Regs.TBPRD = TBPRD_VAL;
    EPwm1Regs.TBCTR = 0;
    EPwm1Regs.TBCTL.bit.CTRMODE   = TB_COUNT_UPDOWN;
    EPwm1Regs.TBCTL.bit.PHSEN     = TB_DISABLE;
    EPwm1Regs.TBCTL.bit.PRDLD     = TB_SHADOW;
    EPwm1Regs.TBCTL.bit.HSPCLKDIV = TB_DIV1;
    EPwm1Regs.TBCTL.bit.CLKDIV    = TB_DIV1;

    EPwm1Regs.CMPCTL.bit.SHDWAMODE = CC_SHADOW;
    EPwm1Regs.CMPCTL.bit.LOADAMODE = CC_CTR_ZERO;
    EPwm1Regs.CMPA.bit.CMPA = TBPRD_VAL / 2;

    EPwm1Regs.AQCTLA.bit.CAU = AQ_CLEAR;
    EPwm1Regs.AQCTLA.bit.CAD = AQ_SET;

    EPwm1Regs.DBCTL.bit.IN_MODE  = DBA_ALL;
    EPwm1Regs.DBCTL.bit.OUT_MODE = DB_FULL_ENABLE;
    EPwm1Regs.DBCTL.bit.POLSEL   = DB_ACTV_HIC;
    EPwm1Regs.DBRED.bit.DBRED    = DEADBAND_TCK;
    EPwm1Regs.DBFED.bit.DBFED    = DEADBAND_TCK;

    EALLOW;
    EPwm1Regs.TZCTL.bit.TZA   = TZ_FORCE_LO;
    EPwm1Regs.TZCTL.bit.TZB   = TZ_FORCE_LO;
    EPwm1Regs.TZSEL.bit.OSHT1 = 1;
    EPwm1Regs.TZCLR.bit.OST   = 1;
    EPwm1Regs.TZCLR.bit.INT   = 1;
    EDIS;

    // ЗАДАНИЕ 3: запуск АЦП (SOCA) в середине импульса нижнего ключа,
    // в каждом периоде ШИМ. Прерывание ePWM не используется.
}

__interrupt void adca1_isr(void)
{
    // ЗАДАНИЕ 5: прочитать результат SOC0 в adc_code.

    if (state == ST_CAL)
    {
        // ЗАДАНИЕ 5: накопить CAL_N выборок, вычислить offset_code,
        // перейти в ST_RUN и включить выходы.
    }
    else
    {
        // ЗАДАНИЕ 5: пересчитать код в ток i_meas.

        // ЗАДАНИЕ 6: защита по току: при |i_meas| > I_TRIP или насыщении
        // АЦП отключить выходы и перейти в ST_FAULT.
    }

    if (state == ST_RUN)
    {
        theta += TWO_PI * f_out * TS;
        if (theta >= TWO_PI) theta -= TWO_PI;

        duty = 0.5f + 0.5f * m_index * sinf(theta);
        // ЗАДАНИЕ 7: ограничить duty диапазоном от 0 до D_MAX.

        EPwm1Regs.CMPA.bit.CMPA = (Uint16)(duty * TBPRD_VAL);
    }

    isr_count++;

    // ЗАДАНИЕ 8: сбросить флаг ADCINT1 и подтвердить группу 1 PIE.
}
