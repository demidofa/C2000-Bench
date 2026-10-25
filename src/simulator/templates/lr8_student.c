// ЛР8. Идентификация параметров СДПМ и автоматическая настройка регуляторов
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
#define ADC_CH_A      0           // ЛР6
#define ADC_CH_B      1           // ЛР6
#define ACQPS_VAL     14          // ЛР6
#define UD            300.0f      // ЛР6
#define HALL_S        0.100f      // ЛР6
#define CS_POL        (1.0f)      // ЛР6
#define I_MAX         10.0f       // ЛР6
#define POLE_P        1           // ЛР6
#define ENC_LINES     1000        // ЛР6
#define R_S           1.00f       // ЛР6 (паспортное значение)
#define L_D           1.0e-3f     // ЛР6 (паспортное значение)
#define L_Q           1.0e-3f     // ЛР6 (паспортное значение)
#define PSI_F         0.0100f     // ЛР6 (паспортное значение)
#define I_AL          0.0f        // ЛР6
#define T_AL          0.100f      // ЛР6
#define I_M           1.0f        // ЗАДАНИЕ 1: амплитуда номинального тока, А
#define N_W           1           // ЗАДАНИЕ 1: период контура скорости в периодах ШИМ (ЛР7)

#define TS            (1.0f / FSW_HZ)
#define CAL_N         256
#define K_ADC         (CS_POL * (3.3f / 4096.0f) / HALL_S)
#define TWO_PI        6.2831853f
#define SQRT3_INV     0.57735027f
#define ENC_Z         (4L * ENC_LINES)                            // импульсов на оборот, XCR = 0
#define K_TH          (TWO_PI / ENC_Z)                            // радиан на импульс
#define K_CNT_M       (TWO_PI / ENC_Z)                            // радиан механических на импульс
#define T_MU          TS                                          // некомпенсируемая постоянная времени
// идентификация
#define T_R           0.020f                                      // время измерения на уровне тока, с
#define N_R           ((Uint32)(T_R * FSW_HZ))
#define I_R1          (0.4f * I_M)                                // меньший ток измерения R
#define I_L           (I_M)                                       // ток i_d при импульсах напряжения
#define I_PSI         (0.4f * I_M)                                // ток i_d при измерении ЭДС
#define N_P           4                                           // длительность импульса напряжения, периоды
#define N_CYC         24                                          // цикл импульса с восстановлением, периоды
#define N_PUL         4                                           // импульсов по каждой оси (знаки чередуются)
#define DI_L          (0.25f * I_M)                               // ожидаемое изменение тока за импульс
#define I_J           (0.5f * I_M)                                // ток испытания разгоном
#define T_J           0.015f                                      // время разгона и торможения, с
#define N_J           ((Uint32)(T_J * FSW_HZ))
#define N_J1          ((Uint32)(0.001f * FSW_HZ))                 // 1 мс
#define W_PSI         100.0f                                      // порог скорости для измерения Psi_f, рад/с
#define N_PSI         ((Uint32)(0.020f * FSW_HZ))
#define U_LIM         (0.0f)      // ЛР6
#define K_W           (TS / 1.0e-3f)                              // фильтр оценки скорости, 1 мс
#define N_AL          ((Uint32)(T_AL * FSW_HZ))
#define K_DT          (0.0f)      // ЛР6
#define I_DT          (0.01f * I_MAX)

#define ST_CAL        0
#define ST_ALIGN      1                                           // ориентация и измерение на токе I_AL
#define ST_LTEST      2                                           // импульсы напряжения по осям d и q
#define ST_R1         3                                           // измерение на токе I_R1
#define ST_JTEST      4                                           // разгон и торможение током I_J
#define ST_PSI        5                                           // ожидание вращения и измерение ЭДС
#define ST_RUN        6                                           // работа с настроенными регуляторами
#define ST_FAULT      7

// ---- Интерфейсные переменные ----
// ---- Результаты идентификации (контролируются) ----
volatile float  r_id      = 0.0f;   // сопротивление фазы, Ом
volatile float  ld_id     = L_D;    // индуктивность по оси d, Гн (до идентификации - по паспорту)
volatile float  lq_id     = L_Q;    // индуктивность по оси q, Гн
volatile float  psi_id    = PSI_F;  // потокосцепление магнитов, Вб
volatile float  j_id      = 0.0f;   // суммарный момент инерции, кг*м^2
volatile float  kp_d      = L_D / (2.0f * T_MU);   // коэффициенты регуляторов тока,
volatile float  kp_q      = L_Q / (2.0f * T_MU);   // до идентификации - по паспорту
volatile float  ki_i      = R_S / (2.0f * T_MU);
volatile float  kp_w      = 0.0f;   // коэффициенты регулятора скорости
volatile float  ki_w      = 0.0f;
volatile Uint16 id_done   = 0;      // 1 - идентификация завершена
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
volatile Uint32 pos_prev  = 0;
volatile Uint16 state     = ST_CAL;
volatile Uint32 st_cnt    = 0;      // счетчик периодов в текущем состоянии
volatile int32  pos_cnt   = 0;      // многооборотное положение, импульсы
volatile float  acc_u     = 0.0f;   // накопители
volatile float  acc_i     = 0.0f;
volatile float  u2        = 0.0f;
volatile float  i2        = 0.0f;
volatile float  dl_d      = 0.0f;   // сумма приращений тока при импульсах
volatile float  dl_q      = 0.0f;
volatile float  i_p0      = 0.0f;
volatile float  u_p0      = 0.0f;
volatile int32  pj[8];              // положения при испытании разгоном
volatile float  acc_w     = 0.0f;

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
    // Перенести из своей программы ЛР6.
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
    // Перенести из своей программы ЛР6.
}

