/*aicore-client-errors*/(function(){var n=GetCurrentResourceName(),s={},c=0;var r=function(t){t=String(t).replace(/\^\d/g,"");var k=t.slice(0,300);if(s[k]||c>=20)return;s[k]=1;c++;try{TriggerServerEvent("ai-core:clientError",n,t.slice(0,4000))}catch(e){}};globalThis.__aicoreReportError=r;var l=console.log;console.log=function(){var a=arguments[0];if(typeof a==="string"&&a.indexOf("SCRIPT ERROR")!==-1)r(a);return l.apply(console,arguments)}})();
try{
(function() {

// ../../../packages/lib/src/fivem/callbackNames.ts
/**
	* Callback wire format, the same on both sides:
	*   request  `aicore:cb:<name>`              (callerResource, id, ...args)
	*   response `aicore:cbr:<callerResource>`   (id, ok, result)
	* The response goes only to the resource that asked, so two resources never see each other's replies.
	*/
	const requestEvent = (name) => `aicore:cb:${name}`;
	const responseEvent = (resource) => `aicore:cbr:${resource}`;
	/** Default time a caller waits for an answer before the promise rejects. */
	const DEFAULT_CALLBACK_TIMEOUT = 3e4;

// ../../../packages/lib/src/shared/wait.ts
/** Resolves after `ms` milliseconds. */
	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

// ../../../packages/lib/src/shared/read.ts
/** Small readers for panel content (`data/*.json`): every one returns the fallback when the value is missing or wrong. */
	/** A finite number clamped to `[min, max]`, else the fallback. */
	function num(value, fallback, min = -Infinity, max = Infinity) {
		return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
	}
	/** `num` rounded to an integer. */
	function int(value, fallback, min = -Infinity, max = Infinity) {
		return Math.round(num(value, fallback, min, max));
	}
	/** A boolean, else the fallback. */
	function bool(value, fallback) {
		return typeof value === "boolean" ? value : fallback;
	}
	/** A trimmed non-empty string cut to `max`, else the fallback. */
	function str(value, fallback, max = 64) {
		return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
	}
	/** The value as a plain object, or an empty one. */
	function record(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
	}
	/** A position with heading; each missing field comes from the fallback. */
	function vec4(value, fallback) {
		const v = record(value);
		return {
			x: num(v.x, fallback.x),
			y: num(v.y, fallback.y),
			z: num(v.z, fallback.z),
			heading: num(v.heading, fallback.heading)
		};
	}

// ../../../packages/lib/src/shared/index.ts
	function isRecord(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}
	/** Fills `{0}`, `{1}`... with the arguments by position (a translation may reorder or repeat them). */
	function formatText(template, args) {
		return template.replace(/\{(\d+)\}/g, (match, index) => {
			const value = args[Number(index)];
			return value === void 0 ? match : String(value);
		});
	}
	/** Console output prefixed with the resource name, so server logs show where a line came from. */
	function createLogger(resource) {
		const prefix = `[${resource}]`;
		return {
			info: (message, ...details) => console.log(`${prefix} ${message}`, ...details),
			warn: (message, ...details) => console.warn(`${prefix} ^3${message}^7`, ...details),
			error: (message, ...details) => console.error(`${prefix} ^1${message}^7`, ...details)
		};
	}

// ../../../packages/lib/src/client/netEvent.ts
	const log$2 = createLogger(GetCurrentResourceName());
	/**
	* Whether the net event being handled came from the server (read it before the first `await`). On a client only
	* events from the server carry a source (65535 in the docs); a local emit by any resource carries none.
	*/
	const fromServer = () => Boolean(globalThis.source);
	function onServerEvent(name, first, second) {
		const [handler, parse] = typeof first === "function" ? [first, null] : [second, first.args];
		onNet(name, (...raw) => {
			if (!fromServer() || !handler) return;
			const args = parse ? parse(raw) : [];
			if (!args) return log$2.warn(`event ${name} from the server had invalid arguments`);
			Promise.resolve().then(() => handler(...args)).catch((error) => log$2.error(`event ${name} failed`, error));
		});
	}

// ../../../packages/lib/src/client/callback.ts
	const resource$1 = GetCurrentResourceName();
	const log$1 = createLogger(resource$1);
	const pending = /* @__PURE__ */ new Map();
	let nextId = 0;
	onNet(responseEvent(resource$1), (id, ok, result) => {
		if (!fromServer()) return;
		const entry = typeof id === "number" ? pending.get(id) : void 0;
		if (!entry) return;
		pending.delete(id);
		clearTimeout(entry.timer);
		if (ok === true) entry.resolve(result);
		else entry.reject(/* @__PURE__ */ new Error("server callback failed"));
	});
	/**
	* Asks the server (`onClientCallback(name, ...)` there) and resolves with its answer. The answer is unknown:
	* parse it. Rejects when the server reports an error or does not answer within `timeoutMs`.
	*/
	function triggerServerCallback(name, args = [], timeoutMs = DEFAULT_CALLBACK_TIMEOUT) {
		const id = ++nextId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(/* @__PURE__ */ new Error(`server callback ${name} timed out`));
			}, timeoutMs);
			pending.set(id, {
				resolve,
				reject,
				timer
			});
			emitNet(requestEvent(name), resource$1, id, ...args);
		});
	}

