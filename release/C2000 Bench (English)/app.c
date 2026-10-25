// app.c - Step 1. Inverter leg on ePWM1
// TMS320F2837xD: SYSCLK = 200 MHz, EPWMCLK = 100 MHz
// Load: R-L between the leg midpoint and the DC-link midpoint

#include "F2837xD_device.h"
#include "F2837xD_Examples.h"

#define FSW_HZ        10000.0f    // PWM frequency, Hz
#define TBPRD_VAL     5000        // 100 MHz / (2 * 10 kHz) in up-down count mode
#define DEADBAND_TCK  100         // dead time 1 µs = 100 TBCLK cycles
#define TS            (1.0f / FSW_HZ)
#define TWO_PI        6.2831853f

volatile float  m_index   = 0.8f;   // modulation index
volatile float  f_out     = 50.0f;  // output voltage frequency, Hz
volatile float  theta     = 0.0f;   // reference phase, rad
volatile float  duty      = 0.5f;   // duty cycle
volatile Uint32 isr_count = 0;      // number of ISR calls

void InitEPwm1Gpio(void);
void InitEPwm1(void);
__interrupt void epwm1_isr(void);

void main(void)
{
    InitSysCtrl();                          // clock, watchdog disable

    InitEPwm1Gpio();                        // GPIO0 = EPWM1A, GPIO1 = EPWM1B

    DINT;                                   // disable interrupts during configuration
    InitPieCtrl();                          // PIE to reset state
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();                     // vector table, enable PIE

    EALLOW;
    PieVectTable.EPWM1_INT = &epwm1_isr;    // own ISR for EPWM1_INT
    EDIS;

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 0;   // stop the counters of all ePWM modules
    EDIS;

    InitEPwm1();

    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 1;   // simultaneous start of the counters
    EDIS;

    IER |= M_INT3;                          // group 3 (ePWM) in the CPU
    PieCtrlRegs.PIEIER3.bit.INTx1 = 1;      // EPWM1_INT in PIE
    EINT;                                   // global interrupt enable
    ERTM;

    for(;;)
    {
        // background loop: communication, indication, slow protections
    }
}

void InitEPwm1Gpio(void)
{
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO0  = 1;     // disable pull-up
    GpioCtrlRegs.GPAPUD.bit.GPIO1  = 1;
    GpioCtrlRegs.GPAMUX1.bit.GPIO0 = 1;     // GPIO0 -> EPWM1A
    GpioCtrlRegs.GPAMUX1.bit.GPIO1 = 1;     // GPIO1 -> EPWM1B
    EDIS;
}

void InitEPwm1(void)
{
    // Counter
    EPwm1Regs.TBPRD = TBPRD_VAL;                       // period
    EPwm1Regs.TBCTR = 0;                               // reset counter
    EPwm1Regs.TBCTL.bit.CTRMODE   = TB_COUNT_UPDOWN;   // up-down count
    EPwm1Regs.TBCTL.bit.PHSEN     = TB_DISABLE;        // synchronization not used
    EPwm1Regs.TBCTL.bit.PRDLD     = TB_SHADOW;
    EPwm1Regs.TBCTL.bit.HSPCLKDIV = TB_DIV1;           // /2 here after reset
    EPwm1Regs.TBCTL.bit.CLKDIV    = TB_DIV1;

    // Compare: new CMPA value takes effect at TBCTR = 0
    EPwm1Regs.CMPCTL.bit.SHDWAMODE = CC_SHADOW;
    EPwm1Regs.CMPCTL.bit.LOADAMODE = CC_CTR_ZERO;
    EPwm1Regs.CMPA.bit.CMPA = TBPRD_VAL / 2;

    // Output A: high while TBCTR < CMPA
    EPwm1Regs.AQCTLA.bit.CAU = AQ_CLEAR;
    EPwm1Regs.AQCTLA.bit.CAD = AQ_SET;

    // Dead time: B - inverted A, both edges delayed
    EPwm1Regs.DBCTL.bit.IN_MODE  = DBA_ALL;
    EPwm1Regs.DBCTL.bit.OUT_MODE = DB_FULL_ENABLE;
    EPwm1Regs.DBCTL.bit.POLSEL   = DB_ACTV_HIC;
    EPwm1Regs.DBRED.bit.DBRED    = DEADBAND_TCK;
    EPwm1Regs.DBFED.bit.DBFED    = DEADBAND_TCK;

    // Trip: both switches off
    EALLOW;
    EPwm1Regs.TZCTL.bit.TZA = TZ_FORCE_LO;
    EPwm1Regs.TZCTL.bit.TZB = TZ_FORCE_LO;
    EDIS;

    // Interrupt at the start of each period (TBCTR = 0)
    EPwm1Regs.ETSEL.bit.INTSEL = ET_CTR_ZERO;
    EPwm1Regs.ETSEL.bit.INTEN  = 1;
    EPwm1Regs.ETPS.bit.INTPRD  = ET_1ST;
}

__interrupt void epwm1_isr(void)
{
    theta += TWO_PI * f_out * TS;
    if (theta >= TWO_PI) theta -= TWO_PI;

    duty = 0.5f + 0.5f * m_index * sinf(theta);
    EPwm1Regs.CMPA.bit.CMPA = (Uint16)(duty * TBPRD_VAL);

    isr_count++;

    // Experiment: software trip after 45 ms
    if (isr_count == 450)
    {
        EALLOW;
        EPwm1Regs.TZFRC.bit.OST = 1;
        EDIS;
    }

    EPwm1Regs.ETCLR.bit.INT = 1;               // clear ePWM1 interrupt flag
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP3;    // enable further group 3 interrupts
}
