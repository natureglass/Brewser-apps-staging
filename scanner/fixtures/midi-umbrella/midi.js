// Declares ONLY the `usb` umbrella permission, then talks to a controller over
// Web MIDI. navigator.requestMIDIAccess is a direct navigator METHOD (unlike the
// navigator.serial / navigator.hid sub-object surfaces), so it needs its own
// detection hook. On Switch it rides the same usb:hs host transport, so the
// runtime grants `midi` off `usb`. There is no network egress, so the scanner
// must produce NO peripheral findings — not peripheral-undeclared, and (the
// regression this guards) NO declared-unused-peripheral for the declared `usb`.
function onMidiMessage(ev) {
  const [status, data1, data2] = ev.data;
  console.log('midi', status, data1, data2);
}

if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess({ sysex: false }).then((access) => {
    const inputs = [...access.inputs.values()];
    inputs.forEach((inp) => { inp.onmidimessage = onMidiMessage; });
  });
}
