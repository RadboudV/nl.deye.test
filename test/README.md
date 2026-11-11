# Tests

`npm test` compiles the app and the tests (into `.testbuild/`, which is not committed) and runs every
`*.test.ts` in this folder. `npm test -- timesync` runs only the suites with that text in their name.

The tests run on a fake inverter (a memory array behind a fake Modbus client) and a minimal fake of
the Homey `Device` / `Driver` classes (`stubs/homey`). They need no Homey and no inverter, and they do **not**
prove that the app works on a real inverter: register addresses, scaling and write behaviour must still be
checked on the hardware.

| Suite | Covers |
|---|---|
| registers-read | reading all registers in blocks, skipping rejected registers, timeouts |
| protocol | protocol version detection, register sets per version, writes only on verified versions |
| controls | the write functions behind the flow actions (checks, bit handling, read-back) |
| settings | the Deye Settings mirroring inverter registers (read each poll, write on change) |
| conditions | grid available / feeding, battery charging / discharging, solar production |
| flowcards | cards per driver, run listeners, errors when the inverter is unavailable |
| battery-actions | the `set_battery_*` action cards and the registers they write |
| triggers | debounced grid triggers and power-changed triggers |
| timesync | inverter clock registers 62-64 and the daily sync rules |
| solar / generator / battery-snapshot | the child devices reading their register group from the snapshot |
| ownusage / homeload-energy | own-usage counters and the imported home load counters |

When you add a register or a setting, extend the matching suite. Suites print `ok` / `FAIL` per check and
exit non-zero on a failure.
