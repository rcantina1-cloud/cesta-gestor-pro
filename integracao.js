// CantinaPro Offline — integracao.js
// Liga a interface aos módulos existentes (sem alterá-los) e ao IndexedDB atual.
import Cliente from './modulos/Cliente.js';
import Estoque from './modulos/Estoque.js';
import Fornecedores from './modulos/fornecedores.js';
import Produtos from './modulos/produtos.js';
import Compras from './modulos/Compras.js';
import Vendas from './modulos/Vendas.js';
import Caixa from './modulos/Caixa.js';

const DB = window.CantinaDB;
const App = () => window.CantinaApp;
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = s => new Date(s).toLocaleString('pt-BR');
const hoje = () => new Date().toLocaleDateString('sv-SE');
const dia = s => new Date(s).toLocaleDateString('sv-SE');
const fmt = n => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2).replace('.', ',');
const sa = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
const cfg = async () => ({ nome: 'CantinaPro', linha2: '', largura: '80', modo: 'navegador', auto: 'nao', ...((await DB.get('settings', 'loja')) || {}) });

function say(m, err) {
  App().notify?.(m, err);
  const t = $('#toast');
  t.textContent = m; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(say.t); say.t = setTimeout(() => (t.hidden = true), 4500);
}

/* ---- Produtos: adaptador entre o módulo (PT) e a tabela "products" atual ---- */
const toPT = r => ({ ...r, nome: r.nome ?? r.name, precoVenda: r.precoVenda ?? r.price ?? r.preco ?? 0,
  precoCompra: r.precoCompra ?? r.cost ?? r.custo ?? 0, estoque: r.estoque ?? r.stock ?? 0,
  codigoBarras: r.codigoBarras ?? r.barcode ?? '', tipo: r.tipo || 'unidade' });
const toDB = p => ({ ...p, name: p.nome, price: p.precoVenda, preco: p.precoVenda, cost: p.precoCompra,
  custo: p.precoCompra, stock: p.estoque, barcode: p.codigoBarras || '', categoryId: p.categoryId || '' });
const banco = {
  listar: async () => (await DB.getAll('products')).map(toPT),
  salvar: (_t, p) => DB.put('products', toDB(p)),
  excluir: (_t, id) => DB.delete('products', id)
};
const produtos = new Produtos(banco);

/* ---- Estoque: serviço síncrono exigido por Compras/Vendas, com gravação atômica ---- */
let cache = new Map(); const pend = [];
const mov = (n, id, tipo, q, motivo) => pend.push({ n, mov: { ...Estoque.criarMovimentacao({ produtoId: id, tipo, quantidade: q, motivo }), saldo: n.estoque } });
const est = {
  get(id) { const p = cache.get(id); if (!p) throw new Error('Produto não encontrado.'); return p; },
  entrada(id, q, motivo) { const n = Estoque.entrada(this.get(id), q); cache.set(id, n); mov(n, id, 'entrada', Number(q), motivo); },
  saida(id, q, motivo) {
    const p = this.get(id);
    try { const n = Estoque.saida(p, q); cache.set(id, n); mov(n, id, 'saida', Number(q), motivo); }
    catch (e) { throw new Error(e.message + ' (' + p.nome + ')'); }
  },
  ajustar(id, q, motivo) {
    const p = this.get(id), n = Estoque.ajustar(p, q), d = Math.abs(n.estoque - p.estoque);
    if (!d) throw new Error('O estoque já está com esse valor.');
    cache.set(id, n); mov(n, id, 'ajuste', d, motivo);
  }
};
async function comEstoque(fn, undo) {
  cache = new Map((await produtos.listar()).map(p => [p.id, p])); pend.length = 0;
  let r;
  try { r = fn(); } catch (e) { pend.length = 0; throw e; }
  try {
    for (const { n, mov: m } of pend) {
      await banco.salvar('produtos', n);
      await DB.put('auditLog', { ...m, date: m.data, entity: 'estoque' });
    }
  } catch (e) { undo?.(); pend.length = 0; throw e; }
  pend.length = 0; return r;
}

/* ---- Persistência: IndexedDB é a base; o localStorage dos módulos vira cópia de trabalho ---- */
const LS = [ // [chave, caminho, store, alias de data, campo de origem]
  ['cantinapro_clientes', null, 'customers'],
  ['cantinapro_vendas', null, 'sales', 'date', 'data'],
  ['cantinapro_compras', null, 'purchases', 'date', 'data'],
  ['cantinapro_caixa', 'sessoes', 'cashSessions', 'openedAt', 'dataAbertura'],
  ['cantinapro_caixa', 'movimentacoes', 'cashMovements', 'date', 'data']
];
const lsGet = (k, p) => { const o = JSON.parse(localStorage.getItem(k) || 'null'); return p ? (o?.[p] || []) : (o || []); };
const lsSet = (k, p, arr) => {
  if (!p) return localStorage.setItem(k, JSON.stringify(arr));
  const o = JSON.parse(localStorage.getItem(k) || 'null') || { sessoes: [], movimentacoes: [] };
  o[p] = arr; localStorage.setItem(k, JSON.stringify(o));
};
const snap = new Map(); let fila = Promise.resolve();
async function gravar() {
  for (const [k, p, store, alias, src] of LS) {
    const ids = new Set();
    for (const r of lsGet(k, p)) {
      ids.add(r.id);
      const rec = alias ? { ...r, [alias]: r[src] } : { ...r }, j = JSON.stringify(rec);
      if (snap.get(store + r.id) !== j) { await DB.put(store, rec); snap.set(store + r.id, j); }
    }
    for (const key of [...snap.keys()]) {
      if (key.startsWith(store) && !ids.has(key.slice(store.length))) { await DB.delete(store, key.slice(store.length)); snap.delete(key); }
    }
  }
}
const persistir = () => (fila = fila.catch(() => {}).then(gravar));
async function hidratar() {
  await DB.open();
  for (const [k, p, store, alias] of LS) {
    const rows = await DB.getAll(store);
    if (rows.length) lsSet(k, p, rows.map(({ updatedAt, [alias]: _a, ...r }) => r)); // IndexedDB manda
  }
  await persistir(); // primeira execução: copia o que já existia no localStorage
  navigator.storage?.persist?.();
}
await hidratar();

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const vendas = new Vendas({ estoque: est });
const compras = new Compras({ estoque: est });
const caixa = new Caixa({ vendas });
for (const [m, fns] of [[vendas, ['calcularSubtotal', 'calcularTotal']], [compras, ['calcularTotal']]]) {
  for (const f of fns) { const o = m[f].bind(m); m[f] = (...a) => r2(o(...a)); } // dinheiro sempre em centavos
}

