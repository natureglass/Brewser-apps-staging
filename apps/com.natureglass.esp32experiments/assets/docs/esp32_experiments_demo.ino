/*
 * ESP32 Experiments — test firmware
 * =================================
 * A tiny companion sketch for the "ESP32 Experiments" Brewser app. It streams a
 * few clean demo channels for the Plot tab and accepts simple commands so the
 * Terminal tab is useful too.
 *
 *   Plot tab      -> shows sine / cos / tri (and an optional real ADC channel).
 *   Terminal tab  -> type a command + Send. Try:  ?   id   stop   rate 20   csv
 *
 * OUTPUT FORMAT
 *   Data lines are plain numbers the plotter understands:
 *     named (default):  sine:512.0 cos:980.3 tri:200.0
 *     csv   (type csv): 512.0,980.3,200.0
 *   Every non-data line starts with '#', which the plotter ignores as a comment
 *   (so status/help text never becomes a phantom graph series).
 *
 * ============================  IMPORTANT — USB  ============================
 * This must enumerate as USB CDC-ACM for the Switch to see it over WebSerial.
 * On a NATIVE-USB ESP32 (S3 / C3 / C6):
 *   1. Arduino IDE -> Tools -> "USB CDC On Boot" -> **Enabled**
 *      (this makes `Serial` the native USB port; without it `Serial` is UART0
 *       and the native port stays silent to the Switch).
 *   2. Plug the Switch's USB-C OTG adapter into the board's **native USB** port
 *      (the one wired to the chip, VID 0x303a), not a CH340/CP210x "UART" port.
 * A classic ESP32 with a CH340/CP210x/FTDI bridge will appear in the app's
 * "Discover" tab but is NOT yet drivable by WebSerial (CDC-ACM only).
 * =========================================================================
 *
 * No external parts required — the three demo channels are synthetic. Use
 * `adc <pin>` to graph a real analog pin (e.g. a potentiometer).
 */

#include <Arduino.h>
#include <math.h>

#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT == 0
  #warning "USB CDC On Boot is disabled: enable it (Tools menu) so the native USB port enumerates as CDC-ACM for the Switch."
#endif

// -------- state --------
static bool     streaming = true;    // start/stop
static bool     csvMode   = false;   // named vs csv output
static uint32_t sampleHz  = 50;      // 1..200
static int      adcPin    = -1;      // -1 = disabled
static uint32_t nextMs    = 0;

static String   cmdBuf;              // command line accumulator

// Triangle wave 0..1000 from a 0..1 phase.
static float triangle(float phase01) {
  float x = phase01 - floorf(phase01);
  return (x < 0.5f ? x * 2.0f : (1.0f - x) * 2.0f) * 1000.0f;
}

static void printHelp() {
  Serial.println(F("# commands:"));
  Serial.println(F("#   ?  help        this list"));
  Serial.println(F("#   start | stop   toggle streaming"));
  Serial.println(F("#   rate <hz>      sample rate 1..200"));
  Serial.println(F("#   named | csv    output format"));
  Serial.println(F("#   adc <pin>      add a real analog channel (adc off to remove)"));
  Serial.println(F("#   led <0|1>      onboard LED, if present"));
  Serial.println(F("#   id             chip / config info"));
  Serial.println(F("#   echo <text>    echo text back"));
}

static void printId() {
  Serial.print(F("# chip="));    Serial.print(ESP.getChipModel());
  Serial.print(F(" rev "));      Serial.print(ESP.getChipRevision());
  Serial.print(F(" cores "));    Serial.print(ESP.getChipCores());
  Serial.print(F(" heap "));     Serial.print(ESP.getFreeHeap());
  Serial.print(F(" | rate "));   Serial.print(sampleHz);
  Serial.print(F("Hz format ")); Serial.print(csvMode ? F("csv") : F("named"));
  Serial.print(F(" adc "));      Serial.println(adcPin < 0 ? String("off") : String(adcPin));
}