// ../../../packages/shared/src/core.ts
/** Names owned by ai-core that other resources, the bridges and the build step use. */
	const CORE = {
		resource: "ai-core",
		/** Client -> server: (resource: string, text: string). Sent by the reporter every client bundle carries. */
		clientErrorEvent: "ai-core:clientError",
		/** (src, character: CharacterInfo) after a character is loaded and spawned. */
		playerLoadedEvent: "ai-core:playerLoaded",
		/** (src, charId, reason: UnloadReason) before a character's state is dropped. */
		playerUnloadedEvent: "ai-core:playerUnloaded",
		/** (src, account: string, balance: number, delta: number, reason: string) */
		moneyChangedEvent: "ai-core:moneyChanged",
		/** (src, jobs: JobMembership[]) */
		jobsChangedEvent: "ai-core:jobsChanged",
		/** (src, job: string | null) */
		dutyChangedEvent: "ai-core:dutyChanged",
		/** (src, gangs: GangMembership[]) */
		gangsChangedEvent: "ai-core:gangsChanged",
		/** (src, gang: string | null) */
		activeGangChangedEvent: "ai-core:activeGangChanged",
		/** (src, charIds: number[]) each time a player's character screen loads; an appearance resource answers with portraits. */
		characterScreenEvent: "ai-core:characterScreen",
		/** (resource: string | null) the inventory behind ai-core's inventory layer changed (the bridge drops its item cache). */
		inventoryChangedEvent: "ai-core:inventoryChanged",
		/** (src, name: string, status: Record<string, number> | null) a player used an item; status = the needs it gives, from inventories that define them. */
		itemUsedEvent: "ai-core:itemUsed",
		clientPlayerLoadedEvent: "ai-core:client:playerLoaded",
		clientPlayerUnloadedEvent: "ai-core:client:playerUnloaded",
		/** (charId: number, url: string) a portrait image of a character on the character screen (e.g. `https://nui-img/<txd>/<txd>`). */
		clientCharacterPortraitEvent: "ai-core:client:characterPortrait",
		/** (charId: number) ai-appearance holds this character's look: ai-core dresses its scene ped with `ApplyCharacterAppearance`. */
		clientCharacterLookEvent: "ai-core:client:characterLook",
		/** (resource: string, id: string) the interaction key was pressed while that resource's prompt was on top. */
		clientPromptPressedEvent: "ai-core:client:promptPressed",
		/** (key: keyof PlayerCache, value) a cached value of the local player changed (one watcher in ai-core for every resource). */
		clientCacheEvent: "ai-core:client:cache",
		charactersCallback: "ai-core:characters",
		createCharacterCallback: "ai-core:createCharacter",
		deleteCharacterCallback: "ai-core:deleteCharacter",
		selectCharacterCallback: "ai-core:selectCharacter",
		/** Server -> client: (notification: Notification) a notification card on the player's screen. */
		clientNotifyEvent: "ai-core:client:notify",
		/** Server -> client: (spawn: SpawnPoint) puts the loaded character into the world. */
		spawnEvent: "ai-core:client:spawn",
		/** Server -> client: () the character was let go (switch); show the character screen again. */
		openCharactersEvent: "ai-core:client:openCharacters"
	};

