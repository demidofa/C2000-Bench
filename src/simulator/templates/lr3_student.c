// ЛР3. Контур тока двигателя постоянного тока
// Заготовка программы. Вариант: __   Исполнитель: ________________
// TMS320F2837xD: SYSCLK = 200 МГц, EPWMCLK = 100 МГц, АЦП A 12 бит
//
// Основа - программы ЛР1 и ЛР2. Силовая часть - H-мост из двух стоек:
// стойка A управляется ePWM1 (GPIO0, GPIO1), стойка B - ePWM2 (GPIO2, GPIO3),
// якорь двигателя включен между средними точками стоек.
// Строки с пометкой ЗАДАНИЕ заполняются по методическим указаниям.

#include "F2837xD_device.h"
#include "F2837xD_Examples.h"

// ---- Данные варианта: ЛР1, ЛР2 (перенести из своих программ) ----
#define FSW_HZ        10000.0f
#define TBPRD_VAL     5000
#define DEADBAND_TCK  100
#define FAULT_GPIO    12
#define ADC_CH        0
#define ACQPS_VAL     14

// ---- Данные варианта: ЛР3 ----
#define UD            24.0f       // ЗАДАНИЕ 1: напряжение звена, В
#define R_A           1.0f        // ЗАДАНИЕ 1: сопротивление якоря, Ом
#define L_A           1.0e-3f     // ЗАДАНИЕ 1: индуктивность якоря, Гн
#define HALL_S        0.100f      // ЗАДАНИЕ 1: чувствительность датчика, В/А
#define CS_POL        (1.0f)      // ЗАДАНИЕ 1: полярность датчика, +1 или -1
#define T_BS          1.0e-6f     // ЗАДАНИЕ 1: наименьший импульс нижнего ключа, с
#define I_TRIP        10.0f       // ЗАДАНИЕ 1: уставка защиты по току, А

#define TS            (1.0f / FSW_HZ)
#define CAL_N         256
#define K_ADC         (1.0f)      // ЗАДАНИЕ 1: ампер на единицу кода, со знаком полярности
#define T_DT          (DEADBAND_TCK * 10.0e-9f)
#define D_MAX         (1.0f)      // ЗАДАНИЕ 1: наибольший коэффициент заполнения стойки
#define U_MAX         UD          // ЗАДАНИЕ 1: наибольшее напряжение на якоре
#define T_MU          TS          // ЗАДАНИЕ 1: некомпенсируемая постоянная времени
#define KP            (0.0f)      // ЗАДАНИЕ 1: пропорциональный коэффициент, В/А
#define KI            (0.0f)      // ЗАДАНИЕ 1: интегральный коэффициент, В/(А·с)

#define ST_CAL        0
#define ST_RUN        1
#define ST_FAULT      2

// ---- Интерфейсные переменные: не переименовывать ----
volatile float  i_ref     = 0.0f;   // задание тока, А (задается)
volatile float  i_meas    = 0.0f;   // измеренный ток, А (контролируется)

volatile float  u_ref       = 0.0f; // задание напряжения на якоре, В
volatile float  xi          = 0.0f; // интегральная составляющая, В
volatile float  offset_code = 2048.0f;
volatile float  cal_sum     = 0.0f;
volatile Uint16 cal_cnt     = 0;
volatile Uint16 adc_code    = 0;
volatile Uint16 state       = ST_CAL;

void InitEPwmGpio(void);
void InitFaultInput(void);
void InitAdcA(void);
void InitEPwmLeg(volatile struct EPWM_REGS *p);
void PwmTrip(void);
void PwmEnable(void);
__interrupt void adca1_isr(void);

void main(void)
{
    InitSysCtrl();

    InitEPwmGpio();
    InitFaultInput();
    InitAdcA();

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.ADCA1_INT = &adca1_isr;
    EDIS;

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 0;
    EDIS;

    InitEPwmLeg(&EPwm1Regs);                // стойка A
    // ЗАДАНИЕ 3: настроить стойку B той же функцией.

    // ЗАДАНИЕ 3: запуск АЦП от ePWM1 при TBCTR = TBPRD в каждом периоде.

    PwmTrip();                              // выходы отключены до окончания калибровки

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 1;   // одновременный пуск счетчиков
    EDIS;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx1 = 1;
    EINT;
    ERTM;

    for(;;)
    {
    }
}

void InitEPwmGpio(void)
{
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO0  = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO1  = 1;
    GpioCtrlRegs.GPAMUX1.bit.GPIO0 = 1;     // EPWM1A - верхний ключ стойки A
    GpioCtrlRegs.GPAMUX1.bit.GPIO1 = 1;     // EPWM1B - нижний ключ стойки A
    // ЗАДАНИЕ 2: выводы GPIO2 и GPIO3 - выходы EPWM2A и EPWM2B стойки B.
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
    // Перенести из своей программы ЛР2: режим АЦП, включение, пауза,
    // SOC0 (вход ADC_CH, окно ACQPS_VAL, запуск от ePWM1 SOCA), ADCINT1.
}

void InitEPwmLeg(volatile struct EPWM_REGS *p)
{
    // ЗАДАНИЕ 3: перенести настройку из InitEPwm1() программы ЛР2,
    // заменив обращения EPwm1Regs.<поле> на p-><поле>.
    // Настройку запуска АЦП (ETSEL, ETPS) сюда не включать.
    p->TBPRD = TBPRD_VAL;
    p->TBCTR = 0;
}

void PwmTrip(void)
{
    // ЗАДАНИЕ 4: программно отключить выходы обеих стоек (TZFRC.OST).
}

void PwmEnable(void)
{
    // ЗАДАНИЕ 4: снять отключение обеих стоек (TZCLR.OST, TZCLR.INT).
}

__interrupt void adca1_isr(void)
{
    float e, u, d;

    // Перенести из своей программы ЛР2: чтение результата в adc_code,
    // калибровка нуля (по окончании - xi = 0, ST_RUN, PwmEnable()),
    // пересчет кода в ток i_meas.

    // ЗАДАНИЕ 8: защита по току: при |i_meas| > I_TRIP или насыщении АЦП
    // отключить обе стойки и перейти в ST_FAULT.

    if (state == ST_RUN)
    {
        // ЗАДАНИЕ 5: ПИ-регулятор тока: e = i_ref - i_meas, u = KP*e + xi,
        // ограничение |u| <= U_MAX, интегрирование xi += KI*TS*e только
        // если оно не углубляет насыщение (условное интегрирование).
        e = i_ref - i_meas;
        u = 0.0f;
        u_ref = u;

        // ЗАДАНИЕ 6: однополярная модуляция: d = 0,5 + u/(2 Ud),
        // стойка A с заполнением d, стойка B с заполнением 1 - d.
        d = 0.5f;
        EPwm1Regs.CMPA.bit.CMPA = (Uint16)(d * TBPRD_VAL);
    }

    // ЗАДАНИЕ 7: сбросить флаг ADCINT1 и подтвердить группу 1 PIE.
}
