/* Brewser PWA — injected app service worker (runs on the app's OWN origin, e.g.
 * play.brewser.io/apps/<pkg>/). Placed at the app root so its default scope is the app.
 *
 * The plugin substitutes the CACHE name, the precache list and the start URL at publish.
 * Unlike the WordPress wrapper SW, the app bundle is STATIC and immutable per version, so
 * this is offline-first: precache the whole app on install, then serve cache-first. On the
 * Switch runtime there is no serviceWorker API, so this file is simply never registered.
 */
'use strict';

var CACHE    = 'brewser-app-com-jorgeportoh-pokemonshowdowndev-4ca2fb1fbf33';
var PRECACHE = [".\/","pwa\/app.webmanifest","pwa\/brewser-pwa.js","pwa\/icon-192.png","pwa\/icon-512.png","pwa\/icon-maskable.png","pwa\/apple-touch-icon.png","app.js","favicon.ico","index.html","items\/abomasite.png","items\/absolite.png","items\/absolitez.png","items\/aerodactylite.png","items\/aggronite.png","items\/airballoon.png","items\/alakazite.png","items\/altarianite.png","items\/ampharosite.png","items\/aspearberry.png","items\/audinite.png","items\/babiriberry.png","items\/banettite.png","items\/barbaracite.png","items\/baxcalibrite.png","items\/beedrillite.png","items\/bigroot.png","items\/bindingband.png","items\/blackbelt.png","items\/blackglasses.png","items\/blastoisinite.png","items\/blazikenite.png","items\/brightpowder.png","items\/cameruptite.png","items\/chandelurite.png","items\/charcoal.png","items\/charizarditex.png","items\/charizarditey.png","items\/chartiberry.png","items\/cheriberry.png","items\/chesnaughtite.png","items\/chestoberry.png","items\/chilanberry.png","items\/chimechite.png","items\/choicescarf.png","items\/chopleberry.png","items\/clefablite.png","items\/cobaberry.png","items\/colburberry.png","items\/crabominite.png","items\/damprock.png","items\/delphoxite.png","items\/dragalgite.png","items\/dragonfang.png","items\/dragoninite.png","items\/drampanite.png","items\/eelektrossite.png","items\/ejectbutton.png","items\/electricseed.png","items\/emboarite.png","items\/excadrite.png","items\/expertbelt.png","items\/fairyfeather.png","items\/falinksite.png","items\/feraligite.png","items\/floettite.png","items\/focusband.png","items\/focussash.png","items\/froslassite.png","items\/galladite.png","items\/garchompite.png","items\/garchompitez.png","items\/gardevoirite.png","items\/gengarite.png","items\/glalitite.png","items\/glimmoranite.png","items\/golisopite.png","items\/golurkite.png","items\/grassyseed.png","items\/greninjite.png","items\/gyaradosite.png","items\/habanberry.png","items\/hardstone.png","items\/hawluchanite.png","items\/heatrock.png","items\/heracronite.png","items\/houndoominite.png","items\/icyrock.png","items\/ironball.png","items\/kangaskhanite.png","items\/kasibberry.png","items\/kebiaberry.png","items\/kingsrock.png","items\/leek.png","items\/leftovers.png","items\/leppaberry.png","items\/lifeorb.png","items\/lightball.png","items\/lightclay.png","items\/lopunnite.png","items\/lucarionite.png","items\/lucarionitez.png","items\/lumberry.png","items\/magnet.png","items\/malamarite.png","items\/manectite.png","items\/mawilite.png","items\/medichamite.png","items\/meganiumite.png","items\/mentalherb.png","items\/meowsticite.png","items\/metagrossite.png","items\/metalcoat.png","items\/metronome.png","items\/miracleseed.png","items\/mistyseed.png","items\/muscleband.png","items\/mysticwater.png","items\/nevermeltice.png","items\/normalgem.png","items\/occaberry.png","items\/oranberry.png","items\/passhoberry.png","items\/payapaberry.png","items\/pechaberry.png","items\/persimberry.png","items\/pidgeotite.png","items\/pinsirite.png","items\/poisonbarb.png","items\/psychicseed.png","items\/pyroarite.png","items\/quickclaw.png","items\/raichunitex.png","items\/raichunitey.png","items\/rawstberry.png","items\/redcard.png","items\/rindoberry.png","items\/rockyhelmet.png","items\/roseliberry.png","items\/sablenite.png","items\/salamencite.png","items\/sceptilite.png","items\/scizorite.png","items\/scolipite.png","items\/scopelens.png","items\/scovillainite.png","items\/scraftinite.png","items\/sharpbeak.png","items\/sharpedonite.png","items\/shedshell.png","items\/shellbell.png","items\/shucaberry.png","items\/silkscarf.png","items\/silverpowder.png","items\/sitrusberry.png","items\/skarmorite.png","items\/slowbronite.png","items\/smoothrock.png","items\/softsand.png","items\/spelltag.png","items\/staraptite.png","items\/starminite.png","items\/steelixite.png","items\/swampertite.png","items\/tangaberry.png","items\/terrainextender.png","items\/twistedspoon.png","items\/tyranitarite.png","items\/venusaurite.png","items\/victreebelite.png","items\/wacanberry.png","items\/whiteherb.png","items\/widelens.png","items\/wiseglasses.png","items\/yacheberry.png","items\/zoomlens.png","styles.css"];   // JSON array of app-relative URLs
var START    = 'index.html';    // navigation fallback (the app entry)

self.addEventListener('install', function (event) {
	event.waitUntil((async function () {
		var cache = await caches.open(CACHE);
		// Resilient precache: a single missing file must not abort the whole install.
		await Promise.all(PRECACHE.map(function (u) {
			return cache.add(new Request(u, { cache: 'reload' })).catch(function () {});
		}));
		await self.skipWaiting();
	})());
});

self.addEventListener('activate', function (event) {
	event.waitUntil((async function () {
		try {
			var keys = await caches.keys();
			await Promise.all(keys.map(function (k) {
				// Drop this app's stale-version caches; leave everything else alone.
				return (k.indexOf('brewser-app-') === 0 && k !== CACHE) ? caches.delete(k) : Promise.resolve();
			}));
		} catch (e) {}
		await self.clients.claim();
	})());
});

self.addEventListener('fetch', function (event) {
	var req = event.request;
	if (req.method !== 'GET') { return; }

	var url;
	try { url = new URL(req.url); } catch (e) { return; }

	// Cross-origin (fonts, CDNs, APIs the app calls): pass through untouched.
	if (url.origin !== self.location.origin) { return; }

	// Navigations: network-first, fall back to the precached entry when offline.
	if (req.mode === 'navigate') {
		event.respondWith((async function () {
			try {
				return await fetch(req);
			} catch (e) {
				var cache = await caches.open(CACHE);
				return (await cache.match(req)) ||
					(await cache.match(START)) ||
					(await cache.match('./')) ||
					Response.error();
			}
		})());
		return;
	}

	// Same-origin sub-resources: cache-first (the bundle is immutable per version), with a
	// network fill for anything not precached.
	event.respondWith((async function () {
		var cache = await caches.open(CACHE);
		var hit = await cache.match(req);
		if (hit) { return hit; }
		try {
			var res = await fetch(req);
			if (res && res.ok && res.type === 'basic') {
				try { cache.put(req, res.clone()); } catch (e) {}
			}
			return res;
		} catch (e) {
			return (await cache.match(req)) || Response.error();
		}
	})());
});