// ../../../packages/shared/src/admin.ts
/** Event names of the admin panel (owned by ai-core). */
	const ADMIN = {
		/** ACE every panel action checks: `add_ace group.admin ai.admin allow`. */
		ace: "ai.admin",
		/** Callback: (keybinds: KeybindInfo[] the admin's client knows) -> AdminPanelSnapshot[]. */
		openCallback: "ai-core:admin:open",
		applyCallback: "ai-core:admin:apply",
		closeEvent: "ai-core:admin:close",
		/** Server -> client: () open the panel (the `aiadmin` command, checked on the server). */
		showEvent: "ai-core:admin:show",
		/** Server -> admins with the panel open: (delta: AdminDelta). */
		deltaEvent: "ai-core:admin:delta",
		/** Server -> client of a world (`sync: "all"`) file: (file, key | null, value). Prefixed with the resource name. */
		worldEvent: (resource) => `${resource}:admin:world`,
		/** Callback: () -> { [file]: { key: value } } world records changed since the resource started. */
		worldChangesCallback: (resource) => `${resource}:admin:worldChanges`
	};

// ../../../packages/shared/src/menu.ts
	const MENU_EVENTS = {
		/** Client local: (resource, requestId, itemId | null) the player picked an item or closed the menu. */
		menuResult: "ai-core:client:menuResult",
		/** Client local: (resource, requestId, itemId) the pointer or focus is on an item (previews). */
		menuHover: "ai-core:client:menuHover",
		/** Client local: (resource, requestId, values | null) the player confirmed or closed the input dialog. */
		inputResult: "ai-core:client:inputResult"
	};

// ../../../packages/lib/src/client/adminWorld.ts
/**
	* The client copy of a resource's world panel files (`sync: "all"`): the file FiveM cached at start, then the
	* records changed since start (asked once), then live changes. Never polls.
	*/
	var AdminWorld = class {
		data = /* @__PURE__ */ new Map();
		handlers = /* @__PURE__ */ new Map();
		resource = GetCurrentResourceName();
		/** Resolves once the changes since start are applied (or could not be loaded): the data is current from then on. */
		ready;
		/** `files`: the world files this client mirrors (each must be in the resource's `files`). */
		constructor(files) {
			const log = createLogger(this.resource);
			for (const file of files) {
				const raw = LoadResourceFile(this.resource, `data/${file}.json`);
				try {
					const parsed = raw ? JSON.parse(raw) : {};
					this.data.set(file, isRecord(parsed) ? parsed : {});
				} catch (error) {
					log.error(`data/${file}.json is not valid JSON`, error);
					this.data.set(file, {});
				}
			}
			onServerEvent(ADMIN.worldEvent(this.resource), { args: ([file, key, value]) => typeof file === "string" ? [
				file,
				typeof key === "string" && key !== "" ? key : void 0,
				value
			] : null }, (file, key, value) => this.put(file, key, value));
			this.ready = triggerServerCallback(ADMIN.worldChangesCallback(this.resource)).then((changes) => {
				if (!isRecord(changes)) return;
				for (const [file, records] of Object.entries(changes)) {
					if (!isRecord(records)) continue;
					for (const [key, value] of Object.entries(records)) this.put(file, key === "" ? void 0 : key, value);
				}
			}, (error) => log.error("loading the panel changes since start failed", error));
		}
		/** The current content of a file: the settings object, or `{ key: record }`. Read only; parse what you use. */
		get(file) {
			return this.data.get(file) ?? {};
		}
		onChange(file, handler) {
			this.handlers.set(file, [...this.handlers.get(file) ?? [], handler]);
		}
		put(file, key, value) {
			const data = this.data.get(file);
			if (!data) return;
			if (key === void 0) {
				if (isRecord(value)) this.data.set(file, value);
			} else if (value === null) delete data[key];
			else data[key] = value;
			for (const handler of this.handlers.get(file) ?? []) handler(key, value);
		}
	};