/* ---- Cancelamentos (com estorno de estoque e de caixa) ---- */
async function cancelarVenda(id) {
  const v = vendas.consultar(id);
  if (!v) throw new Error('Venda não encontrada.');
  if (v.status === 'cancelada') throw new Error('Esta venda já foi cancelada.');
  const ms = caixa.dados.movimentacoes.filter(x => x.tipo === 'venda' && x.referenciaId === id);
  const aberto = caixa.obterCaixaAberto();
  if (ms.length && (!aberto || ms.some(m => m.sessaoId !== aberto.id))) throw new Error('Venda de caixa já fechado não pode ser cancelada.');
  await comEstoque(() => v.itens.forEach(i => cache.has(i.produtoId) && est.entrada(i.produtoId, i.quantidade, 'Cancelamento ' + id)));
  v.status = 'cancelada'; v.dataCancelamento = new Date().toISOString(); vendas.salvar();
  ms.forEach(m => { m.tipo = 'venda_cancelada'; m.descricao = 'Venda cancelada'; });
  if (ms.length) caixa.salvar();
  const cl = v.fiado > 0 && v.clienteId ? Cliente.buscar(v.clienteId) : null;
  if (cl) Cliente.editar(cl.id, { saldoFiado: Math.max(0, r2((cl.saldoFiado || 0) - v.fiado)) });
}
async function receberFiado(id) {
  const c = Cliente.buscar(id), txt = prompt('Valor recebido em dinheiro (dívida: ' + money(c.saldoFiado) + '):');
  const v = r2(txt || 0); if (!(v > 0)) return '';
  if (v > (c.saldoFiado || 0)) throw new Error('Valor maior que a dívida do cliente.');
  if (!caixa.estaAberto()) throw new Error('Abra o caixa para receber pagamentos.');
  caixa.registrarEntrada(v, 'Recebimento fiado - ' + c.nome);
  Cliente.editar(id, { saldoFiado: r2(c.saldoFiado - v) });
  return 'Recebimento registrado.'
}
async function cancelarCompra(id) {
  const c = compras.consultar(id);
  if (!c) throw new Error('Compra não encontrada.');
  if (c.status === 'cancelada') throw new Error('Esta compra já foi cancelada.');
  await comEstoque(() => c.itens.forEach(i => cache.has(i.produtoId) && est.saida(i.produtoId, i.quantidade, 'Cancelamento ' + id)));
  c.status = 'cancelada'; c.dataCancelamento = new Date().toISOString(); compras.salvar();
}


async function exportarBackup() {
  await persistir();
  const data = { app: 'cantinapro', versao: 1, exportadoEm: new Date().toISOString(), stores: {} };
  for (const st of DB.stores) data.stores[st] = await DB.getAll(st);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = 'cantinapro-backup-' + hoje() + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  await DB.put('settings', { id: 'backup', em: data.exportadoEm });
}
async function restaurarBackup(file) {
  const d = JSON.parse(await file.text());
  if (d.app !== 'cantinapro' || !d.stores) throw new Error('Arquivo de backup inválido.');
  for (const [st, rows] of Object.entries(d.stores)) if (!DB.stores.includes(st) || !Array.isArray(rows)) throw new Error('Backup com dados inesperados (' + st + ').');
  if (!confirm('Restaurar vai SUBSTITUIR os dados atuais pelos do backup de ' + dt(d.exportadoEm) + '. Um backup dos dados atuais será baixado antes. Continuar?')) return;
  await exportarBackup();
  for (const [st, rows] of Object.entries(d.stores)) {
    for (const r of await DB.getAll(st)) await DB.delete(st, r.id);
    for (const r of rows) await DB.put(st, r);
  }
  ['cantinapro_clientes', 'cantinapro_vendas', 'cantinapro_compras', 'cantinapro_caixa'].forEach(k => localStorage.removeItem(k));
  location.reload();
}

