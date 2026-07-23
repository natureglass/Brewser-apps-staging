// Requests a USB device but the manifest declares no "usb" permission. No
// network egress here, so this stays SUSPICIOUS (undeclared peripheral use)
// rather than escalating to DANGEROUS.
async function connect() {
  const device = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x1234 }] });
  await device.open();
  await device.selectConfiguration(1);
  return device;
}

connect();