// ../../../packages/lib/src/client/cache.ts
/** The unarmed "weapon" hash: cached as `false`. */
	const UNARMED = GetHashKey("WEAPON_UNARMED") | 0;
	/** The vehicle, seat and weapon of a ped right now (also ai-core's watcher). */
	function readPlayerState(ped) {
		const vehicle = GetVehiclePedIsIn(ped, false);
		let seat = false;
		if (vehicle) for (let i = -1; i < GetVehicleMaxNumberOfPassengers(vehicle); i++) {
			if (GetPedInVehicleSeat(vehicle, i) !== ped) continue;
			seat = i;
			break;
		}
		const weapon = GetSelectedPedWeapon(ped) | 0;
		return {
			vehicle: vehicle || false,
			seat,
			weapon: weapon === UNARMED ? false : weapon
		};
	}
	/**
	* The local player's often read values (ped, player id, server id, vehicle, seat, weapon), like ox_lib's `cache`:
	* read `cache.ped` instead of calling PlayerPedId() in loops. One watcher in ai-core updates every resource through
	* a local event, so no resource polls for these itself. Read only.
	*/
	const ped = PlayerPedId();
	const cache = {
		ped,
		playerId: PlayerId(),
		serverId: GetPlayerServerId(PlayerId()),
		...readPlayerState(ped)
	};
	const handlers = /* @__PURE__ */ new Map();
	const valid = (key, value) => key === "ped" || key === "playerId" || key === "serverId" ? typeof value === "number" : typeof value === "number" || value === false;
	on(CORE.clientCacheEvent, (key, value) => {
		if (typeof key !== "string" || !(key in cache)) return;
		const name = key;
		if (!valid(name, value) || cache[name] === value) return;
		const old = cache[name];
		cache[name] = value;
		for (const handler of handlers.get(name) ?? []) handler(value, old);
	});

// ../../../packages/lib/src/client/zones.ts
/**
	* Zones on this client: inside / outside checks at each zone's own interval, never per frame. Built for any count
	* (measured with 1,000,000 zones): zones sit in a grid of 64 m cells and a check looks only at the player's cell and
	* the zones the player is in.
	*/
	const log = createLogger(GetCurrentResourceName());
	const CELL = 64;
	/** A zone wider than this many cells is kept in one list checked every time instead of in the grid. */
	const MAX_CELLS = 64;
	const cellKey = (cx, cy) => cx + 32768 << 16 | cy + 32768;
	function contains(shape, x, y, z) {
		switch (shape.type) {
			case "sphere": {
				const dx = x - shape.center.x;
				const dy = y - shape.center.y;
				const dz = z - shape.center.z;
				return dx * dx + dy * dy + dz * dz <= shape.radius * shape.radius;
			}
			case "cylinder": {
				const dx = x - shape.center.x;
				const dy = y - shape.center.y;
				return dx * dx + dy * dy <= shape.radius * shape.radius && Math.abs(z - shape.center.z) <= shape.height;
			}
			case "poly": {
				if (z < shape.minZ || z > shape.maxZ) return false;
				let inside = false;
				const p = shape.points;
				for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
					const a = p[i];
					const b = p[j];
					if (a.y > y !== b.y > y && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
				}
				return inside;
			}
			default: return shape;
		}
	}
	/** Ground bounding box of a shape: [minX, minY, maxX, maxY]. */
	function bounds(shape) {
		if (shape.type !== "poly") return [
			shape.center.x - shape.radius,
			shape.center.y - shape.radius,
			shape.center.x + shape.radius,
			shape.center.y + shape.radius
		];
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const p of shape.points) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
		return [
			minX,
			minY,
			maxX,
			maxY
		];
	}
	var Zone = class {
		options;
		inside = false;
		nextCheck = 0;
		interval;
		/** Grid cells the zone is filed under; empty when it is in the large list. */
		cells = [];
		constructor(options) {
			this.options = options;
			this.interval = Math.max(50, options.interval ?? 500);
		}
	};
	/**
	* The zones of one resource. One timer serves them all at the shortest interval any zone asks for; each zone is
	* checked only when its own interval has passed. With no zones the timer stops (an active JS timer costs every frame).
	*/
	var Zones = class {
		zones = /* @__PURE__ */ new Map();
		grid = /* @__PURE__ */ new Map();
		large = /* @__PURE__ */ new Set();
		insideNow = /* @__PURE__ */ new Set();
		/** How many zones use each interval, so the shortest one is found without walking every zone. */
		intervals = /* @__PURE__ */ new Map();
		timer = null;
		period = 0;
		/** Adds (or replaces) a zone. A replaced zone the player was in fires its onExit first. */
		add(id, options) {
			this.remove(id);
			const zone = new Zone(options);
			this.zones.set(id, zone);
			const [minX, minY, maxX, maxY] = bounds(options.shape);
			const x0 = Math.floor(minX / CELL);
			const y0 = Math.floor(minY / CELL);
			const x1 = Math.floor(maxX / CELL);
			const y1 = Math.floor(maxY / CELL);
			if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) this.large.add(zone);
			else for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
				const key = cellKey(cx, cy);
				let cell = this.grid.get(key);
				if (!cell) this.grid.set(key, cell = /* @__PURE__ */ new Set());
				cell.add(zone);
				zone.cells.push(key);
			}
			this.intervals.set(zone.interval, (this.intervals.get(zone.interval) ?? 0) + 1);
			this.schedule();
		}
		remove(id) {
			const zone = this.zones.get(id);
			if (!zone) return;
			this.zones.delete(id);
			this.large.delete(zone);
			for (const key of zone.cells) {
				const cell = this.grid.get(key);
				cell?.delete(zone);
				if (cell?.size === 0) this.grid.delete(key);
			}
			const left = (this.intervals.get(zone.interval) ?? 1) - 1;
			if (left > 0) this.intervals.set(zone.interval, left);
			else this.intervals.delete(zone.interval);
			if (this.insideNow.delete(zone)) this.fire(zone, false);
			this.schedule();
		}
		/** Removes every zone (exits fire for the ones the player is in). */
		clear() {
			const inside = [...this.insideNow];
			this.zones.clear();
			this.grid.clear();
			this.large.clear();
			this.insideNow.clear();
			this.intervals.clear();
			for (const zone of inside) this.fire(zone, false);
			this.schedule();
		}
		isInside(id) {
			return this.zones.get(id)?.inside ?? false;
		}
		get size() {
			return this.zones.size;
		}
		schedule() {
			let period = 0;
			for (const interval of this.intervals.keys()) period = period === 0 ? interval : Math.min(period, interval);
			if (period === this.period) return;
			if (this.timer) clearInterval(this.timer);
			this.timer = period ? setInterval(() => this.check(), period) : null;
			this.period = period;
		}
		check() {
			const now = GetGameTimer();
			const [x = 0, y = 0, z = 0] = GetEntityCoords(cache.ped, false);
			for (const zone of this.insideNow) this.test(zone, now, x, y, z);
			for (const zone of this.large) this.test(zone, now, x, y, z);
			const cell = this.grid.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL)));
			if (cell) for (const zone of cell) this.test(zone, now, x, y, z);
		}
		test(zone, now, x, y, z) {
			if (now < zone.nextCheck) return;
			zone.nextCheck = now + zone.interval;
			const inside = contains(zone.options.shape, x, y, z);
			if (inside === zone.inside) return;
			if (inside) this.insideNow.add(zone);
			else this.insideNow.delete(zone);
			this.fire(zone, inside);
		}
		fire(zone, inside) {
			zone.inside = inside;
			try {
				if (inside) zone.options.onEnter?.();
				else zone.options.onExit?.();
			} catch (error) {
				log.error("zone handler failed", error);
			}
		}
	};

