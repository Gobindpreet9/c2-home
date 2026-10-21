import {useEffect, useRef} from 'react';

/*
 * webOS launch deep link: the launcher passes {itemId} in applicationManager/launch params.
 * Kept in one module with a single hook call in App.js so upstream merges touch one line.
 */

let pendingItemId = null;
let initialPollStarted = false;
let lastPublishedItemId = null;
const listeners = new Set();

const readItemId = (value) => {
	if (!value) {
		return null;
	}
	let params = value;
	if (typeof params === 'string') {
		try {
			params = JSON.parse(params);
		} catch (err) {
			return null;
		}
	}
	if (params && typeof params === 'object' && params.params && typeof params.params === 'object') {
		params = params.params;
	}
	if (!params || typeof params !== 'object') {
		return null;
	}
	const itemId = params.itemId || params.itemID || params.contentId;
	return typeof itemId === 'string' && itemId.trim() ? itemId.trim() : null;
};

const readLaunchParams = () => readItemId(typeof window !== 'undefined' && window.PalmSystem && window.PalmSystem.launchParams);

const publish = (itemId) => {
	if (!itemId || itemId === lastPublishedItemId) {
		return;
	}
	lastPublishedItemId = itemId;
	pendingItemId = itemId;
	listeners.forEach((listener) => listener(itemId));
};

const readAfterEvent = () => {
	const itemId = readLaunchParams();
	if (itemId) {
		publish(itemId);
	} else {
		// An app-tile launch clears launch params; allow the same item next time.
		lastPublishedItemId = null;
	}
};

const handleLaunch = (event) => {
	const fromEvent = readItemId(event && event.detail);
	if (fromEvent) {
		publish(fromEvent);
		return;
	}
	// webOS can populate PalmSystem.launchParams just after the event fires.
	setTimeout(readAfterEvent, 350);
};

const pollInitialParams = (attempt = 0) => {
	const itemId = readLaunchParams();
	if (itemId) {
		publish(itemId);
		return;
	}
	if (attempt < 8) {
		setTimeout(() => pollInitialParams(attempt + 1), 250);
	} else {
		lastPublishedItemId = null;
	}
};

if (typeof window !== 'undefined' && window.PalmSystem) {
	document.addEventListener('webOSLaunch', handleLaunch, true);
	document.addEventListener('webOSRelaunch', (event) => {
		handleLaunch(event);
		// Moonfin sets handlesRelaunch but never activates itself; without this a
		// backgrounded app receives the event and stays invisible.
		try {
			if (typeof window.PalmSystem.activate === 'function') {
				window.PalmSystem.activate();
			}
		} catch (err) {
			// Activation is best effort.
		}
	}, true);
}

export const useDeepLink = ({enabled, api, onItem}) => {
	const onItemRef = useRef(onItem);
	useEffect(() => {
		onItemRef.current = onItem;
	}, [onItem]);
	useEffect(() => {
		if (!enabled || !api || typeof onItemRef.current !== 'function') {
			return undefined;
		}
		let cancelled = false;
		const openItem = (itemId, attempt = 0) => {
			Promise.resolve().then(() => api.getItem(itemId)).then((item) => {
				if (!cancelled && item) {
					onItemRef.current(item);
				}
			}).catch(() => {
				if (cancelled) {
					return;
				}
				if (attempt < 6) {
					setTimeout(() => openItem(itemId, attempt + 1), 500);
				} else {
					// Allow a later launch event to retry the same item.
					pendingItemId = itemId;
					lastPublishedItemId = null;
				}
			});
		};
		const listener = (itemId) => {
			pendingItemId = null;
			openItem(itemId);
		};
		listeners.add(listener);
		const firstItemId = pendingItemId;
		pendingItemId = null;
		if (firstItemId) {
			openItem(firstItemId);
		} else if (!initialPollStarted) {
			// Cold starts can expose PalmSystem.launchParams only after the app has
			// finished booting; poll briefly after authentication. Runs once.
			initialPollStarted = true;
			pollInitialParams();
		}
		return () => {
			cancelled = true;
			listeners.delete(listener);
		};
	}, [enabled, api]);
};