static void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  String lc = cmd; lc.toLowerCase();

  if (lc == "?" || lc == "help")      { printHelp(); }
  else if (lc == "start")             { streaming = true;  Serial.println(F("# streaming on")); }
  else if (lc == "stop")              { streaming = false; Serial.println(F("# streaming off")); }
  else if (lc == "named")             { csvMode = false;   Serial.println(F("# format=named")); }
  else if (lc == "csv")               { csvMode = true;    Serial.println(F("# format=csv")); }
  else if (lc == "id")                { printId(); }
  else if (lc.startsWith("rate")) {
    long hz = cmd.substring(4).toInt();
    if (hz < 1)   hz = 1;
    if (hz > 200) hz = 200;
    sampleHz = (uint32_t)hz;
    Serial.print(F("# rate=")); Serial.print(sampleHz); Serial.println(F("Hz"));
  }
  else if (lc.startsWith("echo")) {
    String t = cmd.substring(4); t.trim();
    Serial.print(F("# echo: ")); Serial.println(t);
  }
  else if (lc.startsWith("adc")) {
    String arg = cmd.substring(3); arg.trim();
    if (arg.length() == 0 || arg == "off") { adcPin = -1; Serial.println(F("# adc off")); }
    else { adcPin = (int)arg.toInt(); Serial.print(F("# adc pin=")); Serial.println(adcPin); }
  }
  else if (lc.startsWith("led")) {
#ifdef LED_BUILTIN
    int v = (int)cmd.substring(3).toInt();
    pinMode(LED_BUILTIN, OUTPUT);
    digitalWrite(LED_BUILTIN, v ? HIGH : LOW);
    Serial.print(F("# led=")); Serial.println(v ? 1 : 0);
#else
    Serial.println(F("# no LED_BUILTIN on this board"));
#endif
  }
  else {
    Serial.print(F("# ? unknown: ")); Serial.println(cmd);
  }
}

static void emitSample(uint32_t now) {
  float t    = now / 1000.0f;
  float sine = 500.0f + 480.0f * sinf(t * 2.0f);
  float cosv = 500.0f + 480.0f * cosf(t * 1.4f);
  float tri  = triangle(t * 0.5f);

  if (csvMode) {
    Serial.print(sine, 1); Serial.print(',');
    Serial.print(cosv, 1); Serial.print(',');
    Serial.print(tri,  1);
    if (adcPin >= 0) { Serial.print(','); Serial.print(analogRead(adcPin)); }
    Serial.println();
  } else {
    Serial.print(F("sine:")); Serial.print(sine, 1);
    Serial.print(F(" cos:")); Serial.print(cosv, 1);
    Serial.print(F(" tri:")); Serial.print(tri, 1);
    if (adcPin >= 0) { Serial.print(F(" adc:")); Serial.print(analogRead(adcPin)); }
    Serial.println();
  }
}

void setup() {
  Serial.begin(115200);            // baud is irrelevant over native USB CDC
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 2000) { delay(10); }  // wait (bounded) for host
  delay(200);
#ifdef LED_BUILTIN
  pinMode(LED_BUILTIN, OUTPUT);
#endif
  Serial.println();
  Serial.println(F("# ESP32 Experiments demo ready — type ? for commands"));
  printId();
  nextMs = millis();
}

void loop() {
  // ---- read + dispatch commands (newline-terminated) ----
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { handleCommand(cmdBuf); cmdBuf = ""; }
    else if (cmdBuf.length() < 120) cmdBuf += c;
  }

  // ---- stream samples at sampleHz ----
  if (streaming && sampleHz > 0) {
    uint32_t now    = millis();
    uint32_t period = 1000u / sampleHz;
    if ((int32_t)(now - nextMs) >= 0) {
      nextMs += period;
      if ((int32_t)(now - nextMs) > (int32_t)period) nextMs = now + period; // resync if behind
      emitSample(now);
    }
  }
}
