# Hardware API Test

_v1.0.0_

**Hardware API Test** is a developer diagnostic for Brewser's hardware Web APIs. It calls each API's `requestDevice()` and shows the device chooser + the selected device's details, so you can verify the picker, the permission gate, and the underlying enumeration on real hardware.

 - **WebUSB** — lists every device on the USB-C port and reports the chosen device's vendor/product ids and configuration count.
- **Web Bluetooth** — scans for a service UUID you provide and lists matching BLE devices.

 Also feature-detects `navigator.serial`, `navigator.hid`, `requestMIDIAccess` and `NDEFReader` for the upcoming phases.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)
