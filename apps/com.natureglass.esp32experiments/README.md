# ESP32 Experiments

_v1.0.0_

**ESP32 Experiments** is a lightweight bench tool for ESP32 boards on real Switch hardware. It talks to a board over **WebSerial** (USB CDC-ACM) and gives you three views:

 - **Plot** — a live serial plotter. Send comma/space-separated numbers (Arduino `Serial.println` style, or `name:value` pairs) and they graph in real time with auto-scaling and a legend.
- **Terminal** — a raw serial monitor with a text/hex toggle, selectable baud, and a send box with configurable line endings.
- **Discover** — enumerates every USB device on the port (VID:PID, class, interfaces, endpoints) and scans for BLE devices by service UUID, so you can confirm your board is actually enumerating.

 Built to stay responsive on-device: the plot only redraws when data arrives, logs are capped, and the chrome is deliberately cheap.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)