// ../../../packages/lib/src/fivem/exports.ts
/** Typed access to another resource's exports (types come from CitizenExports in @aicore-fivem/shared). */
	function resourceExport(resource) {
		return globalThis.exports[resource];
	}

// ../../../packages/lib/src/client/prompt.ts
/**
	* ai-core's prompt (the "press E" box on the right): this resource shows and hides its own prompts by id; the
	* interaction key is one rebindable keybind in ai-core, so nothing polls keys per frame. Show a prompt on a zone's
	* enter, hide it on exit, act in `onPromptPressed`.
	*/
	function showPrompt(id, text) {
		resourceExport(CORE.resource).ShowPrompt(id, text);
	}
	function hidePrompt(id) {
		resourceExport(CORE.resource).HidePrompt(id);
	}
	/** The player pressed the interaction key while this resource's prompt `id` was the one on top. */
	function onPromptPressed(handler) {
		const resource = GetCurrentResourceName();
		on(CORE.clientPromptPressedEvent, (owner, id) => {
			if (owner === resource && typeof id === "string") handler(id);
		});
	}

// ../../../packages/lib/src/client/notify.ts
/** Shows a notification card on this player's screen (ai-core draws it); `text` is already translated. */
	function notify(text, kind = "info", duration) {
		resourceExport(CORE.resource).Notify({
			text,
			kind,
			duration
		});
	}

