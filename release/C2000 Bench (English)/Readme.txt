C2000 Bench, version 1.10 (English edition)
Training simulator of the TMS320F2837xD microcontroller: ePWM1..ePWM3, ADC A,
eQEP1, CMPSS, X-BAR and the PIE interrupt controller, coupled with power stage
models: an inverter leg with an R-L load (Lab 1, Lab 2), an H-bridge with a DC
motor and a Hall-effect current sensor (Lab 3), with a load and an incremental
encoder on eQEP1 (Lab 4), a three-phase inverter with an induction motor driving
a centrifugal pump (Lab 5), a permanent magnet synchronous motor with an encoder
and a load machine (Lab 6), a servo drive with position and speed loops (Lab 7),
identification of the PMSM parameters (Lab 8), hardware overcurrent protection
on the CMPSS comparators (Lab 9) and complete acceptance testing of the servo
drive (Lab 10). Works offline and without a development kit.

START
Run "C2000 Bench.exe". No installation is needed; the file can be copied to any
Windows 10 or 11 computer. The window opens in Microsoft Edge, which is part of
Windows; if Edge is removed, Google Chrome is used.

On the first start Windows may show "Windows protected your PC" because the
program is not signed. Click "More info" and then "Run anyway".

WORK
Ctrl+Enter      build and run the simulation
Ctrl+O          open a .c file
Ctrl+S          save the file
Ctrl+Shift+S    save as
The interface follows the lab selected on the Acceptance tab. The Template
button loads the template of the selected lab. Before the editor text is
replaced, the bench asks for confirmation if the text has not been saved.

The program text is saved automatically and restored at the next start. The
file app.c in this folder contains the initial program of step 1; it can be
opened in the bench or copied into a Code Composer Studio project.

ACCEPTANCE TESTS
On the Acceptance tab enter the student name, group, lab and variant.
"Open template" loads the template of the lab. "Run acceptance tests" checks
the program according to the test programme of the lab and gives a verdict for
every check. "Save test report" saves the report as an HTML file with the
SHA-256 checksum and the full text of the tested program.

TRANSFER TO THE CHIP
The program is written for the C2000Ware header files (F2837xD_device.h,
F2837xD_Examples.h). Add F2837xD_SysCtrl.c, F2837xD_PieCtrl.c,
F2837xD_PieVect.c, F2837xD_DefaultISR.c, F2837xD_GlobalVariableDefs.c and the
linker command files to the CCS project.

EXIT
The program closes itself a few seconds after all its windows are closed. If
the window does not open, the program shows a message with the local address of
the bench, which can be opened in any browser.

The Russian edition "Стенд C2000.exe" is a separate program and can run at the
same time.