function resumir(pred, custo, desp) {
  const todas = vendas.listar(), vs = todas.filter(v => v.status === 'finalizada' && pred(dia(v.data)));
  const r = { n: vs.length, canc: todas.filter(v => v.status === 'cancelada' && pred(dia(v.data))).length, receita: 0, cmv: 0, fiado: 0, pg: { Dinheiro: 0, Pix: 0, 'Cartão': 0 } }, top = {};
  for (const v of vs) {
    r.receita += v.total; r.fiado += v.fiado || 0;
    for (const i of v.itens) { r.cmv += i.quantidade * (i.custo ?? custo.get(i.produtoId) ?? 0); top[i.nome] = (top[i.nome] || 0) + i.quantidade; }
    for (const p of v.pagamentos || [{ forma: v.formaPagamento, valor: v.total }]) if (p.forma in r.pg) r.pg[p.forma] += p.valor;
  }
  r.desp = desp.filter(e => pred(e.date)).reduce((t, e) => t + e.valor, 0);
  for (const k of ['receita', 'cmv', 'fiado', 'desp']) r[k] = r2(r[k]);
  r.top = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, q]) => `${n} (${q})`).join(', ');
  return r;
}

/* ---- Cupom: texto 58 mm (32 col.) / 80 mm (48 col.), USB ESC/POS ou navegador ---- */
function montarCupom(v, larg, c) {
  const W = larg === 58 ? 32 : 48, ln = '-'.repeat(W), L = [];
  const ctr = t => ' '.repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t;
  const lr = (a, b) => { a = sa(a); b = sa(b); return a.slice(0, Math.max(0, W - b.length - 1)).padEnd(W - b.length) + b; };
  L.push(ctr(sa(c.nome).slice(0, W))); if (c.linha2) L.push(ctr(sa(c.linha2).slice(0, W)));
  L.push(ln, ctr('CUPOM NAO FISCAL'), sa(dt(v.data)).slice(0, W), ln);
  for (const i of v.itens) { L.push(sa(i.nome).slice(0, W)); L.push(lr(`  ${i.quantidade} x ${fmt(i.precoUnitario)}`, fmt(i.subtotal ?? i.quantidade * i.precoUnitario))); }
  L.push(ln, lr('Subtotal', fmt(v.subtotal)));
  if (v.desconto > 0) L.push(lr('Desconto', '-' + fmt(v.desconto)));
  L.push(lr('TOTAL', fmt(v.total)));
  for (const p of v.pagamentos || [{ forma: v.formaPagamento, valor: v.total }]) L.push(lr(p.forma, fmt(p.valor)));
  if (v.troco > 0) L.push(lr('Troco', fmt(v.troco)));
  if (v.clienteNome && v.clienteId) L.push('Cliente: ' + sa(v.clienteNome).slice(0, W - 9));
  L.push(ln, ctr('Obrigado pela preferencia!'));
  return L;
}
const escpos = L => Uint8Array.from([0x1B, 0x40, ...new TextEncoder().encode(L.join('\n') + '\n\n\n\n'), 0x1D, 0x56, 0x42, 0x00]);
const iface = d => {
  for (const c of d.configurations) for (const i of c.interfaces) for (const a of i.alternates) {
    if (a.interfaceClass === 7) { const ep = a.endpoints.find(e => e.direction === 'out'); if (ep) return { c: c.configurationValue, n: i.interfaceNumber, e: ep.endpointNumber }; }
  }
};
async function usbDev(parear) {
  if (!navigator.usb) throw new Error('WebUSB indisponível (use Chrome/Edge em HTTPS ou localhost).');
  let d = (await navigator.usb.getDevices()).find(x => iface(x));
  if (!d && parear) { d = await navigator.usb.requestDevice({ filters: [] }); if (!iface(d)) throw new Error('O dispositivo escolhido não é uma impressora USB.'); }
  if (!d) throw new Error('Nenhuma impressora USB conectada. Use Ajustes → Conectar impressora USB.');
  return d;
}
async function usbEnviar(bytes) {
  const d = await usbDev(false), f = iface(d);
  await d.open();
  try {
    if (d.configuration === null) await d.selectConfiguration(f.c);
    await d.claimInterface(f.n);
    for (let i = 0; i < bytes.length; i += 512) await d.transferOut(f.e, bytes.slice(i, i + 512));
    await d.releaseInterface(f.n);
  } finally { await d.close().catch(() => {}); }
}
function imprimirNavegador(L, larg) {
  let st = $('#pageSize'); if (!st) { st = document.createElement('style'); st.id = 'pageSize'; document.head.appendChild(st); }
  st.textContent = `@page{size:${larg}mm auto;margin:2mm}`;
  $('#cupomPrint').textContent = L.join('\n'); window.print();
}
async function imprimir(v) {
  if (!v) throw new Error('Venda não encontrada.');
  const c = await cfg(), larg = Number(c.largura), L = montarCupom(v, larg, c);
  if (c.modo === 'usb') {
    try { await usbEnviar(escpos(L)); return; }
    catch (e) { say('USB indisponível (' + (e.message || e) + '). Usando a impressão do navegador.', true); }
  }
  imprimirNavegador(L, larg);
}