// ../../../packages/lib/src/client/menu.ts
/** Menus and input dialogs this resource asked ai-core for, waiting for the player's answer. */
	var Requests = class {
		resource = GetCurrentResourceName();
		waiting = /* @__PURE__ */ new Map();
		hovers = /* @__PURE__ */ new Map();
		nextId = 0;
		constructor() {
			const answer = (owner, id, value) => {
				if (owner !== this.resource || typeof id !== "number") return;
				this.waiting.get(id)?.(value);
				this.waiting.delete(id);
				this.hovers.delete(id);
			};
			on(MENU_EVENTS.menuHover, (owner, id, item) => {
				if (owner === this.resource && typeof id === "number" && typeof item === "string") this.hovers.get(id)?.(item);
			});
			on(MENU_EVENTS.menuResult, answer);
			on(MENU_EVENTS.inputResult, answer);
		}
		ask(open, read, onHover) {
			const id = ++this.nextId;
			this.waiting.set(id, read);
			if (onHover) this.hovers.set(id, onHover);
			open(id);
		}
	};
	const requests = new Requests();
	/**
	* Shows ai-core's menu and resolves with the picked item id, or null when the player closed it; `onHover` hears the
	* item under the pointer or focus (live previews).
	*/
	function menu(request, onHover) {
		return new Promise((resolve) => requests.ask((id) => resourceExport(CORE.resource).OpenMenu(id, request), (value) => resolve(typeof value === "string" ? value : null), onHover));
	}

// ../../../packages/lib/src/client/vehicleProps.ts
	const MOD_TYPES = Array.from({ length: 50 }, (_, i) => i);

// ../../../packages/lib/src/client/keybind.ts
	const resource = GetCurrentResourceName();

// ../../../packages/lib/src/fivem/locale.ts
/** Convar holding the language (`setr ai:locale "en"` in misc.cfg); replicated so clients read it too. */
	const LOCALE_CONVAR = "ai:locale";
	function readLocaleFile(resource, lang) {
		const raw = LoadResourceFile(resource, `locales/${lang}.json`);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (!isRecord(parsed)) return {};
		const texts = {};
		for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") texts[key] = value;
		return texts;
	}
	/**
	* The resource's lang texts: `locales/en.json` (complete base) overlaid with `locales/<ai:locale>.json`.
	* `${OTHER_KEY}` inside a text is replaced by that text once at load. Returns `t(key, ...args)` filling
	* `{0}`, `{1}`...; a missing key returns the key itself so it is visible in game.
	*
	*   const t = createLocale<typeof import("../../locales/en.json")>();
	*   t("NOTIFY_NO_MONEY", price);
	*/
	function createLocale() {
		const texts = loadLocaleTexts();
		return (key, ...args) => formatText(texts[key] ?? key, args);
	}
	/**
	* The resource's merged lang table (`en.json` overlaid with the `ai:locale` language, `${KEY}` references
	* resolved). A NUI gets this once and fills `{0}` placeholders itself.
	*/
	function loadLocaleTexts(resource = GetCurrentResourceName()) {
		const lang = GetConvar(LOCALE_CONVAR, "en");
		const texts = {
			...readLocaleFile(resource, "en"),
			...lang === "en" ? {} : readLocaleFile(resource, lang)
		};
		for (const key of Object.keys(texts)) texts[key] = (texts[key] ?? "").replace(/\$\{([A-Z0-9_]+)\}/g, (match, ref) => texts[ref] ?? match);
		return texts;
	}

// resource/common/locale.ts
/** This resource's lang texts: `Locale("NOTIFY_NO_MONEY", price)`; keys typed from locales/en.json. */
	const Locale = createLocale();

// resource/common/resource.ts
	const ResourceName = GetCurrentResourceName();
	const ResourceContext = IsDuplicityVersion() ? "server" : "client";

