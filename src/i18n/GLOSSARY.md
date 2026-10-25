# Translation rules for the English build of «Стенд C2000» → "C2000 Bench"

Input: chunkN.json — list of {"ru": <exact source text>, "files": [...]}. Output: chunkN.en.json — a JSON object {"<ru exactly as given>": "<English>"} with EVERY ru key present.

The "ru" text is the raw content of a JS/HTML string literal, an HTML text node, or a C comment/string, taken verbatim from source code. Your English replaces it in place, so:
- Keep every non-Russian part byte-exact: HTML tags and attributes (<b>, <sub>, <code>, class="..."), code identifiers (EPwm1Regs.TBCTL.bit.CTRMODE, TB_COUNT_UPDOWN, ADCINT1, i_meas), numbers, placeholders, escape sequences (\n, ·, \\, \'), leading/trailing spaces, leading/trailing punctuation (":", ", ", " (", "; "), and C comment markers ("//", "/*", "*/") with their spacing and alignment as far as possible.
- NEVER introduce apostrophes ' , double quotes " or backticks ` that are not already in the source text (write "do not", "the motor speed" — no possessive 's). Use «» → “” is NOT allowed either; translate «X» as "X" only if the original had escaped quotes; otherwise write X without quotes or keep the same «» characters. Simplest: keep «» characters as they are.
- Fragments are concatenated with numbers at runtime ('Частота ' + f + ' кГц'): translate fragment-by-fragment so the joined sentence reads correctly; keep the leading/trailing space.
- Decimal separator: the English build uses a point. If the ru text contains a literal number with comma like "0,8", write "0.8".
- Russian letters must not remain in the output, except inside «» names of buttons that are themselves translated (translate the button name too).
- Register names, module names, C code stay as is. Keep the test identifiers: И1..И15 → I1..I15 (also inside text, e.g. "проверка И5" → "check I5"). Mode letters A, B, C, D stay.

Style: concise technical English for an engineering UI, sentence case for labels, imperative for instructions ("Click Run", "Declare the variable in the program").

Glossary (use consistently):
- Стенд C2000 → C2000 Bench; стенд → the bench
- Собрать и запустить → Build and run; Копировать для CCS → Copy for CCS; Исходный текст → Source text; Заготовка ЛРN → Template LabN; Открыть заготовку → Open template; Провести испытания → Run acceptance tests; Сохранить протокол → Save test report; Презентация → Presentation
- ЛР1..ЛР10 → Lab 1..Lab 10 (in compact UI places "ЛР3" → "Lab 3"); лабораторная работа → lab; работа № 6 → Lab 6
- Вкладки: Измерения → Measurements; Приемка → Acceptance; Регистры → Registers; Переменные → Variables; Справка → Help; Опыты → Experiments; Сообщения → Messages
- приемочные испытания → acceptance tests; проверка → check; протокол испытаний → test report; программа и методика испытаний → test programme; режим A испытаний → test mode A; вариант → variant; исходные данные варианта → variant data; Исполнитель → Student; Группа → Group; Работа → Lab; заключение «Программа соответствует требованиям» → "The program meets the requirements"; «не соответствует» → "does not meet the requirements"
- сведения / замечание / ошибка (message levels) → info / warning / error
- осциллограф → oscilloscope; луч/канал → trace/channel; Весь интервал → Full interval; Два периода ШИМ → Two PWM periods; Мертвое время → Dead time; Авария → Fault
- ШИМ → PWM; мертвое время → dead time; сквозной ток → shoot-through; стойка (инвертора) → leg; верхний/нижний ключ → high-side/low-side switch; ключ → switch; обратный диод → freewheeling diode; звено постоянного тока → DC link; напряжение звена Ud → DC-link voltage Ud
- обработчик прерывания → interrupt service routine (ISR); фоновый цикл → background loop; защищенный регистр → protected register; тактирование → clock; поле регистра → register field; теневой регистр → shadow register; сторожевой таймер → watchdog
- аварийное отключение → trip; однократное отключение → one-shot trip; циклическое → cycle-by-cycle; сигнал аварии драйвера nFAULT → gate-driver fault signal nFAULT; подтяжка → pull-up
- датчик тока → current sensor; на эффекте Холла → Hall-effect; шунт → shunt; калибровка нуля → zero calibration; коэффициент заполнения → duty cycle; глубина модуляции → modulation index; перемодуляция → overmodulation
- двигатель постоянного тока → DC motor; якорь → armature; асинхронный двигатель → induction motor; центробежный насос → centrifugal pump; синхронный двигатель с постоянными магнитами, СДПМ → PMSM; нагрузочная машина → load machine; энкодер → encoder; метка → index pulse
- контур тока/скорости/положения → current/speed/position loop; регулятор → controller; ПИ-регулятор → PI controller; условное интегрирование → conditional integration (anti-windup); задатчик интенсивности → ramp generator; задание → reference; технический оптимум → modulus optimum; симметричный оптимум → symmetrical optimum; прямая связь → feedforward; ошибка слежения → tracking error; перерегулирование → overshoot; время нарастания → rise time
- ориентация ротора → rotor alignment; идентификация → identification; потокосцепление → flux linkage; момент инерции → moment of inertia; ЭДС → back EMF; компенсация → compensation
- Units: В → V, А → A, мА → mA, Ом → Ω, мОм → mΩ, мГн → mH, Гн → H, мкс → µs, нс → ns, мс → ms, с → s, кГц → kHz, Гц → Hz, МГц → MHz, об/мин → rpm, рад/с → rad/s, Н·м → N·m, мН·м → mN·m, кг·м² → kg·m², кг·см² → kg·cm², Вб → Wb, В·с/рад → V·s/rad, имп. → counts, рад → rad, град, ° → °
- Обозначения переменных в индексах: f<sub>ШИМ</sub> → f<sub>PWM</sub>; I<sub>ном</sub> → I<sub>nom</sub>; U<sub>ном</sub> → U<sub>nom</sub>; R<sub>я</sub> → R<sub>a</sub>; L<sub>я</sub> → L<sub>a</sub>; k<sub>Е</sub>, k<sub>М</sub> → k<sub>E</sub>, k<sub>T</sub>; T<sub>μ</sub> stays; i<sub>якоря</sub> → i<sub>a</sub>.
- In C template comments: "ЗАДАНИЕ 2" → "TASK 2"; keep the comment layout; "заполняется студентом" → "to be completed by the student".