void InitEPwmLeg(volatile struct EPWM_REGS *p)
{
    // Перенести из своей программы ЛР6.
    p->TBPRD = TBPRD_VAL;
}

void PwmTrip(void)
{
    // Перенести из своей программы ЛР6.
}

void PwmEnable(void)
{
    // Перенести из своей программы ЛР6.
}

void InitEQep1(void)
{
    // Перенести из своей программы ЛР6.
}

__interrupt void adca1_isr(void)
{
    Uint16 na, nb, ax;
    Uint32 pos, cyc, ph;
    int32  dp;
    float i_c, th, thu, c, s, i_al, i_be, ed, eq, ud, uq, um, k, sg, du, a1, a2, km, tmw;
    float ua, ub, uc, umax, umin, u0, da, db, dc, sa, sb, sc;
    float idr, iqr;

    na = AdcaResultRegs.ADCRESULT0;
    nb = AdcaResultRegs.ADCRESULT1;

    // Перенести из своей программы ЛР6: положение pos, приращение dp, оценка
    // скорости w_e, угол theta_e; дополнить многооборотным счетом pos_cnt += dp.

    // Перенести из своей программы ЛР6: калибровка нуля (после нее - ST_ALIGN,
    // st_cnt = 0, включение выходов), пересчет токов, защита.

    if (state != ST_CAL && state != ST_FAULT)
    {
        ax = 0;  du = 0.0f;                         // импульс напряжения: ось (1 - d, 2 - q) и добавка
        th = theta_e;
        thu = theta_e + 1.5f * w_e * TS;
        idr = 0.0f;  iqr = 0.0f;

        // ЗАДАНИЕ 2: задания токов и импульсы по состояниям (листинг 1):
        // ST_ALIGN - th = thu = 0, idr нарастает до I_AL за четверть N_AL;
        // ST_LTEST - idr = I_L; первый цикл N_CYC - установление тока, далее
        //   номер импульса cyc = st_cnt / N_CYC - 1, фаза ph = st_cnt % N_CYC,
        //   ось ax = 1 для первых N_PUL импульсов, 2 для остальных, знак
        //   чередуется; при ph < N_P добавка du = +-DI_L*L/(N_P*TS), при ph > N_P ax = 0;
        // ST_R1 - idr = I_R1;  ST_JTEST - iqr = +I_J, после N_J периодов -I_J;
        // ST_PSI - idr = I_PSI;  ST_RUN - idr = id_ref, iqr = iq_ref.

        // Перенести из своей программы ЛР6: преобразования Кларк и Парка с углом th.

        // Перенести из своей программы ЛР6 регуляторы токов, заменив постоянные
        // коэффициенты переменными kp_d, kp_q, ki_i, а параметры L_D, L_Q, PSI_F
        // в компенсации перекрестных связей и ЭДС - переменными ld_id, lq_id,
        // psi_id. ЗАДАНИЕ 3: при ax == 1
        // напряжение ud = u_p0 + du, при ax == 2 uq = u_p0 + du; интегральная
        // составляющая оси, по которой подается импульс, не изменяется.
        ud = 0.0f;  uq = 0.0f;

        // ЗАДАНИЕ 4: измерения и переходы состояний (листинг 2):
        // ST_ALIGN - накопить ud и i_d за последние N_R периодов (u2, i2),
        //   по окончании - SWI = 1, обнуление pos_prev, pos_cnt, w_e, dl_d, dl_q;
        // ST_LTEST - после первого цикла: при ph == 0 запомнить i_p0, u_p0 и подать импульс в этом же
        //   периоде; при ph == N_P + 1 накопить знак*(ток - i_p0) в dl_d или dl_q;
        //   через (2*N_PUL + 1)*N_CYC периодов - ST_R1;
        // ST_R1 - накопить ud и i_d во второй половине N_R; вычислить r_id,
        //   ld_id, lq_id по (2) и (4), kp_d, kp_q, ki_i по (8);
        // ST_JTEST - запомнить pos_cnt в 8 моментах (1 и 3 мс от начала, 3 и 1 мс
        //   до конца каждого участка);
        // ST_PSI - ждать |w_e| >= W_PSI*POLE_P, пропустить N_PSI/2 периодов,
        //   накопить uq - r_id*i_q - w_e*ld_id*i_d и w_e за N_PSI периодов,
        //   вычислить psi_id по (7), j_id по (6), kp_w, ki_w по (9); id_done = 1, ST_RUN.

        u_d = ud;  u_q = uq;

        // Перенести из своей программы ЛР6: обратные преобразования с углом thu,
        // векторная ШИМ, компенсация мертвого времени, запись CMPA.
        da = 0.5f;  db = 0.5f;  dc = 0.5f;

        EPwm1Regs.CMPA.bit.CMPA = (Uint16)(da * TBPRD_VAL);
        EPwm2Regs.CMPA.bit.CMPA = (Uint16)(db * TBPRD_VAL);
        EPwm3Regs.CMPA.bit.CMPA = (Uint16)(dc * TBPRD_VAL);
    }

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
