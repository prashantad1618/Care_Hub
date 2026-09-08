const CACHE='ucc-carehub-consolidated-availability-roster-actions-20260907-v2';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith((async()=>{
    try{
      const r=await fetch(e.request);
      const c=await caches.open(CACHE);
      c.put(e.request,r.clone()).catch(()=>{});
      return r;
    }catch(err){
      return (await caches.match(e.request)) || Response.error();
    }
  })());
});
