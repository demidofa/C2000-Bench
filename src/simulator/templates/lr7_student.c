// ЛР7. Сервопривод с синхронным двигателем с постоянными магнитами
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
#define R_S           1.00f       // ЛР6
#define L_D           1.0e-3f     // ЛР6
#define L_Q           1.0e-3f     // ЛР6
#define PSI_F         0.0100f     // ЛР6
#define I_AL          0.0f        // ЛР6
#define T_AL          0.100f      // ЛР6
#define J_SUM         1.0e-4f     // ЗАДАНИЕ 1: суммарный момент инерции, кг*м^2
#define N_W           1           // ЗАДАНИЕ 1: период контура скорости в периодах ШИМ
#define I_LIM         1.0f        // ЗАДАНИЕ 1: ограничение задания тока i_q, А
#define V_MAX         10.0f       // ЗАДАНИЕ 1: наибольшая скорость перемещения, рад/с
#define A_MAX         100.0f      // ЗАДАНИЕ 1: ускорение задатчика, рад/с^2

#define TS            (1.0f / FSW_HZ)
#define CAL_N         256
#define K_ADC         (CS_POL * (3.3f / 4096.0f) / HALL_S)
#define TWO_PI        6.2831853f
#define SQRT3_INV     0.57735027f
#define ENC_Z         (4L * ENC_LINES)                            // импульсов на оборот, XCR = 0
#define K_TH          (TWO_PI / ENC_Z)                            // радиан на импульс
#define T_MU          TS                                          // некомпенсируемая постоянная времени
#define KP_D          (0.0f)      // ЛР6
#define KP_Q          (0.0f)      // ЛР6
#define KI_D          (0.0f)      // ЛР6
#define KI_Q          (0.0f)      // ЛР6
#define U_LIM         (0.0f)      // ЛР6
#define K_W           (TS / 1.0e-3f)                              // фильтр оценки скорости, 1 мс
#define T_W           (N_W * TS)                                  // период контура скорости
#define K_M           (1.5f * POLE_P * PSI_F)                     // коэффициент момента, Н*м/А
#define T_MUW         (0.0f)      // ЗАДАНИЕ 1: некомпенсируемая постоянная контура скорости, с
#define KP_W          (0.0f)      // ЗАДАНИЕ 1: симметричный оптимум, А*с/рад
#define KI_W          (0.0f)      // ЗАДАНИЕ 1: А/рад
#define K_POS         (0.0f)      // ЗАДАНИЕ 1: коэффициент регулятора положения, 1/с
#define K_ACC         (0.0f)      // ЗАДАНИЕ 1: прямая связь по ускорению, А*с^2/рад
#define W_LIM         (1.2f * V_MAX)                              // ограничение задания скорости
#define K_CNT         (TWO_PI / ENC_Z)                            // радиан на импульс (механических)
#define N_AL          ((Uint32)(T_AL * FSW_HZ))
#define K_DT          (0.0f)      // ЛР6
#define I_DT          (0.01f * I_MAX)

#define ST_CAL        0
#define ST_ALIGN      1
#define ST_RUN        2
#define ST_FAULT      3

// ---- Интерфейсные переменные ----
volatile float  pos_ref   = 0.0f;   // заданное положение, обороты (задается)
volatile float  pos_meas  = 0.0f;   // измеренное положение, обороты (контролируется)
volatile float  n_meas    = 0.0f;   // измеренная частота вращения, об/мин
volatile float  id_ref    = 0.0f;   // задание тока по оси d, А
volatile float  iq_ref    = 0.0f;   // задание тока по оси q, А (выход регулятора скорости)
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
volatile int32  pos_cnt   = 0;      // положение, импульсы (многооборотное)
volatile int32  pos_w     = 0;      // положение в предыдущем периоде контура скорости
volatile Uint16 w_cnt     = 0;
volatile float  w_meas    = 0.0f;   // измеренная скорость, рад/с
volatile float  th_tr     = 0.0f;   // положение задатчика, рад
volatile float  w_tr      = 0.0f;   // скорость задатчика, рад/с
volatile float  a_tr      = 0.0f;   // ускорение задатчика, рад/с^2
volatile float  x_w       = 0.0f;   // интегральная составляющая регулятора скорости

void InitEPwmGpio(void);
void InitFaultInput(void);
void InitAdcA(void);
void InitEQep1(void);
void InitEPwmLeg(volatile struct EPWM_REGS *p);
void PwmTrip(void);
void PwmEnable(void);
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
    // Перенести из своей программы ЛР6 и дополнить:
    // ЗАДАНИЕ 2.
    // - после вычисления приращения dp: pos_cnt += dp;
    // - в конце ориентации обнулить pos_cnt, pos_w, w_cnt, th_tr, w_tr, a_tr, x_w;
    // - в состоянии ST_RUN раз в N_W вызовов вызывать PosSpeedCtrl();
    // - задание id_ref = 0, iq_ref - выход регулятора скорости.

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// Задатчик перемещения. Скорость задатчика ограничена значением V_MAX,
// кривой торможения и остатком пути за период; приращение скорости за период
// не более A_MAX*T_W. Кривая торможения учитывает дискретность: при торможении
// с шагом A_MAX*T_W путь до остановки равен w^2/(2*A_MAX) + w*T_W/2.
void Trajectory(void)
{
    // ЗАДАНИЕ 5: задатчик перемещения по листингу 2: скорость w_tr не более
    // V_MAX, кривой торможения и остатка пути за период; приращение скорости
    // за период не более A_MAX*T_W; a_tr - ускорение, th_tr += w_tr*T_W.
}

// Контуры положения и скорости, период T_W
void PosSpeedCtrl(void)
{
    float th, w_ref, e, i;
    int32 d;

    // ЗАДАНИЕ 3: измерение скорости w_meas по приращению pos_cnt за период,
    // n_meas, положение th (рад) и pos_meas (обороты).
    th = 0.0f;

    // ЗАДАНИЕ 4: регулятор положения с прямой связью по скорости,
    // ограничение задания скорости W_LIM; ПИ-регулятор скорости с прямой
    // связью по ускорению, ограничением I_LIM и условным интегрированием.
    iq_ref = 0.0f;

    Trajectory();                               // задание на следующий период
}