// resource/common/property.ts
/** ai-properties' contracts and panel content. No natives. */
	const EVENTS = {
		/** Callback: () -> { ok, list: Array<{ id, access }> } the properties the player owns or holds a key to (the session snapshot). */
		mine: "ai-properties:mine",
		/** Server -> player: (id, access: "owner" | "key" | false) the player's access to a property changed. */
		access: "ai-properties:client:access",
		/** Callback: (id) -> { ok } buys the property at its door. */
		buy: "ai-properties:buy",
		/** Callback: (id) -> { ok } enters the property's interior. */
		enter: "ai-properties:enter",
		/** Callback: () -> { ok } leaves the interior through the door. */
		exit: "ai-properties:exit",
		/** Callback: () -> { ok } opens the stash of the property the player is in. */
		stash: "ai-properties:stash",
		/** Callback: () -> { ok, keys: Array<{ charId, name }> } the key holders of the property the player owns and is in. */
		keys: "ai-properties:keys",
		/** Callback: () -> { ok } gives a key to the closest player inside. */
		giveKey: "ai-properties:giveKey",
		/** Callback: (charId) -> { ok } takes a key back. */
		takeKey: "ai-properties:takeKey",
		/** Callback: () -> { ok } sells the property the player owns and is in. */
		sell: "ai-properties:sell",
		/** Server -> player: (id | null) the player is inside this property now (or left). */
		inside: "ai-properties:client:inside"
	};
	/** GlobalState key of a property that has an owner (true). */
	const ownedKey = (id) => `prop:${id}`;
	const ZERO = {
		x: 0,
		y: 0,
		z: 0,
		heading: 0
	};
	function readInteriors(raw) {
		const out = /* @__PURE__ */ new Map();
		for (const [id, value] of Object.entries(record(raw))) {
			const v = record(value);
			out.set(id, {
				id,
				label: str(v.label, id, 48),
				entry: vec4(v.entry, ZERO)
			});
		}
		return out;
	}
	function readProperties(raw) {
		const out = /* @__PURE__ */ new Map();
		for (const [id, value] of Object.entries(record(raw))) {
			const v = record(value);
			out.set(id, {
				id,
				label: str(v.label, id, 48),
				door: vec4(v.door, ZERO),
				interior: str(v.interior, "low", 48),
				price: int(v.price, 0, 0),
				blip: bool(v.blip, false)
			});
		}
		return out;
	}