/* ---- Cadastros genéricos: Clientes e Fornecedores ---- */
const sup = {
  all: () => DB.getAll('suppliers'),
  get: id => DB.get('suppliers', id)
};
const CRUD = {
  clients: { title: 'Clientes', fields: [['nome', 'Nome', 1], ['telefone', 'Telefone'], ['cpf', 'CPF'], ['email', 'E-mail']],
    list: async q => Cliente.pesquisar(q), get: async id => Cliente.buscar(id), add: async d => Cliente.cadastrar(d),
    edit: async (id, d) => Cliente.editar(id, d), del: async id => Cliente.excluir(id) },
  suppliers: { title: 'Fornecedores', fields: [['nome', 'Nome', 1], ['telefone', 'Telefone'], ['documento', 'CNPJ/CPF'], ['email', 'E-mail']],
    list: async q => Fornecedores.pesquisar(await sup.all(), q), get: sup.get,
    add: async d => DB.add('suppliers', Fornecedores.cadastrar(d)),
    edit: async (id, d) => DB.put('suppliers', Fornecedores.atualizar(await sup.get(id), d)),
    del: async id => DB.put('suppliers', Fornecedores.excluir(await sup.get(id))) }
};

/* ---- Telas ---- */
const root = $('#modPage');
let pdvProds = [], relDia = hoje();
let page = '', q = '', editing = null, cart = [];
const opts = (arr, f) => arr.map(f).join('');
const prodOpt = p => `<option value="${esc(p.id)}">${esc(p.nome)} (estoque ${p.estoque})</option>`;
const cartHTML = () => cart.map((i, k) => `<article class="item"><strong>${esc(i.nome)}</strong> — ${i.quantidade} × ${money(i.precoUnitario)}
  <button type="button" data-act="rm" data-id="${k}">Remover</button></article>`).join('') +
  (cart.length ? `<p><strong>Total: ${money(cart.reduce((t, i) => t + i.quantidade * i.precoUnitario, 0))}</strong></p>` : '<p>Nenhum item adicionado.</p>');
const payOpt = '<option>Dinheiro</option><option>Pix</option><option>Cartão</option>';

