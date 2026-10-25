// ЛР10. Комплексные испытания сервопривода с синхронным двигателем
// Заготовка программы. Вариант: __   Исполнитель: ________________
//
// Программа объединяет работы 6-9: основа - программа ЛР8 (векторное
// управление и идентификация), к ней добавляются контуры положения и скорости
// ЛР7 и аппаратная защита ЛР9. Части, отмеченные "Перенести из ЛРn",
// переносятся из своих программ; строки с пометкой ЗАДАНИЕ выполняются по
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
#define I_M           1.0f        // ЛР8
#define N_W           1           // ЛР7, ЛР8
// ЛР7: сервопривод
#define J_EST         1.0e-4f     // ЗАДАНИЕ 1: оценка момента инерции для пуска без идентификации, кг*м^2
#define I_LIM         1.0f        // ЛР7
#define V_MAX         1.0f        // ЛР7
#define A_MAX         1.0f        // ЛР7
// ЛР9: аппаратная защита
#define CMP_A         Cmpss1Regs  // ЛР9
#define CMP_B         Cmpss2Regs  // ЛР9
#define MUX_A         0           // ЛР9
#define MUX_B         2           // ЛР9
#define I_HW          1.0f        // ЛР9
#define T_SP          0.0f        // ЛР9

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
#define FILT_PRESC    9                                           // такт фильтра SYSCLK / 10: T_F = 50 нс
#define T_F           ((FILT_PRESC + 1) * 5.0e-9f)
#define FILT_N        ((Uint16)((T_SP + 50.0e-9f) / T_F) + 2)    // отсчетов в окне фильтра
#define D_HW          (HALL_S * I_HW * 4096.0f / 3.3f)            // уставка в кодах ЦАП относительно нуля датчика
#define T_W           (N_W * TS)                                  // период контура скорости
#define T_MUW         (2.0f * T_MU + T_W)                         // некомпенсируемая постоянная контура скорости
#define K_POS         (1.0f / (8.0f * T_MUW))                     // коэффициент регулятора положения, 1/с
#define W_LIM         (1.2f * V_MAX)                              // ограничение задания скорости
#define W_STOP        5.0f                                        // порог останова, рад/с (электрические)
#define N_STOP        ((Uint32)(0.010f * FSW_HZ))                 // время останова перед работой
#define I_DT          (0.01f * I_MAX)

#define ST_CAL        0
#define ST_ALIGN      1                                           // ориентация и измерение на токе I_AL
#define ST_LTEST      2                                           // импульсы напряжения по осям d и q
#define ST_R1         3                                           // измерение на токе I_R1
#define ST_JTEST      4                                           // разгон и торможение током I_J
#define ST_PSI        5                                           // ожидание вращения и измерение ЭДС
#define ST_STOP       6                                           // ожидание останова после измерения ЭДС
#define ST_RUN        7                                           // работа сервопривода
#define ST_FAULT      8

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
volatile Uint16 ident_en  = 1;      // 1 - идентификация после ориентации (задается)
volatile float  pos_ref   = 0.0f;   // заданное положение, обороты (задается)
volatile float  pos_meas  = 0.0f;   // измеренное положение, обороты (контролируется)
volatile float  n_meas    = 0.0f;   // измеренная частота вращения, об/мин
volatile float  iq_ref    = 0.0f;   // задание тока по оси q (выход регулятора скорости), А
volatile Uint16 trip_src  = 0;      // причина отключения: 1 - nFAULT, 2 - аппаратная защита, 3 - программная
volatile Uint16 trip_ph   = 0;      // фаза, в которой сработал компаратор: 1 - A, 2 - B, 3 - обе
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
volatile float  km_id     = 1.5f * POLE_P * PSI_F;   // коэффициент момента, Н*м/А
volatile float  k_acc     = 0.0f;   // прямая связь по ускорению, А*с^2/рад
volatile int32  pos_w     = 0;      // положение в предыдущем периоде контура скорости
volatile Uint16 w_cnt     = 0;
volatile float  w_meas    = 0.0f;   // измеренная скорость, рад/с
volatile float  th_tr     = 0.0f;   // положение задатчика, рад
volatile float  w_tr      = 0.0f;   // скорость задатчика, рад/с
volatile float  a_tr      = 0.0f;   // ускорение задатчика, рад/с^2
volatile float  x_w       = 0.0f;   // интегральная составляющая регулятора скорости
volatile Uint16 dac_ah    = 0;      // уставки ЦАП, коды
volatile Uint16 dac_al    = 0;
volatile Uint16 dac_bh    = 0;
volatile Uint16 dac_bl    = 0;

