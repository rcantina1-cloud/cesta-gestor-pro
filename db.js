
/*
 * CANTINAPRO OFFLINE
 * Banco local IndexedDB
 *
 * Responsabilidade:
 * Receber, guardar, consultar, atualizar e excluir dados.
 * Armazenamento exclusivo neste aparelho.
 * Não apaga o banco existente.
 */

"use strict";

const DB_NAME = "cantinapro_offline";
const DB_VERSION = 1;

/**
 * Estrutura das tabelas locais.
 */
const STORES = {
  settings: { keyPath: "id" },

  categories: {
    keyPath: "id",
    indexes: [["name", "name", { unique: false }]]
  },

  products: {
    keyPath: "id",
    indexes: [
      ["barcode", "barcode", { unique: false }],
      ["categoryId", "categoryId", { unique: false }],
      ["name", "name", { unique: false }]
    ]
  },

  customers: {
    keyPath: "id",
    indexes: [
      ["name", "name", { unique: false }],
      ["phone", "phone", { unique: false }]
    ]
  },

  suppliers: {
    keyPath: "id",
    indexes: [["name", "name", { unique: false }]]
  },

  purchases: {
    keyPath: "id",
    indexes: [
      ["date", "date", { unique: false }],
      ["supplierId", "supplierId", { unique: false }]
    ]
  },

  purchaseItems: {
    keyPath: "id",
    indexes: [
      ["purchaseId", "purchaseId", { unique: false }],
      ["productId", "productId", { unique: false }]
    ]
  },

  sales: {
    keyPath: "id",
    indexes: [
      ["date", "date", { unique: false }],
      ["status", "status", { unique: false }]
    ]
  },

  saleItems: {
    keyPath: "id",
    indexes: [
      ["saleId", "saleId", { unique: false }],
      ["productId", "productId", { unique: false }]
    ]
  },

  cashSessions: {
    keyPath: "id",
    indexes: [
      ["openedAt", "openedAt", { unique: false }],
      ["status", "status", { unique: false }]
    ]
  },

  cashMovements: {
    keyPath: "id",
    indexes: [
      ["cashSessionId", "cashSessionId", { unique: false }],
      ["date", "date", { unique: false }]
    ]
  },

  expenses: {
    keyPath: "id",
    indexes: [
      ["date", "date", { unique: false }],
      ["status", "status", { unique: false }]
    ]
  },

  auditLog: {
    keyPath: "id",
    indexes: [
      ["date", "date", { unique: false }],
      ["entity", "entity", { unique: false }]
    ]
  }
};

/** @typedef {keyof typeof STORES} StoreName */
/** @typedef {{[key: string]: any, id?: string}} DBRecord */

/** @type {Promise<IDBDatabase>|null} */
let databasePromise = null;

/**
 * Abre o banco local.
 * @returns {Promise<IDBDatabase>}
 */
function openCantinaDB() {
  if (!("indexedDB" in window)) {
    return Promise.reject(
      new Error("Este navegador não oferece IndexedDB.")
    );
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;

      if (!transaction) {
        reject(new Error("Falha na atualização do banco."));
        return;
      }

      for (const [storeName, config] of Object.entries(STORES)) {
        let store;

        if (!db.objectStoreNames.contains(storeName)) {
          store = db.createObjectStore(storeName, {
            keyPath: config.keyPath
          });
        } else {
          store = transaction.objectStore(storeName);
        }

        for (const [indexName, keyPath, options] of (
          config.indexes || []
        )) {
          if (!store.indexNames.contains(indexName)) {
            store.createIndex(indexName, keyPath, options);
          }
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      databasePromise = null;
      reject(
        request.error ||
        new Error("Não foi possível abrir o banco local.")
      );
    };

    request.onblocked = () => {
      reject(
        new Error("Feche outras abas do CantinaPro.")
      );
    };
  });

  return databasePromise;
}

/**
 * Gera identificador para os registros.
 * @returns {string}
 */