const VIEWS = {
  async expenses() {
    const rows = (await DB.getAll('expenses')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
    return `<h2>Despesas</h2><form data-form="expense"><label>Descrição</label><input name="descricao" required><label>Valor (R$)</label><input name="valor" type="number" step="0.01" min="0.01" required>
      <label>Data</label><input name="data" type="date" value="${hoje()}"><button>Registrar despesa</button></form>` +
      (rows.map(e => `<article class="item"><strong>${esc(e.descricao)}</strong> — ${money(e.valor)}<p>${esc(e.date)}</p><button type="button" data-act="delexp" data-id="${esc(e.id)}">Excluir</button></article>`).join('') || '<p>Nenhuma despesa.</p>');
  },
  async reports(prods) {
    const custo = new Map(prods.map(p => [p.id, p.precoCompra])), desp = await DB.getAll('expenses');
    const bloco = (titulo, pred) => {
      const r = resumir(pred, custo, desp);
      return `<article class="item"><h3>${titulo}</h3><p>Vendas: ${r.n} · Cancelamentos: ${r.canc}</p><p>Receita: <strong>${money(r.receita)}</strong></p><p>Custo das mercadorias: ${money(r.cmv)}</p>
        <p>Lucro bruto: <strong>${money(r.receita - r.cmv)}</strong></p><p>Despesas: ${money(r.desp)}</p><p>Lucro líquido: <strong>${money(r.receita - r.cmv - r.desp)}</strong></p>
        <p>Dinheiro ${money(r.pg.Dinheiro)} · Pix ${money(r.pg.Pix)} · Cartão ${money(r.pg['Cartão'])} · Fiado ${money(r.fiado)}</p><p>Mais vendidos: ${esc(r.top || '—')}</p></article>`;
    };
    return `<h2>Relatórios</h2><label>Data de referência</label><input type="date" data-rel value="${relDia}">` +
      bloco('Dia ' + relDia, d => d === relDia) + bloco('Mês ' + relDia.slice(0, 7), d => d.slice(0, 7) === relDia.slice(0, 7));
  },
  async settings() {
    const c = await cfg(), sel = (a, b) => (a === b ? 'selected' : ''), bk = await DB.get('settings', 'backup');
    const dias = bk ? (Date.now() - new Date(bk.em)) / 864e5 : Infinity;
    return `<h2>Ajustes de impressão</h2><form data-form="ajustes"><label>Nome da loja</label><input name="nome" value="${esc(c.nome)}"><label>Linha 2 (endereço/CNPJ)</label><input name="linha2" value="${esc(c.linha2)}">
      <label>Papel</label><select name="largura"><option value="58" ${sel(c.largura, '58')}>58 mm (32 colunas)</option><option value="80" ${sel(c.largura, '80')}>80 mm (48 colunas)</option></select>
      <label>Forma de impressão</label><select name="modo"><option value="usb" ${sel(c.modo, 'usb')}>USB direta (ESC/POS)</option><option value="navegador" ${sel(c.modo, 'navegador')}>Janela de impressão do navegador</option></select>
      <label>Imprimir ao finalizar venda</label><select name="auto"><option value="nao" ${sel(c.auto, 'nao')}>Não</option><option value="sim" ${sel(c.auto, 'sim')}>Sim</option></select><button>Salvar ajustes</button></form>
      <article class="item"><p>Para USB direta: conecte a impressora, toque em conectar e escolha-a na lista. Requer Chrome/Edge em HTTPS ou localhost.</p>
      <button type="button" data-act="usbpair">Conectar impressora USB</button><button type="button" data-act="teste">Imprimir teste</button></article>
      <article class="item"><h3>Backup dos dados</h3><p>Último backup: ${bk ? dt(bk.em) : 'nunca'}</p>${dias > 7 ? '<p class="warn">Faça um backup: os dados ficam só neste aparelho.</p>' : ''}
      <button type="button" data-act="backup">Exportar backup</button><label>Restaurar de um arquivo de backup</label><input type="file" accept=".json,application/json" data-restore></article>`;
  },
  async stock(prods) {
    const baixo = Estoque.estoqueBaixo(prods), nomes = new Map(prods.map(p => [p.id, p.nome]));
    const hist = (await DB.getAll('auditLog')).filter(a => a.entity === 'estoque').sort((a, b) => b.data.localeCompare(a.data)).slice(0, 40);
    return `<h2>Estoque</h2><form data-form="stock"><label>Produto</label><select name="id" required>${opts(prods, prodOpt)}</select>
      <label>Operação</label><select name="tipo"><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste">Ajuste (novo saldo)</option></select>
      <label>Quantidade</label><input name="qtd" type="number" step="0.001" min="0" required><label>Motivo</label><input name="motivo"><button>Registrar</button></form>
      ${baixo.length ? `<p class="warn">Estoque baixo: ${baixo.map(p => esc(p.nome)).join(', ')}</p>` : ''}` +
      Estoque.consultar(prods).map(p => `<article class="item"><strong>${esc(p.nome)}</strong><p>${p.quantidade} — ${p.situacao}</p></article>`).join('') +
      '<h2>Movimentações recentes</h2>' + (hist.map(a => `<article class="item"><strong>${esc(nomes.get(a.produtoId) || 'Produto removido')}</strong> — ${esc(a.tipo)} ${a.quantidade}<p>${dt(a.data)} · saldo ${a.saldo ?? '—'} · ${esc(a.motivo)}</p></article>`).join('') || '<p>Nenhuma movimentação.</p>');
  },
  async purchases(prods) {
    const sups = (await sup.all()).filter(s => s.ativo !== false);
    return `<h2>Compras</h2><form data-form="item"><label>Produto</label><select name="id" required>${opts(prods, prodOpt)}</select>
      <label>Quantidade</label><input name="qtd" type="number" step="0.001" min="0.001" required><label>Preço unitário (R$)</label><input name="preco" type="number" step="0.01" min="0" required>
      <button>Adicionar item</button></form>${cartHTML()}
      <form data-form="buy"><label>Fornecedor</label><select name="fornecedorId" required>${opts(sups, s => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`)}</select>
      <label>Pagamento</label><select name="formaPagamento">${payOpt}</select><button>Finalizar compra</button></form><h2>Histórico</h2>` +
      (compras.listar().reverse().map(c => `<article class="item"><strong>${esc(c.fornecedorNome)}</strong> — ${money(c.total)}<p>${dt(c.data)} — ${c.status}</p>
        ${c.status === 'finalizada' ? `<button type="button" data-act="cancelbuy" data-id="${esc(c.id)}">Cancelar</button>` : ''}</article>`).join('') || '<p>Nenhuma compra.</p>');
  },
  async sales(prods) {
    pdvProds = prods;
    const cli = Cliente.listar();
    return `<h2>Vendas</h2>${caixa.estaAberto() ? '' : '<p class="warn">Caixa fechado: abra o caixa para vender.</p>'}
      <label>Buscar produto ou ler código de barras</label><input data-pdv autocomplete="off" placeholder="Nome ou código (Enter)"><label>Quantidade</label><input id="pdvQty" type="number" step="0.001" min="0.001" value="1"><div id="pdvResults"></div>${cartHTML()}
      <form data-form="sell"><label>Cliente</label><select name="clienteId"><option value="">Consumidor final</option>${opts(cli, c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`)}</select>
      <label>Desconto (R$)</label><input name="desconto" type="number" step="0.01" min="0" value="0"><label>Pix (R$)</label><input name="pix" type="number" step="0.01" min="0" value="0"><label>Cartão (R$)</label><input name="cartao" type="number" step="0.01" min="0" value="0"><label>Fiado (R$ — exige cliente)</label><input name="fiado" type="number" step="0.01" min="0" value="0"><label>Dinheiro entregue (vazio = restante)</label><input name="valorRecebido" type="number" step="0.01" min="0"><button>Finalizar venda</button></form><h2>Histórico</h2>` +
      (vendas.listar().reverse().map(v => `<article class="item"><strong>${esc(v.clienteNome)}</strong> — ${money(v.total)} (${v.formaPagamento})<p>${dt(v.data)} — ${v.status}</p>
        <button type="button" data-act="cupom" data-id="${esc(v.id)}">Cupom</button>${v.status === 'finalizada' ? `<button type="button" data-act="cancelsale" data-id="${esc(v.id)}">Cancelar</button>` : ''}</article>`).join('') || '<p>Nenhuma venda.</p>');
  },
  async cash() {
    const r = caixa.resumo();
    const open = caixa.estaAberto();
    return `<h2>Caixa</h2>` + (!open ? `<form data-form="open"><label>Valor inicial (R$)</label><input name="v" type="number" step="0.01" min="0" value="0"><label>Observação</label><input name="obs"><button>Abrir caixa</button></form>` :
      `<div class="item"><p>Valor inicial: ${money(r.valorInicial)}</p><p>Vendas — Dinheiro ${money(r.vendasDinheiro)} · Pix ${money(r.vendasPix)} · Cartão ${money(r.vendasCartao)}</p>
       <p>Entradas: ${money(r.entradas)} · Retiradas: ${money(r.sangrias)}</p><p><strong>Saldo em dinheiro: ${money(r.saldoDinheiro)}</strong></p></div>
      <form data-form="entrada"><label>Entrada (R$)</label><input name="v" type="number" step="0.01" min="0.01" required><label>Descrição</label><input name="d"><button>Registrar entrada</button></form>
      <form data-form="sangria"><label>Retirada (R$)</label><input name="v" type="number" step="0.01" min="0.01" required><label>Descrição</label><input name="d"><button>Registrar retirada</button></form>
      <form data-form="close"><label>Valor contado (R$)</label><input name="v" type="number" step="0.01" min="0" required><label>Observação</label><input name="obs"><button>Fechar caixa</button></form>`) +
      '<h2>Histórico</h2>' + (caixa.historico().map(s => `<article class="item"><strong>${dt(s.dataAbertura)}</strong> — ${s.status}
        <p>Inicial ${money(s.valorInicial)}${s.resumoFechamento ? ` · Contado ${money(s.valorFechamento)} · Diferença ${money(s.resumoFechamento.diferenca)}` : ''}</p></article>`).join('') || '<p>Nenhuma sessão.</p>');
  }
};

async function crudView(c) {
  const rows = await c.list(q), e = editing || {};
  return `<h2>${c.title}</h2><form data-form="crud">${c.fields.map(([k, l, r]) => `<label>${l}</label><input name="${k}" value="${esc(e[k])}" ${r ? 'required' : ''}>`).join('')}
    <button>${editing ? 'Salvar alterações' : 'Cadastrar'}</button>${editing ? '<button type="button" data-act="cancel">Cancelar</button>' : ''}</form>
    <input data-search placeholder="Pesquisar..." value="${esc(q)}">` +
    (rows.map(r => `<article class="item"><strong>${esc(r.nome)}</strong><p>${esc(r.telefone || '')} ${esc(r.cpf || r.documento || '')}</p>${r.saldoFiado > 0 ? `<p class="warn">Fiado: ${money(r.saldoFiado)}</p>` : ''}
      ${r.saldoFiado > 0 ? `<button type="button" data-act="receber" data-id="${esc(r.id)}">Receber fiado</button>` : ''}<button type="button" data-act="edit" data-id="${esc(r.id)}">Editar</button><button type="button" data-act="del" data-id="${esc(r.id)}">Excluir</button></article>`).join('') || '<p>Nenhum registro.</p>');
}

async function render() {
  try {
    root.innerHTML = CRUD[page] ? await crudView(CRUD[page]) : await VIEWS[page](await produtos.listar());
  } catch (err) { root.innerHTML = '<p class="warn">' + esc(err.message) + '</p>'; }
}

/* ---- Formulários ---- */
let busy = false;
const lock = async fn => { if (busy) throw new Error('Aguarde: operação em andamento.'); busy = true; try { return await fn(); } finally { busy = false; } };
const FORMS = {
  crud: async f => { const c = CRUD[page]; if (editing) { await c.edit(editing.id, f); editing = null; return 'Alterações salvas.'; } await c.add(f); return 'Cadastrado com sucesso.'; },
  stock: async f => { await comEstoque(() => est[f.tipo === 'ajuste' ? 'ajustar' : f.tipo](f.id, Number(f.qtd), f.motivo)); return 'Estoque atualizado.'; },
  item: async f => {
    const p = (await produtos.listar()).find(x => x.id === f.id);
    if (!p) throw new Error('Produto não encontrado.');
    cart.push({ produtoId: p.id, nome: p.nome, quantidade: r3(f.qtd), precoUnitario: r2(f.preco !== undefined ? f.preco : p.precoVenda), custo: r2(p.precoCompra) });
    return 'Item adicionado.';
  },
  buy: async f => {
    const s = await sup.get(f.fornecedorId); if (!s) throw new Error('Informe o fornecedor.');
    await comEstoque(() => compras.registrar({ fornecedorId: s.id, fornecedorNome: s.nome, itens: cart, formaPagamento: f.formaPagamento }), () => { compras.compras.pop(); compras.salvar(); });
    cart = []; return 'Compra registrada e estoque atualizado.';
  },
  sell: async f => {
    if (!caixa.estaAberto()) throw new Error('Abra o caixa antes de vender.');
    const c = f.clienteId ? Cliente.buscar(f.clienteId) : null;
    const pix = r2(f.pix || 0), cartao = r2(f.cartao || 0), fiado = r2(f.fiado || 0), desconto = r2(f.desconto || 0);
    if (fiado > 0 && !c) throw new Error('Selecione o cliente para vender fiado.');
    const total = vendas.calcularTotal(cart, desconto), outros = r2(pix + cartao + fiado);
    if (outros > total) throw new Error('Pix + cartão + fiado excedem o total da venda.');
    const din = r2(total - outros), rec = f.valorRecebido === '' ? din : r2(f.valorRecebido);
    if (din > 0 && rec < din) throw new Error('Dinheiro entregue é menor que o restante a pagar.');
    const itensCarrinho = [...cart];
    const v = await comEstoque(() => vendas.registrar({ clienteId: c?.id, clienteNome: c?.nome, itens: cart, desconto,
      formaPagamento: 'Pix' }), () => { vendas.vendas.pop(); vendas.salvar(); });
    const partes = [['Dinheiro', din], ['Pix', pix], ['Cartão', cartao], ['Fiado', fiado]].filter(x => x[1] > 0);
    v.itens.forEach((it, k) => { it.custo = itensCarrinho[k].custo; it.subtotal = r2(it.subtotal); });
    v.pagamentos = partes.map(([forma, valor]) => ({ forma, valor }));
    v.formaPagamento = partes.length === 1 ? partes[0][0] : 'Misto';
    v.fiado = fiado; v.valorRecebido = din > 0 ? rec : 0; v.troco = din > 0 ? r2(rec - din) : 0;
    vendas.salvar();
    for (const [forma, valor] of partes) if (forma !== 'Fiado') caixa.registrarMovimentacao({ tipo: 'venda', descricao: 'Venda realizada', valor, formaPagamento: forma, referenciaId: v.id });
    caixa.salvar();
    if (fiado > 0) Cliente.editar(c.id, { saldoFiado: r2((c.saldoFiado || 0) + fiado) });
    cart = [];
    cfg().then(c => c.auto === 'sim' && imprimir(v)).catch(e => say(e.message || String(e), true));
    return 'Venda finalizada. Troco: ' + money(v.troco);
  },
  expense: async f => {
    if (!(r2(f.valor) > 0)) throw new Error('Informe um valor válido.');
    await DB.add('expenses', { descricao: f.descricao.trim(), valor: r2(f.valor), date: f.data || hoje(), status: 'paga' }); return 'Despesa registrada.';
  },
  ajustes: async f => { await DB.put('settings', { id: 'loja', ...f }); return 'Ajustes salvos.'; },
  open: async f => { caixa.abrir(f.v, f.obs); return 'Caixa aberto.'; },
  entrada: async f => { caixa.registrarEntrada(f.v, f.d || undefined); return 'Entrada registrada.'; },
  sangria: async f => { caixa.registrarSangria(f.v, f.d || undefined); return 'Retirada registrada.'; },
  close: async f => { const s = caixa.fechar(f.v, f.obs); return 'Caixa fechado. Diferença: ' + money(s.resumoFechamento.diferenca); }
};
for (const k of Object.keys(FORMS)) { const f = FORMS[k]; FORMS[k] = d => lock(async () => { const r = await f(d); await persistir(); return r; }); }

root.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const msg = await FORMS[e.target.dataset.form](Object.fromEntries(new FormData(e.target)));
    await render(); App().refreshData?.(); say(msg);
  } catch (err) { say(err.message || String(err), true); }
});

