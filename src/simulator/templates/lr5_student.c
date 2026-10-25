// ЛР5. Частотное управление асинхронным двигателем насоса
// Заготовка программы. Вариант: __   Исполнитель: ________________
//
// Основа - программы ЛР2 и ЛР3. Силовая часть - трехфазный инвертор:
// фаза A - ePWM1 (GPIO0, GPIO1), фаза B - ePWM2 (GPIO2, GPIO3),
// фаза C - ePWM3 (GPIO4, GPIO5). Строки с пометкой ЗАДАНИЕ заполняются
// по методическим указаниям.
// TMS320F2837xD: SYSCLK = 200 МГц, EPWMCLK = 100 МГц, АЦП A 12 бит

#include "F2837xD_device.h"
#include "F2837xD_Examples.h"

// ---- Данные варианта ----
#define FSW_HZ        10000.0f
#define TBPRD_VAL     5000
#define DEADBAND_TCK  100         // ЗАДАНИЕ 1: мертвое время, такты EPWMCLK
#define FAULT_GPIO    12
#define ADC_CH_A      0           // ЗАДАНИЕ 1: датчик тока фазы A
#define ADC_CH_B      1           // ЗАДАНИЕ 1: датчик тока фазы B
#define ACQPS_VAL     14
#define UD            540.0f      // ЗАДАНИЕ 1: напряжение звена, В
#define HALL_S        0.100f      // ЗАДАНИЕ 1: чувствительность датчиков, В/А
#define CS_POL        (1.0f)      // ЗАДАНИЕ 1: полярность датчиков
#define I_MAX         10.0f       // ЗАДАНИЕ 1: уставка защиты по амплитуде тока, А
#define F_NOM         50.0f       // номинальная частота, Гц
#define U_NOM         311.1f      // амплитуда номинального фазного напряжения, В
#define U_BOOST       0.0f        // ЗАДАНИЕ 1: начальное напряжение закона U/f (амплитуда), В
#define T_RAMP        1.0f        // ЗАДАНИЕ 1: время разгона до номинальной частоты, с

#define TS            (1.0f / FSW_HZ)
#define CAL_N         256
#define K_ADC         (CS_POL * (3.3f / 4096.0f) / HALL_S)
#define TWO_PI        6.2831853f
#define DF_RAMP       (0.0f)      // ЗАДАНИЕ 1: приращение частоты за период ШИМ
#define K_DT          (0.0f)      // ЗАДАНИЕ 1: компенсация мертвого времени, доля периода
#define I_DT          (0.01f * I_MAX)                             // зона линейной компенсации около нуля тока

#define ST_CAL        0
#define ST_RUN        1
#define ST_FAULT      2

// ---- Интерфейсные переменные ----
volatile float  f_ref     = 0.0f;   // задание частоты, Гц (задается)
volatile float  f_out     = 0.0f;   // выходная частота после задатчика, Гц (контролируется)
volatile float  i_a       = 0.0f;   // ток фазы A, А
volatile float  i_b       = 0.0f;   // ток фазы B, А

volatile float  theta     = 0.0f;
volatile float  u_amp     = 0.0f;   // амплитуда фазного напряжения, В
volatile float  off_a     = 2048.0f;
volatile float  off_b     = 2048.0f;
volatile float  sum_a     = 0.0f;
volatile float  sum_b     = 0.0f;
volatile Uint16 cal_cnt   = 0;
volatile Uint16 state     = ST_CAL;

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

    InitEPwmLeg(&EPwm1Regs);                // фаза A
    // ЗАДАНИЕ 2: фазы B и C.

    EPwm1Regs.ETSEL.bit.SOCAEN  = 1;        // запуск АЦП при TBCTR = TBPRD
    EPwm1Regs.ETSEL.bit.SOCASEL = ET_CTR_PRD;
    EPwm1Regs.ETPS.bit.SOCAPRD  = ET_1ST;

    PwmTrip();

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 1;
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
    // ЗАДАНИЕ 2: GPIO0..GPIO5 - выходы EPWM1A..EPWM3B, подтяжка отключена.
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
    // Перенести из своей программы ЛР3 и дополнить:
    // ЗАДАНИЕ 3: SOC0 - вход ADC_CH_A, SOC1 - вход ADC_CH_B, оба с запуском
    // от ePWM1 SOCA (TRIGSEL = 5); ADCINT1 по окончании SOC1.
}

void InitEPwmLeg(volatile struct EPWM_REGS *p)
{
    // Перенести из своей программы ЛР3.
    p->TBPRD = TBPRD_VAL;
}

void PwmTrip(void)
{
    // ЗАДАНИЕ 4: отключить выходы трех стоек.
}

void PwmEnable(void)
{
    // ЗАДАНИЕ 4: включить выходы трех стоек.
}

__interrupt void adca1_isr(void)
{
    Uint16 na, nb;
    float i_c, ua, ub, uc, umax, umin, u0, da, db, dc;
    float sa, sb, sc;

    na = AdcaResultRegs.ADCRESULT0;
    nb = AdcaResultRegs.ADCRESULT1;

    // ЗАДАНИЕ 5: калибровка нуля двух датчиков (off_a, off_b), пересчет в
    // токи i_a, i_b, вычисление i_c, защита по амплитуде тока трех фаз.

    if (state == ST_RUN)
    {
        // ЗАДАНИЕ 6: задатчик интенсивности частоты (f_ref -> f_out) и
        // закон U/f (u_amp); при f_out = 0 напряжение не формируется.

        theta += TWO_PI * f_out * TS;
        if (theta >= TWO_PI) theta -= TWO_PI;

        // ЗАДАНИЕ 7: фазные задания ua, ub, uc и добавка нулевой
        // последовательности u0 = -(max + min)/2.

        // ЗАДАНИЕ 8: коэффициенты заполнения 0,5 + (u + u0)/UD с компенсацией
        // мертвого времени по знаку тока фазы, ограничение от 0 до 1.
        da = 0.5f;
        db = 0.5f;
        dc = 0.5f;

        EPwm1Regs.CMPA.bit.CMPA = (Uint16)(da * TBPRD_VAL);
        EPwm2Regs.CMPA.bit.CMPA = (Uint16)(db * TBPRD_VAL);
        EPwm3Regs.CMPA.bit.CMPA = (Uint16)(dc * TBPRD_VAL);
    }

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
