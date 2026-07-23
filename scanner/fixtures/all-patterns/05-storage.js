// Cross-namespace / storage abuse (§1.3).
// Rules: cross-namespace-storage, indexeddb-enumeration, cookie-access

// cross-namespace-storage: reads another app's reverse-DNS namespace + a
// brewser_* platform key (neither is this app's namespace, neither is brewser_auth)
var other = localStorage.getItem('com.someoneelse.wallet');
var platform = localStorage.getItem('brewser_settings');

// indexeddb-enumeration: lists every IndexedDB database on the origin
indexedDB.databases().then(function (dbs) { console.log(dbs); });

// cookie-access: read + write document.cookie
var c = document.cookie;
document.cookie = 'tracked=1';