root.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  try {
    let msg = '';
    if (act === 'edit') editing = await CRUD[page].get(id);
    else if (act === 'cancel') editing = null;
    else if (act === 'rm') cart.splice(Number(id), 1);
    else if (act === 'backup') { await exportarBackup(); msg = 'Backup exportado. Guarde o arquivo em local seguro (nuvem ou pendrive).'; }
    else if (act === 'cupom') { await imprimir(vendas.consultar(id)); msg = 'Cupom enviado.'; }
    else if (act === 'usbpair') { const d = await usbDev(true); msg = 'Impressora conectada: ' + (d.productName || 'USB'); }
    else if (act === 'teste') { await imprimir({ itens: [{ nome: 'Item de teste', quantidade: 1, precoUnitario: 1, subtotal: 1 }], subtotal: 1, desconto: 0, total: 1, pagamentos: [{ forma: 'Dinheiro', valor: 1 }], troco: 0, data: new Date().toISOString() }); msg = 'Teste enviado.'; }
    else if (act === 'delexp') { if (!confirm('Excluir esta despesa?')) return; await DB.delete('expenses', id); msg = 'Despesa excluída.'; }
    else if (act === 'add') addCart(pdvProds.find(p => p.id === id));
    else if (act === 'receber') msg = await lock(() => receberFiado(id));
    else if (act === 'del') { if (!confirm('Deseja excluir este registro?')) return; await CRUD[page].del(id); msg = 'Registro excluído.'; }
    else if (act === 'cancelsale') { if (!confirm('Cancelar esta venda e devolver ao estoque?')) return; await lock(() => cancelarVenda(id)); msg = 'Venda cancelada.'; }
    else if (act === 'cancelbuy') { if (!confirm('Cancelar esta compra e retirar do estoque?')) return; await lock(() => cancelarCompra(id)); msg = 'Compra cancelada.'; }
    await persistir(); await render(); App().refreshData?.(); if (msg) say(msg);
    if (act === 'add') $('[data-pdv]')?.focus();
  } catch (err) { say(err.message || String(err), true); }
});

