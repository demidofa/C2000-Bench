// ЛР1. Формирование управляющих импульсов стойки инвертора
// Заготовка программы. Вариант: __   Исполнитель: ________________
// TMS320F2837xD: SYSCLK = 200 МГц, EPWMCLK = 100 МГц
//
// Строки с пометкой ЗАДАНИЕ заполняются по методическим указаниям.
// Программа собирается и в таком виде, но не проходит испытания.

#include "F2837xD_device.h"
#include "F2837xD_Examples.h"

// ---- Данные варианта ----
#define FSW_HZ        10000.0f    // ЗАДАНИЕ 1: частота ШИМ своего варианта, Гц
#define TBPRD_VAL     0           // ЗАДАНИЕ 1: период для счета вверх-вниз
#define DEADBAND_TCK  0           // ЗАДАНИЕ 2: мертвое время в тактах по 10 нс
#define FAULT_GPIO    0           // ЗАДАНИЕ 3: вывод сигнала nFAULT

#define TS            (1.0f / FSW_HZ)
#define TWO_PI        6.2831853f

// ---- Интерфейсные переменные: задаются при испытаниях, не переименовывать ----
volatile float  m_index   = 0.8f;   // глубина модуляции
volatile float  f_out     = 50.0f;  // частота выходного напряжения, Гц

volatile float  theta     = 0.0f;   // фаза задания, рад
volatile float  duty      = 0.5f;   // коэффициент заполнения
volatile Uint32 isr_count = 0;      // число вызовов обработчика

void InitEPwm1Gpio(void);
void InitFaultInput(void);
void InitEPwm1(void);
__interrupt void epwm1_isr(void);

void main(void)
{
    InitSysCtrl();

    InitEPwm1Gpio();
    InitFaultInput();

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.EPWM1_INT = &epwm1_isr;
    EDIS;

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 0;
    EDIS;

    InitEPwm1();

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 1;
    EDIS;

    IER |= M_INT3;
    PieCtrlRegs.PIEIER3.bit.INTx1 = 1;
    EINT;
    ERTM;

    for(;;)
    {
    }
}

void InitEPwm1Gpio(void)
{
    // ЗАДАНИЕ 4: отключить подтяжку на GPIO0 и GPIO1 и подключить их
    // к выходам EPWM1A и EPWM1B. Регистры GPIO защищены.
}

void InitFaultInput(void)
{
    // ЗАДАНИЕ 3: настроить вывод FAULT_GPIO как вход с подтяжкой
    // и подать его на вход INPUT1 модуля Input X-BAR (сигнал TZ1).
}

void InitEPwm1(void)
{
    // ЗАДАНИЕ 5. Счетчик: период, обнуление счетчика, счет вверх-вниз,
    // теневая загрузка периода, делители HSPCLKDIV и CLKDIV.

    // ЗАДАНИЕ 6. Сравнение: теневой CMPA с загрузкой при TBCTR = 0,
    // начальное значение - половина периода.

    // ЗАДАНИЕ 7. Выход A: сброс при TBCTR = CMPA на счете вверх,
    // установка при TBCTR = CMPA на счете вниз.

    // ЗАДАНИЕ 2. Мертвое время: B - инверсия A, задержка обоих фронтов.

    // ЗАДАНИЕ 3. Аварийное отключение: оба выхода в низкий уровень,
    // источник TZ1, однократное отключение с фиксацией, сброс флагов.

    // ЗАДАНИЕ 8. Прерывание в начале каждого периода (TBCTR = 0).
}

__interrupt void epwm1_isr(void)
{
    theta += TWO_PI * f_out * TS;
    if (theta >= TWO_PI) theta -= TWO_PI;

    duty = 0.5f + 0.5f * m_index * sinf(theta);

    // ЗАДАНИЕ 9: ограничить duty диапазоном от 0 до 1.

    EPwm1Regs.CMPA.bit.CMPA = (Uint16)(duty * TBPRD_VAL);

    isr_count++;

    // ЗАДАНИЕ 8: сбросить флаг прерывания ePWM1 и подтвердить группу 3 PIE.
}
