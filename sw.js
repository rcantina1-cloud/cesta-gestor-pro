
"use strict";

/*
 * CANTINAPRO OFFLINE
 * SERVICE WORKER
 *
 * Responsabilidades:
 * 1. Guardar os arquivos do aplicativo.
 * 2. Permitir abertura sem internet.
 * 3. Entregar arquivos pelo cache local.
 * 4. Atualizar o cache com segurança.
 * 5. Não apagar dados do IndexedDB.
 * 6. Não interferir em outros aplicativos.
 */

const CACHE_PREFIX = "cantinapro-offline-";
const CACHE_NAME = "cantinapro-offline-v6";

/*
 * Arquivos essenciais do aplicativo.
 */
const CORE_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./integracao.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./modulos/banco.js",
  "./modulos/Caixa.js",
  "./modulos/Cliente.js",
  "./modulos/Compras.js",
  "./modulos/Estoque.js",
  "./modulos/fornecedores.js",
  "./modulos/produtos.js",
  "./modulos/Vendas.js",
  "./db.js",
  "./app.js"
];

/*
 * Arquivos opcionais de configuração.
 */
const OPTIONAL_FILES = [
  "./manifest.webmanifest",
  "./manifest.json"
];

/*
 * INSTALAÇÃO
 * Guarda os arquivos necessários para trabalhar offline.
 */
self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      for (const file of CORE_FILES) {
        const response = await fetch(file, { cache: "reload" });

        if (!response.ok) {
          throw new Error(
            "Não foi possível guardar: " + file
          );
        }

        await cache.put(file, response);
      }

      /*
       * Arquivos opcionais não impedem a instalação.
       */
      for (const file of OPTIONAL_FILES) {
        try {
          const response = await fetch(file);

          if (response.ok) {
            await cache.put(file, response);
          }
        } catch (error) {
          console.warn(
            "[CantinaPro] Arquivo opcional não encontrado:",
            file
          );
        }
      }

      await self.skipWaiting();
    })()
  );
});

/*
 * ATIVAÇÃO
 * Remove somente versões antigas do cache CantinaPro.
 * Nunca apaga o IndexedDB.
 */
self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(key =>
            key.startsWith(CACHE_PREFIX) &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      );

      await self.clients.claim();

      console.info(
        "[CantinaPro Offline] Sistema pronto."
      );
    })()
  );
});

/*
 * CONSULTA DOS ARQUIVOS
 * Primeiro procura no armazenamento local.
 * Se não encontrar, tenta a internet.
 */
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
   * Não intercepta outros sites.
   */
  if (url.origin !== self.location.origin) {
    return;
  }

  /*
   * Não guarda requisições de dados ou APIs.
   * Os dados comerciais ficam no IndexedDB.
   */
  const isAppFile = [
    "document",
    "script",
    "style",
    "image",
    "font",
    "manifest"
  ].includes(request.destination);

  const isNavigation = request.mode === "navigate";

  if (!isAppFile && !isNavigation) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      /*
       * Procura primeiro no cache local.
       */
      const cached = await cache.match(request);

      if (cached) {
        return cached;
      }

      /*
       * Se não encontrou, tenta buscar na internet.
       */
      try {
        const response = await fetch(request);

        if (response.ok && response.type === "basic") {
          await cache.put(request, response.clone());
        }

        return response;

      } catch (error) {

        /*
         * Sem internet: páginas recebem a tela inicial.
         */
        if (isNavigation) {
          const offlinePage = await cache.match(
            "./index.html"
          );

          if (offlinePage) {
            return offlinePage;
          }
        }

        /*
         * Outros arquivos não encontrados:
         * informa que estão indisponíveis.
         */
        return new Response(
          "Arquivo indisponível offline.",
          {
            status: 503,
            statusText: "Offline"
          }
        );
      }
    })()
  );
});
