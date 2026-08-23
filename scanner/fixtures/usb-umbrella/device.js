// Declares ONLY the `usb` umbrella permission, then talks to the board over
// WebSerial and WebHID — both ride the same usb:hs host transport on Switch, so
// the runtime grants them off `usb`. There is no network egress here, so the
// scanner must produce NO peripheral findings at all (not peripheral-undeclared,
// not declared-unused-peripheral). Guards the usb-umbrella lockstep with the
// runtime's BrowserPermissionPolicy.setManifestPermissions.
async function connectSerial() {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 921600 });
  navigator.serial.addEventListener('disconnect', () => { /* mirror teardown */ });
  return port;
}

async function connectHid() {
  const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x303a }] });
  return devices;
}

connectSerial();
connectHid();
