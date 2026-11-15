// CantinaPro Offline — app.js
// Compatível com o index.html enviado.
// Preserva o IndexedDB existente: não cria, apaga ou altera tabelas.

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const DB_NAME = 'cantinapro_offline';
  const DB_VERSION = 1;

  let database = null;
  let products = [];
  let categories = [];
  window.CantinaApp = window.CantinaApp || {};

  const elements = {
    dbState: $('dbState'),
    productCount: $('productCount'),
    message: $('message'),
    connectionStatus: $('connectionStatus'),
    productForm: $('productForm'),
    categoryForm: $('categoryForm'),
    productName: $('productName'),
    productBarcode: $('productBarcode'),
    productCategory: $('productCategory'),
    productCost: $('productCost'),
    productPrice: $('productPrice'),
    productStock: $('productStock'),
    categoryName: $('categoryName'),
    productSearch: $('productSearch'),
    productList: $('productList'),
    categoryList: $('categoryList'),
    productsPage: $('productsPage'),
    productListPage: $('productListPage'),
    categoriesPage: $('categoriesPage')
  };

  function notify(message, error = false) {
    if (elements.message) {
      elements.message.textContent = message;
      elements.message.style.color = error ? '#b42318' : '';
    }

    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.className = error ? 'err' : '';
      toast.hidden = false;
      clearTimeout(notify.timer);
      notify.timer = setTimeout(() => { toast.hidden = true; }, 4500);
    }
  }

  function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    return 'id-' + Date.now() + '-' +
      Math.random().toString(16).slice(2);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      // Primeiro tenta utilizar a conexão já fornecida pelo db.js.
      if (
        window.CantinaDB &&
        typeof window.CantinaDB.open === 'function'
      ) {
        Promise.resolve(window.CantinaDB.open())
          .then(db => {
            if (db && typeof db.transaction === 'function') {
              resolve(db);
            } else {
              reject(new Error('A conexão do db.js não retornou um banco válido.'));
            }
          })
          .catch(reject);

        return;
      }

      // Alternativa: abre somente a versão existente do banco.
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onsuccess = () => resolve(request.result);

      request.onerror = () => {
        reject(request.error || new Error('Não foi possível abrir o banco.'));
      };

      request.onupgradeneeded = () => {
        request.transaction.abort();
        reject(new Error(
          'O banco existente precisa ser preservado. Nenhuma alteração foi feita.'
        ));
      };

      request.onblocked = () => {
        reject(new Error('Feche outras telas do CantinaPro e tente novamente.'));
      };
    });
  }

  function readAll(storeName) {
    return new Promise((resolve, reject) => {
      if (!database.objectStoreNames.contains(storeName)) {
        reject(new Error('A tabela "' + storeName + '" não existe no banco.'));
        return;
      }

      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function saveRecord(storeName, record) {
    return new Promise((resolve, reject) => {
      if (!database.objectStoreNames.contains(storeName)) {
        reject(new Error('A tabela "' + storeName + '" não existe.'));
        return;
      }

      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const keyPath = store.keyPath;

      // Adapta o identificador ao formato já existente.
      if (typeof keyPath === 'string' && !record[keyPath]) {
        record[keyPath] = makeId();
      }

      const request = store.put(record);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(
        transaction.error || new Error('Não foi possível salvar.')
      );
    });
  }

  function deleteRecord(storeName, id) {
    return new Promise((resolve, reject) => {
      if (!database.objectStoreNames.contains(storeName)) {
        reject(new Error('A tabela "' + storeName + '" não existe.'));
        return;
      }

      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);

      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(
        transaction.error || new Error('Não foi possível excluir.')
      );
    });
  }

  function categoryId(category) {
    return category.id ?? category.categoryId ?? category.nome;
  }

  function categoryName(category) {
    return category.name ?? category.nome ?? '';
  }

  function productId(product) {
    return product.id ?? product.productId ?? product.codigo;
  }

  function productName(product) {
    return product.name ?? product.nome ?? '';
  }

  function productPrice(product) {
    return product.price ?? product.preco ?? product.salePrice ?? 0;
  }

  function productCost(product) {
    return product.cost ?? product.custo ?? product.purchasePrice ?? 0;
  }

  function productStock(product) {
    return product.stock ?? product.estoque ?? 0;
  }

  function productBarcode(product) {
    return product.barcode ?? product.codigoBarras ?? '';
  }

  async function refreshData() {
    products = await readAll('products');
    categories = await readAll('categories');

    renderCategories();
    renderProducts();
    updateStats();
  }

  function updateStats() {
    if (elements.dbState) {
      elements.dbState.textContent = 'Conectado';
    }

    if (elements.productCount) {
      elements.productCount.textContent = products.length;
    }
  }

  function renderCategories() {
    if (elements.productCategory) {
      const selected = elements.productCategory.value;

      elements.productCategory.innerHTML =
        '<option value="">Sem categoria</option>';

      categories.forEach(category => {
        const option = document.createElement('option');
        option.value = categoryId(category);
        option.textContent = categoryName(category);
        elements.productCategory.appendChild(option);
      });

      if (categories.some(c => String(categoryId(c)) === String(selected))) {
        elements.productCategory.value = selected;
      }
    }

    if (elements.categoryList) {
      if (!categories.length) {
        elements.categoryList.innerHTML =
          '<p>Nenhuma categoria cadastrada.</p>';
        return;
      }

      elements.categoryList.innerHTML = categories.map(category => `
        <div class="item">
          <strong>${escapeHTML(categoryName(category))}</strong>
          <button type="button"
            data-edit-category="${escapeHTML(categoryId(category))}">
            Editar
          </button>
          <button type="button"
            data-delete-category="${escapeHTML(categoryId(category))}">
            Excluir
          </button>
        </div>
      `).join('');
    }
  }

  function renderProducts() {
    if (!elements.productList) return;

    const search = (elements.productSearch?.value || '')
      .trim()
      .toLocaleLowerCase('pt-BR');

    const filtered = products.filter(product => {
      const name = productName(product).toLocaleLowerCase('pt-BR');
      const barcode = String(productBarcode(product)).toLowerCase();

      return name.includes(search) || barcode.includes(search);
    });

    if (!filtered.length) {
      elements.productList.innerHTML =
        '<p>Nenhum produto encontrado.</p>';
      return;
    }

    elements.productList.innerHTML = filtered.map(product => {
      const id = productId(product);
      const category = categories.find(c =>
        String(categoryId(c)) === String(
          product.categoryId ?? product.category ?? ''
        )
      );

      return `
        <article class="item">
          <h3>${escapeHTML(productName(product))}</h3>
          <p>Preço: <strong>${money(productPrice(product))}</strong></p>
          <p>Custo: ${money(productCost(product))}</p>
          <p>Estoque: ${escapeHTML(productStock(product))}</p>
          <p>Código: ${escapeHTML(productBarcode(product) || 'Não informado')}</p>
          <p>Categoria: ${escapeHTML(
            category ? categoryName(category) : 'Sem categoria'
          )}</p>
          <button type="button"
            data-edit-product="${escapeHTML(id)}">Editar</button>
          <button type="button"
            data-delete-product="${escapeHTML(id)}">
            Excluir produto
          </button>
        </article>
      `;
    }).join('');
  }

  async function addProduct(event) {
    event.preventDefault();

    const name = elements.productName.value.trim();
    const price = Number(elements.productPrice.value);
    const cost = Number(elements.productCost.value || 0);
    const stock = Number(elements.productStock.value || 0);

    if (!name) {
      notify('Informe o nome do produto.', true);
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      notify('Informe um preço de venda válido.', true);
      return;
    }

    if (!Number.isFinite(cost) || cost < 0 ||
        !Number.isFinite(stock) || stock < 0) {
      notify('Confira o custo e o estoque informados.', true);
      return;
    }

    const id = makeId();

    const record = {
      id,
      name,
      nome: name,
      barcode: elements.productBarcode.value.trim(),
      codigoBarras: elements.productBarcode.value.trim(),
      categoryId: elements.productCategory.value || '',
      cost,
      custo: cost,
      price,
      preco: price,
      stock,
      estoque: stock,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await saveRecord('products', record);
      elements.productForm.reset();

      if (elements.productCost) elements.productCost.value = '0';
      if (elements.productStock) elements.productStock.value = '0';

      await refreshData();
      notify('Produto cadastrado com sucesso.');
    } catch (error) {
      console.error(error);
      notify(error.message || 'Erro ao cadastrar produto.', true);
    }
  }

  async function addCategory(event) {
    event.preventDefault();

    const name = elements.categoryName.value.trim();

    if (!name) {
      notify('Informe o nome da categoria.', true);
      return;
    }

    const exists = categories.some(category =>
      categoryName(category).toLocaleLowerCase('pt-BR') ===
      name.toLocaleLowerCase('pt-BR')
    );

    if (exists) {
      notify('Essa categoria já está cadastrada.', true);
      return;
    }

    const record = {
      id: makeId(),
      name,
      nome: name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await saveRecord('categories', record);
      elements.categoryForm.reset();
      await refreshData();
      notify('Categoria cadastrada com sucesso.');
    } catch (error) {
      console.error(error);
      notify(error.message || 'Erro ao cadastrar categoria.', true);
    }
  }

  async function removeProduct(id) {
    if (!confirm('Deseja excluir este produto?')) return;

    try {
      await deleteRecord('products', id);
      await refreshData();
      notify('Produto excluído.');
    } catch (error) {
      console.error(error);
      notify(error.message || 'Erro ao excluir produto.', true);
    }
  }

  async function removeCategory(id) {
    const used = products.some(product =>
      String(product.categoryId ?? product.category ?? '') === String(id)
    );

    if (used) {
      notify('Esta categoria está vinculada a um produto. Altere a categoria do produto antes de excluir.', true);
      return;
    }

    if (!confirm('Deseja excluir esta categoria?')) return;

    try {
      await deleteRecord('categories', id);
      await refreshData();
      notify('Categoria excluída.');
    } catch (error) {
      console.error(error);
      notify(error.message || 'Erro ao excluir categoria.', true);
    }
  }

  function showPage(page) {
    document.querySelectorAll('[data-view]').forEach(section => {
      section.hidden = !section.dataset.view.split(' ').includes(page);
    });

    window.CantinaApp.onPage?.(page);

    document.querySelector('[data-view~="' + page + '"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function installNavigation() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-page], [data-go]');

      if (!button) return;

      const page = button.dataset.page || button.dataset.go;

      if (page) {
        event.preventDefault();
        showPage(page);
      }
    }, true);
  }

  function installActions() {
    elements.productForm?.addEventListener('submit', addProduct);
    elements.categoryForm?.addEventListener('submit', addCategory);

    elements.productSearch?.addEventListener('input', renderProducts);

    document.addEventListener('click', event => {
      const productButton = event.target.closest('[data-delete-product]');
      const categoryButton = event.target.closest('[data-delete-category]');

      if (productButton) {
        removeProduct(productButton.dataset.deleteProduct);
      }

      if (categoryButton) {
        removeCategory(categoryButton.dataset.deleteCategory);
      }
    });
  }

  function updateConnectionStatus() {
    if (!elements.connectionStatus) return;

    elements.connectionStatus.textContent = navigator.onLine
      ? 'Online'
      : 'Offline';
  }

  async function start() {
    try {
      notify('Conectando ao banco local...');

      database = await openDatabase();

      await refreshData();

      installNavigation();
      installActions();
      updateConnectionStatus();

      window.addEventListener('online', updateConnectionStatus);
      window.addEventListener('offline', updateConnectionStatus);

      Object.assign(window.CantinaApp, { notify, refreshData, showPage });

      if ('serviceWorker' in navigator) {
        const tinhaSW = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!tinhaSW || document.getElementById('updBar')) return;
          const bar = document.createElement('div');
          bar.id = 'updBar';
          bar.innerHTML = 'Nova versão instalada. <button type="button">Atualizar agora</button>';
          bar.querySelector('button').onclick = () => location.reload();
          document.body.appendChild(bar);
        });
        navigator.serviceWorker.register('sw.js').catch(console.warn);
      }

      showPage('products');
      notify('CantinaPro iniciado. Banco local conectado.');

    } catch (error) {
      console.error('Erro ao iniciar CantinaPro:', error);

      if (elements.dbState) {
        elements.dbState.textContent = 'Erro';
      }

      notify(
        error.message || 'Não foi possível iniciar o CantinaPro.',
        true
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();