root.addEventListener('change', e => { if (e.target.matches('[data-rel]') && e.target.value) { relDia = e.target.value; render(); } });
root.addEventListener('change', async e => {
  if (!e.target.matches('[data-restore]') || !e.target.files[0]) return;
  const f = e.target.files[0];
  try { await lock(() => restaurarBackup(f)); } catch (err) { say(err.message || String(err), true); }
  e.target.value = '';
});
root.addEventListener('input', async e => {
  if (!e.target.matches('[data-search]')) return;
  q = e.target.value; await render();
  const s = $('[data-search]'); s.focus(); s.setSelectionRange(q.length, q.length);
});

App().onPage = p => { page = p; q = ''; editing = null; cart = []; if (CRUD[p] || VIEWS[p]) render(); };

function addCart(p) {
  if (!p) throw new Error('Produto não encontrado.');
  const qtd = r3($('#pdvQty')?.value || 1);
  if (!(qtd > 0)) throw new Error('Quantidade inválida.');
  const linha = cart.find(i => i.produtoId === p.id), novo = r3((linha?.quantidade || 0) + qtd);
  if (novo > p.estoque) throw new Error('Estoque insuficiente: ' + p.estoque + ' disponível (' + p.nome + ').');
  if (linha) linha.quantidade = novo;
  else cart.push({ produtoId: p.id, nome: p.nome, quantidade: qtd, precoUnitario: r2(p.precoVenda), custo: r2(p.precoCompra) });
}
const achar = t => { t = t.trim().toLowerCase(); return t ? pdvProds.filter(p => p.ativo !== false && (String(p.nome).toLowerCase().includes(t) || String(p.codigoBarras).includes(t))) : []; };
root.addEventListener('input', e => {
  if (!e.target.matches('[data-pdv]')) return;
  $('#pdvResults').innerHTML = achar(e.target.value).slice(0, 8).map(p => `<article class="item"><strong>${esc(p.nome)}</strong> — ${money(p.precoVenda)} · estoque ${p.estoque}
    <button type="button" data-act="add" data-id="${esc(p.id)}">Adicionar</button></article>`).join('');
});
root.addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !e.target.matches('[data-pdv]')) return;
  e.preventDefault();
  try {
    const t = e.target.value.trim(), r = achar(t), p = pdvProds.find(x => String(x.codigoBarras) === t && t) || (r.length === 1 ? r[0] : null);
    if (!p) throw new Error(r.length ? 'Vários produtos encontrados: escolha na lista.' : 'Produto não encontrado.');
    addCart(p); await render(); $('[data-pdv]')?.focus();
  } catch (err) { say(err.message || String(err), true); }
});

