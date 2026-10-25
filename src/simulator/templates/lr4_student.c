// ЛР4. Контур скорости двигателя постоянного тока с инкрементальным энкодером
// Заготовка программы. Вариант: __   Исполнитель: ________________
// TMS320F2837xD: SYSCLK = 200 МГц, EPWMCLK = 100 МГц, АЦП A 12 бит

//
// Основа - программа ЛР3. Части, отмеченные «перенести из ЛР3», заменить
// текстом своей программы ЛР3. Строки с пометкой ЗАДАНИЕ заполняются по
// методическим указаниям.

#include "F2837xD_device.h"
#include "F2837xD_Examples.h"

// ---- Данные варианта: ЛР1, ЛР2 (перенести из своих программ) ----
#define FSW_HZ        10000.0f
#define TBPRD_VAL     5000
#define DEADBAND_TCK  100
#define FAULT_GPIO    12
#define ADC_CH        0
#define ACQPS_VAL     14

// ---- Данные варианта: ЛР3 (перенести из своей программы) ----
#define UD            24.0f       // напряжение звена, В
#define R_A           1.0f        // сопротивление якоря, Ом
#define L_A           1.0e-3f     // индуктивность якоря, Гн
#define HALL_S        0.100f      // чувствительность датчика Холла, В/А
#define CS_POL        (1.0f)      // полярность датчика
#define T_BS          1.0e-6f     // наименьший импульс нижнего ключа, с
#define I_TRIP        10.0f       // уставка защиты по току, А

// ---- Данные варианта: ЛР4 ----
#define KE            0.1f        // ЗАДАНИЕ 1: коэффициент ЭДС и момента, В*с/рад
#define J_SUM         1.0e-3f     // ЗАДАНИЕ 1: суммарный момент инерции, кг*м^2
#define ENC_LINES     1000        // ЗАДАНИЕ 1: число штрихов энкодера
#define N_SPD         10          // ЗАДАНИЕ 1: период контура скорости в периодах ШИМ
#define I_LIM         10.0f       // ЗАДАНИЕ 1: ограничение задания тока, А
#define CCPS_VAL      0           // ЗАДАНИЕ 1: CAPCLK = SYSCLK / 2^CCPS
#define UPPS_VAL      0           // ЗАДАНИЕ 1: событие захвата на каждом импульсе счета

#define TS            (1.0f / FSW_HZ)
#define CAL_N         256
#define K_ADC         (1.0f)      // перенести из ЛР3
#define T_DT          (DEADBAND_TCK * 10.0e-9f)
#define D_MAX         (1.0f)      // перенести из ЛР3
#define U_MAX         UD          // перенести из ЛР3
#define T_MU          TS          // перенести из ЛР3
#define KP            (0.0f)      // перенести из ЛР3
#define KI            (0.0f)      // перенести из ЛР3

#define CPR           (2.0f * ENC_LINES)          // импульсов на оборот (XCR = 1)
#define T_SPD         (N_SPD * TS)
#define T_CAP         ((float)(1 << CCPS_VAL) / 200.0e6f)          // период CAPCLK, с
#define K_POS         (6.2831853f / CPR)                          // рад на импульс счета
#define N_MT          2           // наименьшее число импульсов в интервале
#define T_HOLD        0.02f       // наибольший интервал измерения, с
#define T_MUW         (1.0f)      // ЗАДАНИЕ 1: некомпенсируемая постоянная контура скорости
#define KPW           (0.0f)      // ЗАДАНИЕ 1: симметричный оптимум, А*с/рад
#define KIW           (0.0f)      // ЗАДАНИЕ 1
#define KF            (1.0f)      // ЗАДАНИЕ 1: коэффициент фильтра задания
#define RPM2RAD       0.10471976f

#define ST_CAL        0
#define ST_RUN        1
#define ST_FAULT      2

// ---- Интерфейсные переменные ----
volatile float  n_ref     = 0.0f;   // задание частоты вращения, об/мин (задается)
volatile float  n_meas    = 0.0f;   // измеренная частота вращения, об/мин (контролируется)
volatile float  i_ref     = 0.0f;   // задание тока от регулятора скорости, А
volatile float  i_meas    = 0.0f;   // измеренный ток, А