function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `cp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Executa operações nas tabelas.
 * @param {StoreName} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} operation
 * @returns {Promise<any>}
 */
async function withStore(storeName, mode, operation) {
  if (!Object.prototype.hasOwnProperty.call(STORES, storeName)) {
    throw new Error(`Tabela local desconhecida: ${storeName}`);
  }

  const db = await openCantinaDB();

  return new Promise((resolve, reject) => {
    let transaction;
    let result;

    try {
      transaction = db.transaction(storeName, mode);

      const store = transaction.objectStore(storeName);

      result = operation(store);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      resolve(result ? result.result : undefined);
    };

    transaction.onerror = () => {
      reject(
        transaction.error ||
        (result && result.error) ||
        new Error("Erro ao gravar no banco local.")
      );
    };

    transaction.onabort = () => {
      reject(
        transaction.error ||
        new Error("Operação local cancelada.")
      );
    };
  });
}

/**
 * Ferramentas disponíveis para o aplicativo.
 */
const CantinaDB = {

  name: DB_NAME,
  version: DB_VERSION,
  stores: Object.keys(STORES),

  open: openCantinaDB,

  /**
   * RECEBER E CADASTRAR UM REGISTRO.
   * @param {StoreName} storeName
   * @param {DBRecord} record
   * @returns {Promise<DBRecord>}
   */
  async add(storeName, record) {
    if (!record || typeof record !== "object") {
      throw new Error("Registro inválido.");
    }

    const item = {
      ...record,
      id: record.id || makeId()
    };

    await withStore(
      storeName,
      "readwrite",
      store => store.add(item)
    );

    return item;
  },

  /**
   * ATUALIZAR OU SALVAR UM REGISTRO.
   * @param {StoreName} storeName
   * @param {DBRecord} record
   * @returns {Promise<DBRecord>}
   */
  async put(storeName, record) {
    if (!record || typeof record !== "object") {
      throw new Error("Registro inválido.");
    }

    const item = {
      ...record,
      id: record.id || makeId(),
      updatedAt: new Date().toISOString()
    };

    await withStore(
      storeName,
      "readwrite",
      store => store.put(item)
    );

    return item;
  },

  /**
   * CONSULTAR UM REGISTRO PELO ID.
   * @param {StoreName} storeName
   * @param {IDBValidKey} id
   * @returns {Promise<any>}
   */
  async get(storeName, id) {
    const result = await withStore(
      storeName,
      "readonly",
      store => store.get(id)
    );

    return result ?? null;
  },

  /**
   * CONSULTAR TODOS OS REGISTROS.
   * @param {StoreName} storeName
   * @returns {Promise<any[]>}
   */
  async getAll(storeName) {
    const result = await withStore(
      storeName,
      "readonly",
      store => store.getAll()
    );

    return result || [];
  },

  /**
   * EXCLUIR UM REGISTRO PELO ID.
   * @param {StoreName} storeName
   * @param {IDBValidKey} id
   * @returns {Promise<void>}
   */
  async delete(storeName, id) {
    await withStore(
      storeName,
      "readwrite",
      store => store.delete(id)
    );
  },

  /**
   * CONTAR REGISTROS.
   * @param {StoreName} storeName
   * @returns {Promise<number>}
   */
  async count(storeName) {
    const result = await withStore(
      storeName,
      "readonly",
      store => store.count()
    );

    return result;
  },

  /**
   * BUSCAR REGISTROS POR ÍNDICE.
   * @param {StoreName} storeName
   * @param {string} indexName
   * @param {IDBValidKey|IDBKeyRange} value
   * @returns {Promise<any[]>}
   */
  async getByIndex(storeName, indexName, value) {
    return withStore(
      storeName,
      "readonly",
      store => {
        if (!store.indexNames.contains(indexName)) {
          throw new Error(
            `Índice não encontrado: ${indexName}`
          );
        }

        return store.index(indexName).getAll(value);
      }
    );
  }
};

// Disponibiliza as ferramentas para o app.js.
window.CantinaDB = CantinaDB;

// Inicializa o banco.
openCantinaDB()
  .then(() => {
    console.info(
      "[CantinaPro Offline] Banco local pronto."
    );
  })
  .catch(error => {
    console.error(
      "[CantinaPro Offline] Falha ao iniciar:",
      error
    );
  });
