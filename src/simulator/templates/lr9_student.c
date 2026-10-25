// ЛР9. Аппаратная токовая защита инвертора на компараторах CMPSS
// Заготовка программы. Вариант: __   Исполнитель: ________________
//
// Основа - программа ЛР6. Части, отмеченные "Перенести из своей программы
// ЛР6", переносятся без изменений. Строки с пометкой ЗАДАНИЕ заполняются по
// методическим указаниям.
// TMS320F2837xD: SYSCLK = 200 МГц, EPWMCLK = 100 МГц, АЦП A 12 бит

#include "F2837xD_device.h"
#include "F2837xD_Examples.h"

// ---- Данные варианта ----
#define FSW_HZ        10000.0f    // ЛР6
#define TBPRD_VAL     5000        // ЛР6
#define DEADBAND_TCK  100         // ЛР6
#define FAULT_GPIO    12          // ЛР6
#define ADC_CH_A      2           // ЛР6
#define ADC_CH_B      4           // ЛР6
#define ACQPS_VAL     14          // ЛР6
#define UD            300.0f      // ЛР6
#define HALL_S        0.100f      // ЛР6
#define CS_POL        (1.0f)      // ЛР6
#define I_MAX         10.0f       // ЛР6
#define POLE_P        1           // ЛР6
#define ENC_LINES     1000        // ЛР6
#define R_S           1.00f       // ЛР6
#define L_D           1.0e-3f     // ЛР6
#define L_Q           1.0e-3f     // ЛР6
#define PSI_F         0.0100f     // ЛР6
#define I_AL          0.0f        // ЛР6
#define T_AL          0.100f      // ЛР6
// ЛР9
#define CMP_A         Cmpss1Regs  // ЗАДАНИЕ 1: модуль CMPSS, вход CMPINxP которого - ADC_CH_A
#define CMP_B         Cmpss2Regs  // ЗАДАНИЕ 1: модуль CMPSS для ADC_CH_B
#define MUX_A         0           // ЗАДАНИЕ 1: мультиплексор ePWM X-BAR модуля CMP_A
#define MUX_B         2           // ЗАДАНИЕ 1: мультиплексор ePWM X-BAR модуля CMP_B
#define I_HW          0.0f        // ЗАДАНИЕ 1: уставка аппаратной защиты, А
#define T_SP          0.0f        // ЗАДАНИЕ 1: наибольшая длительность помехи, с

#define TS            (1.0f / FSW_HZ)
#define CAL_N         256
#define K_ADC         (CS_POL * (3.3f / 4096.0f) / HALL_S)
#define TWO_PI        6.2831853f
#define SQRT3_INV     0.57735027f
#define ENC_Z         (4L * ENC_LINES)                            // импульсов на оборот, XCR = 0
#define K_TH          (TWO_PI / ENC_Z)                            // радиан на импульс
#define T_MU          TS                                          // некомпенсируемая постоянная времени
#define KP_D          (L_D / (2.0f * T_MU))                       // технический оптимум
#define KP_Q          (L_Q / (2.0f * T_MU))
#define KI_D          (R_S / (2.0f * T_MU))
#define KI_Q          (R_S / (2.0f * T_MU))
#define U_LIM         (0.0f)      // ЛР6
#define K_W           (TS / 1.0e-3f)                              // фильтр оценки скорости, 1 мс
#define N_AL          ((Uint32)(T_AL * FSW_HZ))
#define K_DT          (0.0f)      // ЛР6
#define I_DT          (0.01f * I_MAX)
#define FILT_PRESC    0                                           // ЗАДАНИЕ 2: делитель частоты отсчетов фильтра
#define T_F           ((FILT_PRESC + 1) * 5.0e-9f)
#define FILT_N        1                                           // ЗАДАНИЕ 2: число отсчетов по (5)
#define D_HW          (0.0f)                                      // ЗАДАНИЕ 2: уставка в кодах ЦАП по (3)

#define ST_CAL        0
#define ST_ALIGN      1
#define ST_RUN        2
#define ST_FAULT      3

// ---- Интерфейсные переменные ----
volatile float  id_ref    = 0.0f;   // задание тока по оси d, А (задается)
volatile float  iq_ref    = 0.0f;   // задание тока по оси q, А (задается)
volatile float  theta_e   = 0.0f;   // электрический угол ротора, рад (контролируется)
volatile float  i_d       = 0.0f;   // ток по оси d, А
volatile float  i_q       = 0.0f;   // ток по оси q, А
volatile float  i_a       = 0.0f;   // ток фазы A, А
volatile float  i_b       = 0.0f;   // ток фазы B, А
volatile float  w_e       = 0.0f;   // электрическая угловая скорость, рад/с