void InitEPwmGpio(void);
void InitFaultInput(void);
void InitAdcA(void);
void InitEQep1(void);
void InitEPwmLeg(volatile struct EPWM_REGS *p);
void PwmTrip(void);
void PwmEnable(void);
void InitCmpss(volatile struct CMPSS_REGS *c);
void InitTripXbar(void);
void SetThresholds(void);
void RunEnter(void);
void Trajectory(void);
void PosSpeedCtrl(void);
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
    // Перенести из ЛР6.
}

void InitFaultInput(void)
{
    // Перенести из ЛР6.
}

void InitAdcA(void)
{
    // Перенести из ЛР6.
}

void InitEPwmLeg(volatile struct EPWM_REGS *p)
{
    // Перенести из ЛР9 (вместе с настройкой цифрового сравнения).
    p->TBPRD = TBPRD_VAL;
}

void InitCmpss(volatile struct CMPSS_REGS *c)
{
    // Перенести из ЛР9.
}

void InitTripXbar(void)
{
    // Перенести из ЛР9.
}

void SetThresholds(void)
{
    // Перенести из ЛР9.
}

void PwmTrip(void)
{
    // Перенести из ЛР6.
}

void PwmEnable(void)
{
    // Перенести из ЛР9.
}

void InitEQep1(void)
{
    // Перенести из ЛР6.
}

__interrupt void adca1_isr(void)
{
    // Перенести из ЛР8 обработчик прерывания целиком и дополнить:
    // - ЗАДАНИЕ 4: перед пересчетом токов - определение причины отключения
    //   из ЛР9 (во всех состояниях, кроме ST_CAL и ST_FAULT); при программном
    //   отключении trip_src = 3; после калибровки - вызов SetThresholds();
    // - ЗАДАНИЕ 2: в конце ориентации при ident_en = 0 вызвать RunEnter()
    //   вместо перехода в ST_LTEST;
    // - ЗАДАНИЕ 2: в конце ST_PSI вычислить k_acc = j_id / km, km_id = km,
    //   id_done = 1 и перейти в ST_STOP; в ST_STOP задания токов нулевые,
    //   RunEnter() после N_STOP периодов с |w_e| <= W_STOP;
    // - ЗАДАНИЕ 3: в ST_RUN раз в N_W периодов вызывать PosSpeedCtrl(),
    //   задание тока iqr = iq_ref, idr = 0.

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// Переход к работе сервопривода: отсчет положения от текущего, задатчик в покое
void RunEnter(void)
{
    // ЗАДАНИЕ 2 (листинг 1): если идентификация не выполнялась (id_done = 0) -
    // j_id = J_EST, km_id по паспортному PSI_F, kp_w, ki_w, k_acc по (1);
    // обнулить pos_cnt, pos_w, w_cnt, задатчик, x_w, iq_ref; state = ST_RUN.
}

// Задатчик перемещения (ЛР7)
void Trajectory(void)
{
    // Перенести из ЛР7.
}

// Контуры положения и скорости (ЛР7) с коэффициентами по результатам идентификации
void PosSpeedCtrl(void)
{
    // Перенести из ЛР7. ЗАДАНИЕ 3: заменить постоянные KP_W, KI_W, K_ACC
    // переменными kp_w, ki_w, k_acc; положение отсчитывается от pos_cnt = 0,
    // заданного в RunEnter().
}