volatile float  w_meas    = 0.0f;   // измеренная угловая скорость, рад/с
volatile float  tau_start = 0.0f;   // время от последнего импульса до начала интервала, с
volatile float  t_acc     = 0.0f;   // длительность текущего интервала измерения, с
volatile Uint16 stopped   = 1;      // 1 - в предыдущем интервале импульсов не было
volatile Uint16 spd_ready = 0;      // 1 - получено первое измерение скорости
volatile float  w_f       = 0.0f;   // задание скорости после фильтра, рад/с
volatile float  xw        = 0.0f;   // интегральная составляющая регулятора скорости, А
volatile Uint32 pos_start = 0;
volatile Uint16 spd_cnt   = 0;

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
void InitEQep1(void);
void SpeedMeas(void);
void SpeedCtrl(void);
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

    InitEPwmLeg(&EPwm1Regs);                // стойка A
    InitEPwmLeg(&EPwm2Regs);                // стойка B

    // запуск АЦП от ePWM1 в момент TBCTR = TBPRD
    EPwm1Regs.ETSEL.bit.SOCAEN  = 1;
    EPwm1Regs.ETSEL.bit.SOCASEL = ET_CTR_PRD;
    EPwm1Regs.ETPS.bit.SOCAPRD  = ET_1ST;

    PwmTrip();                              // выходы отключены до окончания калибровки

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 1;   // одновременный пуск обоих счетчиков
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
    GpioCtrlRegs.GPAPUD.bit.GPIO2  = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO3  = 1;
    GpioCtrlRegs.GPAMUX1.bit.GPIO0 = 1;     // EPWM1A - верхний ключ стойки A
    GpioCtrlRegs.GPAMUX1.bit.GPIO1 = 1;     // EPWM1B - нижний ключ стойки A
    GpioCtrlRegs.GPAMUX1.bit.GPIO2 = 1;     // EPWM2A - верхний ключ стойки B
    GpioCtrlRegs.GPAMUX1.bit.GPIO3 = 1;     // EPWM2B - нижний ключ стойки B
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
    // Перенести из своей программы ЛР3.
}

void InitEQep1(void)
{
    // ЗАДАНИЕ 2: выводы GPIO20, GPIO21, GPIO23 - входы EQEP1A, EQEP1B, EQEP1I
    // (GPAMUX2), подтяжка отключена, синхронизация с SYSCLK (GPAQSEL2 = 0).

    // ЗАДАНИЕ 3: квадратурный декодер (QDECCTL.QSRC = 0) со счетом фронтов
    // канала A (XCR = 1), QPOSMAX = 0xFFFFFFFF, сброс только по переполнению
    // (QEPCTL.PCRM = 1), защелка таймеров захвата при чтении QPOSCNT (QCLM = 0),
    // QPOSINIT = 0 и загрузка (SWI = 1), включение счетчика (QPEN = 1).
    // Блок захвата: CCPS = CCPS_VAL, UPPS = UPPS_VAL, CEN = 1.
}

void InitEPwmLeg(volatile struct EPWM_REGS *p)
{
    // Перенести из своей программы ЛР3.
}

void PwmTrip(void)
{
    // Перенести из своей программы ЛР3.
}

void PwmEnable(void)
{
    // Перенести из своей программы ЛР3.
}

__interrupt void adca1_isr(void)
{
    float e, u, d;

    // Перенести из своей программы ЛР3: чтение результата, калибровка нуля
    // (по окончании дополнительно xw = 0 и w_f = w_meas), пересчет в ток,
    // защита по току.

    // ЗАДАНИЕ 4: раз в N_SPD вызовов (счетчик spd_cnt) вызывать SpeedMeas()
    // во всех состояниях и SpeedCtrl() только в состоянии ST_RUN.

    if (state == ST_RUN)
    {
        // Перенести из своей программы ЛР3: ПИ-регулятор тока и однополярная
        // модуляция.
        // ЗАДАНИЕ 7: добавить к заданию напряжения компенсацию ЭДС KE * w_meas.
        e = i_ref - i_meas;
        u = 0.0f;
        u_ref = u;
        d = 0.5f;
        EPwm1Regs.CMPA.bit.CMPA = (Uint16)(d * TBPRD_VAL);
    }

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

void SpeedMeas(void)
{
    Uint32 pos;
    int32  dpos;
    float  tau, dt;

    // ЗАДАНИЕ 5: М/Т-метод по листингу 1 методических указаний:
    // чтение QPOSCNT (защелкивает QCTMRLAT), время от последнего импульса
    // tau = QCTMRLAT * T_CAP (при COEF - наибольшее значение таймера), сброс
    // флагов QEPSTS; интервал измерения не короче N_MT импульсов и не длиннее
    // T_HOLD; после остановки интервал начинается с первого импульса.
    // Результат - w_meas, рад/с; spd_ready = 1 после первого измерения.
    pos = EQep1Regs.QPOSCNT;
    dpos = (int32)(pos - pos_start);
    pos_start = pos;
    w_meas = 0.0f;
    spd_ready = 1;

    n_meas = w_meas / RPM2RAD;
}

void SpeedCtrl(void)
{
    float e, iw;

    // ЗАДАНИЕ 6: до первого измерения: w_f = w_meas, xw = 0, i_ref = 0.
    // Затем фильтр задания w_f += KF * (n_ref * RPM2RAD - w_f), ПИ-регулятор
    // скорости с ограничением |i_ref| <= I_LIM и условным интегрированием.
    e  = 0.0f;
    iw = 0.0f;
    i_ref = iw;
}