// resource/client/index.ts
	const world = new AdminWorld(["properties", "interiors"]);
	const texts = loadLocaleTexts();
	const content = {
		properties: readProperties(world.get("properties")),
		interiors: readInteriors(world.get("interiors"))
	};
	const BLIP_TEXT = "AIPROP_BLIP";
	AddTextEntry(BLIP_TEXT, "~a~");
	const errorText = (v, fallback) => {
		const key = typeof record(v).error === "string" ? String(record(v).error) : fallback;
		return texts[key] ?? key;
	};
	const call = async (name, args = []) => {
		const result = record(await triggerServerCallback(name, args).catch(() => null));
		if (result.ok !== true) notify(errorText(result, "PROP_ERR_FAR"), "error");
		return result;
	};
	/**
	* Doors with prompts (buy, enter, locked), blips of the player's properties and properties for sale, and the
	* property menu at the interior entry while inside. Access comes as one snapshot, then deltas.
	*/
	var Homes = class {
		access = /* @__PURE__ */ new Map();
		doors = new Zones();
		inner = new Zones();
		blips = [];
		insideId = null;
		async load() {
			const result = record(await triggerServerCallback(EVENTS.mine, []).catch(() => null));
			this.access.clear();
			for (const row of Array.isArray(result.list) ? result.list.map(record) : []) if (typeof row.id === "string" && (row.access === "owner" || row.access === "key")) this.access.set(row.id, row.access);
			this.rebuild();
		}
		setAccess(id, access) {
			if (access) this.access.set(id, access);
			else this.access.delete(id);
			this.rebuild();
		}
		label(p) {
			if (GlobalState[ownedKey(p.id)] !== true) return Locale("PROP_PROMPT_BUY", p.label, p.price);
			return this.access.has(p.id) ? Locale("PROP_PROMPT_ENTER", p.label) : Locale("PROP_PROMPT_LOCKED", p.label);
		}
		rebuild() {
			this.doors.clear();
			for (const blip of this.blips) RemoveBlip(blip);
			this.blips = [];
			for (const p of content.properties.values()) {
				const id = `prop:${p.id}`;
				this.doors.add(id, {
					shape: {
						type: "sphere",
						center: p.door,
						radius: 1.5
					},
					interval: 500,
					onEnter: () => showPrompt(id, this.label(p)),
					onExit: () => hidePrompt(id)
				});
				const mine = this.access.has(p.id);
				if (!mine && !(p.blip && GlobalState[ownedKey(p.id)] !== true)) continue;
				const blip = AddBlipForCoord(p.door.x, p.door.y, p.door.z);
				SetBlipSprite(blip, mine ? 40 : 350);
				SetBlipColour(blip, mine ? 2 : 0);
				SetBlipScale(blip, .7);
				SetBlipAsShortRange(blip, true);
				BeginTextCommandSetBlipName(BLIP_TEXT);
				AddTextComponentSubstringPlayerName(p.label);
				EndTextCommandSetBlipName(blip);
				this.blips.push(blip);
			}
		}
		setInside(id) {
			this.insideId = id;
			this.inner.clear();
			hidePrompt("prop:inside");
			const property = id ? content.properties.get(id) : void 0;
			const interior = property ? content.interiors.get(property.interior) : void 0;
			if (!interior) return;
			this.inner.add("prop:inside", {
				shape: {
					type: "sphere",
					center: interior.entry,
					radius: 1.5
				},
				interval: 400,
				onEnter: () => showPrompt("prop:inside", Locale("PROP_PROMPT_MENU")),
				onExit: () => hidePrompt("prop:inside")
			});
		}
		async door(p) {
			if (GlobalState[ownedKey(p.id)] !== true) {
				if (await menu({
					title: p.label,
					items: [{
						id: "buy",
						label: Locale("PROP_BUY", p.price),
						icon: "money-bill-wave"
					}]
				}) === "buy") await call(EVENTS.buy, [p.id]);
				return;
			}
			await fade(() => call(EVENTS.enter, [p.id]));
		}
		async insideMenu() {
			const items = [
				{
					id: "exit",
					label: Locale("PROP_EXIT"),
					icon: "location-dot"
				},
				{
					id: "stash",
					label: Locale("PROP_STASH"),
					icon: "box-open"
				},
				{
					id: "keys",
					label: Locale("PROP_KEYS"),
					icon: "key"
				},
				{
					id: "sell",
					label: Locale("PROP_SELL"),
					icon: "money-bill-wave"
				}
			];
			const pick = await menu({
				title: Locale("PROP_MENU"),
				items
			});
			if (pick === "exit") await fade(() => call(EVENTS.exit));
			else if (pick === "stash") await call(EVENTS.stash);
			else if (pick === "keys") await this.keys();
			else if (pick === "sell") {
				if (await menu({
					title: Locale("PROP_SELL"),
					items: [{
						id: "yes",
						label: Locale("PROP_SELL_CONFIRM"),
						icon: "money-bill-wave"
					}]
				}) === "yes") await call(EVENTS.sell);
			}
		}
		async keys() {
			const result = await call(EVENTS.keys);
			if (result.ok !== true) return;
			const holders = (Array.isArray(result.keys) ? result.keys.map(record) : []).filter((k) => typeof k.charId === "number");
			const pick = await menu({
				title: Locale("PROP_KEYS"),
				items: [{
					id: "give",
					label: Locale("PROP_GIVE_KEY"),
					icon: "key"
				}, ...holders.map((k) => ({
					id: String(k.charId),
					label: String(k.name ?? ""),
					description: Locale("PROP_TAKE_KEY")
				}))]
			});
			if (pick === "give") await call(EVENTS.giveKey);
			else if (pick !== null) await call(EVENTS.takeKey, [Number(pick)]);
		}
	};
	/** Runs a move behind a short screen fade. */
	async function fade(move) {
		DoScreenFadeOut(300);
		await sleep(350);
		await move();
		await sleep(400);
		DoScreenFadeIn(300);
	}
	const homes = new Homes();
	homes.load();
	on(CORE.clientPlayerLoadedEvent, () => void homes.load());
	world.onChange("properties", () => {
		content.properties = readProperties(world.get("properties"));
		homes.rebuild();
	});
	world.onChange("interiors", () => content.interiors = readInteriors(world.get("interiors")));
	AddStateBagChangeHandler("", "global", (_bag, key) => key.startsWith("prop:") && homes.rebuild());
	onServerEvent(EVENTS.access, { args: ([id, access]) => typeof id === "string" && (access === "owner" || access === "key" || access === false) ? [id, access] : null }, (id, access) => homes.setAccess(id, access));
	onServerEvent(EVENTS.inside, { args: ([id]) => id == null ? [null] : typeof id === "string" ? [id] : null }, (id) => homes.setInside(id));
	onPromptPressed((id) => {
		if (id === "prop:inside") return void homes.insideMenu();
		const property = id.startsWith("prop:") ? content.properties.get(id.slice(5)) : void 0;
		if (property) homes.door(property);
	});

})();
}catch(e){globalThis.__aicoreReportError&&globalThis.__aicoreReportError("load: "+(e&&e.stack||e));throw e}