/* ---- Categorias: edição (nome) ---- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-edit-category]'); if (!b) return;
  e.stopImmediatePropagation();
  try {
    const cats = await DB.getAll('categories'), cat = cats.find(c => c.id === b.dataset.editCategory);
    if (!cat) throw new Error('Categoria não encontrada.');
    const nome = (prompt('Novo nome da categoria:', cat.name ?? cat.nome) || '').trim();
    if (!nome) return;
    if (cats.some(c => c.id !== cat.id && (c.name ?? c.nome).toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) throw new Error('Essa categoria já está cadastrada.');
    await DB.put('categories', { ...cat, name: nome, nome });
    await App().refreshData(); say('Categoria atualizada.');
  } catch (err) { say(err.message || String(err), true); }
}, true);

/* ---- Produtos: cadastro, edição, exclusão via módulo Produtos ---- */
let editId = null;
const F = id => $('#' + id);
function endEdit() {
  editId = null; F('productStock').disabled = false; F('productForm').reset(); F('productCost').value = '0'; F('productStock').value = '0';
  F('productSubmit').textContent = 'Salvar produto'; F('productCancel').hidden = true;
}
F('productCancel').addEventListener('click', endEdit);

document.addEventListener('submit', async e => {
  if (e.target.id !== 'productForm') return;
  e.preventDefault(); e.stopImmediatePropagation();
  try {
    const d = { nome: F('productName').value, codigoBarras: F('productBarcode').value.trim(), categoryId: F('productCategory').value,
      precoCompra: F('productCost').value || 0, precoVenda: F('productPrice').value, estoque: F('productStock').value || 0, tipo: F('productType').value };
    if (editId) delete d.estoque; // saldo só muda pela tela Estoque
    const salvo = editId ? await produtos.editar(editId, d) : await produtos.cadastrar(d);
    if (!editId && salvo.estoque > 0) {
      const m = { ...Estoque.criarMovimentacao({ produtoId: salvo.id, tipo: 'entrada', quantidade: salvo.estoque, motivo: 'Estoque inicial' }), saldo: salvo.estoque };
      await DB.put('auditLog', { ...m, date: m.data, entity: 'estoque' });
    }
    const msg = editId ? 'Produto atualizado.' : 'Produto cadastrado com sucesso.';
    endEdit(); await App().refreshData(); say(msg);
  } catch (err) { say(err.message || String(err), true); }
}, true);

document.addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit-product]'), del = e.target.closest('[data-delete-product]');
  if (!ed && !del) return;
  e.stopImmediatePropagation();
  try {
    if (ed) {
      const p = await produtos.buscarPorId(ed.dataset.editProduct); if (!p) throw new Error('Produto não encontrado.');
      editId = p.id; F('productName').value = p.nome; F('productBarcode').value = p.codigoBarras;
      F('productCategory').value = p.categoryId || ''; F('productCost').value = p.precoCompra;
      F('productPrice').value = p.precoVenda; F('productStock').value = p.estoque; F('productStock').disabled = true; F('productStock').title = 'Altere o saldo pela tela Estoque'; F('productType').value = p.tipo;
      F('productSubmit').textContent = 'Salvar alterações'; F('productCancel').hidden = false;
      F('productsPage').scrollIntoView({ behavior: 'smooth' });
    } else {
      if (!confirm('Deseja excluir este produto?')) return;
      await produtos.excluir(del.dataset.deleteProduct); await App().refreshData(); say('Produto excluído.');
    }
  } catch (err) { say(err.message || String(err), true); }
}, true);
