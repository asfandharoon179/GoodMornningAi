const CACHE_NAME = "good-morning-ai-v1";
const APP_URL = new URL("./", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([APP_URL, new URL("manifest.json", APP_URL).href, new URL("icon.png", APP_URL).href]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(APP_URL, copy)));
        }
        return response;
      }).catch(async () => (await caches.match(APP_URL)) || Response.error())
    );
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Good Morning!", body: "Your daily greeting is ready." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: new URL("icon.png", APP_URL).href,
    badge: new URL("icon.png", APP_URL).href,
    image: data.image,
    data: { url: data.url || APP_URL },
    actions: [
      { action: "open", title: "Open greeting" },
      { action: "dismiss", title: "Dismiss" },
    ],
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  let target;
  try {
    target = new URL(event.notification.data?.url || APP_URL, APP_URL);
    if (target.origin !== self.location.origin) target = new URL(APP_URL);
  } catch {
    target = new URL(APP_URL);
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if (client.url !== target.href && "navigate" in client) await client.navigate(target.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
