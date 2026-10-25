// ЛР6. Векторное управление синхронным двигателем с постоянными магнитами
// Заготовка программы. Вариант: __   Исполнитель: ________________
//
// Основа - программы ЛР4 (eQEP1) и ЛР5 (три стойки, токи двух фаз,
// векторная ШИМ). Строки с пометкой ЗАДАНИЕ заполняются по методическим
// указаниям.
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
#define UD            300.0f      // ЗАДАНИЕ 1: напряжение звена, В
#define HALL_S        0.100f      // ЗАДАНИЕ 1: чувствительность датчиков, В/А
#define CS_POL        (1.0f)      // ЗАДАНИЕ 1: полярность датчиков
#define I_MAX         10.0f       // ЗАДАНИЕ 1: уставка защиты по амплитуде тока, А
#define POLE_P        1           // ЗАДАНИЕ 1: число пар полюсов
#define ENC_LINES     1000        // ЗАДАНИЕ 1: число штрихов энкодера
#define R_S           1.00f       // ЗАДАНИЕ 1: сопротивление фазы, Ом
#define L_D           1.0e-3f     // ЗАДАНИЕ 1: индуктивность по оси d, Гн
#define L_Q           1.0e-3f     // ЗАДАНИЕ 1: индуктивность по оси q, Гн
#define PSI_F         0.0100f     // ЗАДАНИЕ 1: потокосцепление магнитов, Вб
#define I_AL          0.0f        // ЗАДАНИЕ 1: ток начальной ориентации, А
#define T_AL          0.100f      // ЗАДАНИЕ 1: время начальной ориентации, с

#define TS            (1.0f / FSW_HZ)
#define CAL_N         256
#define K_ADC         (CS_POL * (3.3f / 4096.0f) / HALL_S)
#define TWO_PI        6.2831853f
#define SQRT3_INV     0.57735027f
#define ENC_Z         (4L * ENC_LINES)                            // импульсов на оборот, XCR = 0
#define K_TH          (TWO_PI / ENC_Z)                            // радиан на импульс
#define T_MU          TS                                          // некомпенсируемая постоянная времени
#define KP_D          (0.0f)      // ЗАДАНИЕ 1: пропорциональный коэффициент регулятора i_d, В/А
#define KP_Q          (0.0f)      // ЗАДАНИЕ 1: пропорциональный коэффициент регулятора i_q, В/А
#define KI_D          (0.0f)      // ЗАДАНИЕ 1: интегральный коэффициент регулятора i_d, В/(А*с)
#define KI_Q          (0.0f)      // ЗАДАНИЕ 1: интегральный коэффициент регулятора i_q, В/(А*с)
#define U_LIM         (0.0f)      // ЗАДАНИЕ 1: ограничение амплитуды вектора напряжения, В
#define K_W           (TS / 1.0e-3f)                              // фильтр оценки скорости, 1 мс
#define N_AL          ((Uint32)(T_AL * FSW_HZ))
#define K_DT          (0.0f)      // ЗАДАНИЕ 1: компенсация мертвого времени, доля периода
#define I_DT          (0.01f * I_MAX)

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

void InitEPwmGpio(void);
void InitFaultInput(void);
void InitAdcA(void);
void InitEQep1(void);
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
    InitEQep1();

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
    // Перенести из своей программы ЛР5.
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
    // Перенести из своей программы ЛР5.
}

void InitEPwmLeg(volatile struct EPWM_REGS *p)
{
    // Перенести из своей программы ЛР5.
    p->TBPRD = TBPRD_VAL;
}

void PwmTrip(void)
{
    // Перенести из своей программы ЛР5.
}

void PwmEnable(void)
{
    // Перенести из своей программы ЛР5.
}

void InitEQep1(void)
{
    // ЗАДАНИЕ 2. Перенести из своей программы ЛР4 и изменить: счет фронтов
    // обоих каналов (XCR = 0), QPOSMAX = ENC_Z - 1, сброс по достижении
    // QPOSMAX (PCRM = 1); блок захвата не нужен.
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

    // ЗАДАНИЕ 3: положение pos = QPOSCNT, приращение dp за период с учетом
    // перехода через ноль, оценка скорости w_e с фильтром K_W,
    // электрический угол theta_e = ((pos * POLE_P) % ENC_Z) * K_TH.

    // Перенести из своей программы ЛР5: калибровка нуля, пересчет кодов в
    // токи i_a, i_b, защита. По окончании калибровки - переход в ST_ALIGN,
    // al_cnt = 0, включение выходов. Защита действует в ST_ALIGN и ST_RUN.

    if (state == ST_ALIGN || state == ST_RUN)
    {
        if (state == ST_ALIGN)
        {
            // ЗАДАНИЕ 4: начальная ориентация: th = thu = 0, idr нарастает
            // до I_AL за четверть N_AL, iqr = 0; после N_AL периодов -
            // QPOSCNT = 0 (SWI = 1), pos_prev = 0, w_e = 0, сброс
            // интегральных составляющих, переход в ST_RUN.
            th = 0.0f;  thu = 0.0f;  idr = 0.0f;  iqr = 0.0f;
        }
        else
        {
            th = theta_e;
            thu = theta_e;                          // ЗАДАНИЕ 7: поворот на 1,5 периода
            idr = id_ref;
            iqr = iq_ref;
        }

        // ЗАДАНИЕ 5: преобразования Кларк (i_al, i_be) и Парка (i_d, i_q)
        // с углом th.

        // ЗАДАНИЕ 6: ПИ-регуляторы токов с компенсацией перекрестных связей
        // и ЭДС, ограничение амплитуды вектора (ud, uq) значением U_LIM,
        // условное интегрирование.
        ud = 0.0f;  uq = 0.0f;
        u_d = ud;  u_q = uq;

        // ЗАДАНИЕ 7: обратные преобразования Парка с углом thu и Кларк:
        // ua, ub, uc.
        ua = 0.0f;  ub = 0.0f;  uc = 0.0f;

        // ЗАДАНИЕ 8: перенести из своей программы ЛР5 добавку нулевой
        // последовательности, компенсацию мертвого времени и вычисление
        // коэффициентов заполнения da, db, dc.
        da = 0.5f;  db = 0.5f;  dc = 0.5f;

        EPwm1Regs.CMPA.bit.CMPA = (Uint16)(da * TBPRD_VAL);
        EPwm2Regs.CMPA.bit.CMPA = (Uint16)(db * TBPRD_VAL);
        EPwm3Regs.CMPA.bit.CMPA = (Uint16)(dc * TBPRD_VAL);
    }

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