volatile float  x_d       = 0.0f;   // интегральные составляющие регуляторов
volatile float  x_q       = 0.0f;
volatile float  u_d       = 0.0f;
volatile float  u_q       = 0.0f;
volatile float  off_a     = 2048.0f;
volatile float  off_b     = 2048.0f;
volatile float  sum_a     = 0.0f;
volatile float  sum_b     = 0.0f;
volatile Uint16 cal_cnt   = 0;
volatile Uint32 al_cnt    = 0;
volatile Uint32 pos_prev  = 0;
volatile Uint16 state     = ST_CAL;
volatile Uint16 trip_src  = 0;      // причина отключения: 1 - nFAULT, 2 - аппаратная защита, 3 - программная
volatile Uint16 trip_ph   = 0;      // фаза, в которой сработал компаратор: 1 - A, 2 - B, 3 - обе
volatile Uint16 dac_ah    = 0;      // уставки ЦАП, коды
volatile Uint16 dac_al    = 0;
volatile Uint16 dac_bh    = 0;
volatile Uint16 dac_bl    = 0;

void InitEPwmGpio(void);
void InitFaultInput(void);
void InitAdcA(void);
void InitEQep1(void);
void InitEPwmLeg(volatile struct EPWM_REGS *p);
void InitCmpss(volatile struct CMPSS_REGS *c);
void InitTripXbar(void);
void SetThresholds(void);
void PwmTrip(void);
void PwmEnable(void);
__interrupt void adca1_isr(void);

void main(void)
{
    InitSysCtrl();

    InitEPwmGpio();
    InitFaultInput();
    InitAdcA();
    InitEQep1();
    InitCmpss(&CMP_A);
    InitCmpss(&CMP_B);
    InitTripXbar();

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
    InitEPwmLeg(&EPwm2Regs);                // фаза B
    InitEPwmLeg(&EPwm3Regs);                // фаза C

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
    // Перенести из своей программы ЛР6.
}

void InitFaultInput(void)
{
    // Перенести из своей программы ЛР6.
}

void InitAdcA(void)
{
    // Перенести из своей программы ЛР6.
}

void InitEPwmLeg(volatile struct EPWM_REGS *p)
{
    // Перенести из своей программы ЛР6.
    p->TBPRD = TBPRD_VAL;

    // ЗАДАНИЕ 4: подмодуль цифрового сравнения (листинг 1): DCTRIPSEL, TZDCSEL,
    // DCACTL, TZSEL - однократное отключение по событию DCAEVT1 от TRIP4.
}

void InitCmpss(volatile struct CMPSS_REGS *c)
{
    EALLOW;
    // ЗАДАНИЕ 3: компараторы и ЦАП (листинг 1): COMPCTL, COMPHYSCTL, COMPDACCTL,
    // начальные уставки DACHVALS = 4095, DACLVALS = 0, цифровые фильтры
    // CTRIPxFILCLKCTL, CTRIPxFILCTL (SAMPWIN, THRESH, FILINIT), выбор CTRIPxSEL.
    EDIS;
}

void InitTripXbar(void)
{
    EALLOW;
    // ЗАДАНИЕ 4: выход TRIP4 ePWM X-BAR - CTRIPH_OR_CTRIPL модулей CMP_A и CMP_B
    // (TRIP4MUX0TO15CFG, TRIP4MUXENABLE).
    EDIS;
}

void SetThresholds(void)
{
    // ЗАДАНИЕ 5: коды ЦАП dac_ah, dac_al, dac_bh, dac_bl по (4) относительно
    // off_a, off_b с ограничением 0..4095; запись в DACHVALS, DACLVALS.
}

void PwmTrip(void)
{
    // Перенести из своей программы ЛР6.
}

void PwmEnable(void)
{
    // Перенести из своей программы ЛР6.
    // ЗАДАНИЕ 5: перед включением выходов сбросить защелки компараторов
    // (COMPSTSCLR) и флаги источников отключения (TZOSTCLR) трех модулей ePWM.
}

void InitEQep1(void)
{
    // Перенести из своей программы ЛР6.
}

__interrupt void adca1_isr(void)
{
    Uint16 na, nb;
    Uint32 pos;
    int32  dp;
    float i_c, th, thu, c, s, i_al, i_be, ed, eq, ud, uq, um, k;
    float ua, ub, uc, umax, umin, u0, da, db, dc, sa, sb, sc;
    float idr, iqr;

    na = AdcaResultRegs.ADCRESULT0;
    nb = AdcaResultRegs.ADCRESULT1;

    // Перенести из своей программы ЛР6: положение, оценка скорости, угол theta_e.

    if (state == ST_CAL)
    {
        // Перенести из своей программы ЛР6: калибровка нуля датчиков.
        // ЗАДАНИЕ 5: после вычисления off_a, off_b вызвать SetThresholds().
    }
    else
    {
        // ЗАДАНИЕ 6: причина отключения (листинг 2): если в состоянии ST_ALIGN
        // или ST_RUN установлен TZFLG.OST, определить trip_src по TZOSTFLG и
        // trip_ph по защелкам COMPSTS, перейти в ST_FAULT.

        // Перенести из своей программы ЛР6: пересчет токов и программная защита;
        // ЗАДАНИЕ 6: при программном отключении trip_src = 3.
    }

    if (state == ST_ALIGN || state == ST_RUN)
    {
        // Перенести из своей программы ЛР6: ориентация, преобразования, регуляторы
        // токов, векторная ШИМ, компенсация мертвого времени, запись CMPA.
    }

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
