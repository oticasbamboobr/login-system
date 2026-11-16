/* ============================================================
   backup.js — Backup e Restauração (Google Drive) · Óticas Bamboo Brasil
   Como usar: salve este arquivo na raiz do repositório login-system
   e adicione, antes de </body> do index.html:
       <script src="backup.js"></script>
   Os botões aparecem só para usuários com papel "admin".
   ============================================================ */
(function () {
  'use strict';

  var CFG = {
    formato: 'oticas-bamboo-backup',
    versao: 1,
    // Se o seu index.html usa outro nome para o cliente Supabase, acrescente aqui
    // (ou defina window.BAMBOO_BACKUP_CLIENT = <seu cliente> no index.html).
    nomesCliente: ['sb', 'supabaseClient', 'supabase_client', '_supabase', 'supa', 'db', 'client'],
    // Chaves que NÃO são sobrescritas na restauração (sessão atual e histórico de backups)
    ignorarNaRestauracao: ['bamboo-user', 'bamboo-backup-log'],
    chaveLog: 'bamboo-backup-log',
    // Chaves esperadas: se faltarem no arquivo, o sistema avisa antes de restaurar
    chavesEsperadas: ['bamboo-fichas', 'bamboo-prod', 'bamboo-mov-est', 'bamboo-mov-cx', 'bamboo-users', 'bamboo-comprovantes']
  };

  var estado = { admin: false, usuario: null, ocupado: false };

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
  }
  function dataBR(iso) {
    try { return new Date(iso).toLocaleString('pt-BR'); } catch (e) { return String(iso); }
  }
  function canon(v) { // stringify com chaves ordenadas (jsonb não preserva a ordem)
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  async function sha256(texto) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function cliente() {
    if (window.BAMBOO_BACKUP_CLIENT) return window.BAMBOO_BACKUP_CLIENT;
    for (var i = 0; i < CFG.nomesCliente.length; i++) {
      try {
        var c = new Function('return typeof ' + CFG.nomesCliente[i] + '!=="undefined"?' + CFG.nomesCliente[i] + ':null')();
        if (c && typeof c.from === 'function' && c.auth) return c;
      } catch (e) { /* tenta o próximo nome */ }
    }
    if (window.supabase && typeof window.supabase.from === 'function' && window.supabase.auth) return window.supabase;
    return null;
  }
  function baixar(obj, prefixo) {
    var nome = prefixo + '-' + stamp() + '.json';
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    return nome;
  }

  /* ---------- leitura completa do banco ---------- */
  async function lerTudo(c, tabela, colunas, ordem) {
    var saida = [], total = null, passo = 500;
    for (var ini = 0; ; ini += passo) {
      var r = await c.from(tabela).select(colunas, { count: 'exact' }).order(ordem).range(ini, ini + passo - 1);
      if (r.error) throw new Error('Falha ao ler "' + tabela + '": ' + r.error.message);
      if (total === null) total = r.count;
      saida = saida.concat(r.data || []);
      if (!r.data || r.data.length < passo) break;
    }
    if (total !== null && saida.length !== total) {
      throw new Error('Leitura incompleta de "' + tabela + '" (' + saida.length + ' de ' + total + ' registros).');
    }
    return saida;
  }

  async function montarBackup(c) {
    var linhas = await lerTudo(c, 'app_data', 'key,value,updated_at', 'key');
    var perfis = await lerTudo(c, 'perfis', 'user_id,login,nome,papel,ativo,permissoes,criado_em', 'criado_em');
    var app = {};
    linhas.forEach(function (l) {
      if (l.value === undefined) throw new Error('Registro "' + l.key + '" veio sem conteúdo.');
      app[l.key] = l.value;
    });
    var dados = { app_data: app, perfis: perfis };
    var resumo = { app_data: linhas.length, perfis: perfis.length, chaves: Object.keys(app) };
    var u = estado.usuario || {};
    var corpo = {
      formato: CFG.formato,
      versao: CFG.versao,
      criado_em: new Date().toISOString(),
      criado_por: u.email || u.id || 'desconhecido',
      origem: location.origin + location.pathname,
      resumo: resumo,
      dados: dados
    };
    corpo.sha256 = await sha256(JSON.stringify({ resumo: resumo, dados: dados }));
    return corpo;
  }

  async function registrarLog(c, tipo, detalhe) {
    try {
      var r = await c.from('app_data').select('value').eq('key', CFG.chaveLog).maybeSingle();
      var lista = (r.data && Array.isArray(r.data.value)) ? r.data.value : [];
      var u = estado.usuario || {};
      lista.push({ tipo: tipo, em: new Date().toISOString(), por: u.email || u.id || '', detalhe: detalhe || '' });
      await c.from('app_data').upsert({ key: CFG.chaveLog, value: lista.slice(-50), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    } catch (e) { /* o log nunca deve impedir backup/restauração */ }
  }
  async function ultimoBackup(c) {
    try {
      var r = await c.from('app_data').select('value').eq('key', CFG.chaveLog).maybeSingle();
      var lista = (r.data && Array.isArray(r.data.value)) ? r.data.value : [];
      for (var i = lista.length - 1; i >= 0; i--) if (lista[i].tipo === 'backup') return lista[i].em;
    } catch (e) { }
    return null;
  }

  /* ---------- validação do arquivo ---------- */
  async function validar(bk) {
    var erros = [], avisos = [];
    if (!bk || typeof bk !== 'object') return { erros: ['O arquivo não contém um backup válido.'], avisos: avisos };
    if (bk.formato !== CFG.formato) erros.push('Este arquivo não é um backup do sistema Óticas Bamboo.');
    if (typeof bk.versao !== 'number' || bk.versao > CFG.versao) erros.push('Versão de backup não suportada.');
    if (!bk.dados || typeof bk.dados.app_data !== 'object' || bk.dados.app_data === null || Array.isArray(bk.dados.app_data)) erros.push('Dados do sistema ausentes no arquivo.');
    if (!Array.isArray(bk.dados && bk.dados.perfis)) erros.push('Lista de usuários/permissões ausente no arquivo.');
    if (!bk.resumo || !bk.sha256) erros.push('Arquivo sem resumo ou assinatura de integridade.');
    if (erros.length) return { erros: erros, avisos: avisos };
    if (bk.resumo.app_data !== Object.keys(bk.dados.app_data).length || bk.resumo.perfis !== bk.dados.perfis.length) {
      erros.push('A quantidade de registros não confere com o resumo — backup incompleto.');
    }
    var hash = await sha256(JSON.stringify({ resumo: bk.resumo, dados: bk.dados }));
    if (hash !== bk.sha256) erros.push('Falha na verificação de integridade: o arquivo foi alterado ou está corrompido.');
    CFG.chavesEsperadas.forEach(function (k) {
      if (!(k in bk.dados.app_data)) avisos.push('O backup não contém a chave "' + k + '".');
    });
    return { erros: erros, avisos: avisos };
  }

  /* ---------- aplicação da restauração ---------- */
  async function aplicarPerfis(c, lista, meuId) {
    var feitos = 0, bloqueados = 0;
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i];
      var campos = { nome: p.nome, permissoes: p.permissoes };
      if (p.user_id !== meuId) { campos.papel = p.papel; campos.ativo = p.ativo; } // nunca tira o próprio acesso de admin
      var r = await c.from('perfis').update(campos).eq('user_id', p.user_id).select('user_id');
      if (r.error) { bloqueados++; continue; }
      if (r.data && r.data.length) feitos++; else bloqueados++; // 0 linhas = sem permissão no banco (RLS)
    }
    return { feitos: feitos, bloqueados: bloqueados };
  }
  async function gravarChaves(c, mapa, chaves) {
    var agora = new Date().toISOString();
    var itens = chaves.map(function (k) { return { key: k, value: mapa[k], updated_at: agora }; });
    for (var i = 0; i < itens.length; i += 20) {
      var r = await c.from('app_data').upsert(itens.slice(i, i + 20), { onConflict: 'key' });
      if (r.error) throw new Error('Falha ao gravar dados: ' + r.error.message);
    }
  }

  async function aplicar(c, bk, atual) {
    var ign = {}; CFG.ignorarNaRestauracao.forEach(function (k) { ign[k] = 1; });
    var meuId = estado.usuario && estado.usuario.id;
    var chavesNovas = Object.keys(bk.dados.app_data).filter(function (k) { return !ign[k]; });
    var remover = Object.keys(atual.dados.app_data).filter(function (k) { return !ign[k] && !(k in bk.dados.app_data); });
    var chavesAtuais = Object.keys(atual.dados.app_data).filter(function (k) { return !ign[k]; });
    try {
      await gravarChaves(c, bk.dados.app_data, chavesNovas);
      if (remover.length) {
        var d = await c.from('app_data').delete().in('key', remover);
        if (d.error) throw new Error('Falha ao remover dados antigos: ' + d.error.message);
      }
      var rp = await aplicarPerfis(c, bk.dados.perfis, meuId);
      // conferência final
      var depois = await lerTudo(c, 'app_data', 'key,value', 'key');
      var mapa = {}; depois.forEach(function (l) { mapa[l.key] = l.value; });
      chavesNovas.forEach(function (k) {
        if (canon(mapa[k]) !== canon(bk.dados.app_data[k])) throw new Error('Conferência falhou na chave "' + k + '".');
      });
      remover.forEach(function (k) { if (k in mapa) throw new Error('A chave antiga "' + k + '" não foi removida.'); });
    } catch (erro) {
      try { // desfaz: devolve o estado de antes da restauração
        await gravarChaves(c, atual.dados.app_data, chavesAtuais);
      } catch (e2) {
        erro.message += ' | Atenção: não foi possível desfazer automaticamente. Use o arquivo "backup-seguranca-antes-da-restauracao" baixado.';
      }
      throw erro;
    }
    return { gravadas: chavesNovas.length, removidas: remover.length, perfis: rp.feitos, perfisBloqueados: rp.bloqueados };
  }

  /* ---------- interface ---------- */
  function estilos() {
    if (document.getElementById('bk-estilos')) return;
    var s = document.createElement('style'); s.id = 'bk-estilos';
    s.textContent =
      '.bk-btn{cursor:pointer}.bk-fixo{position:fixed;right:16px;bottom:16px;z-index:9998;display:flex;gap:8px}' +
      '.bk-over{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.bk-box{background:#fff;color:#222;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:inherit}' +
      '.bk-head{background:#d92b1f;color:#fff;padding:14px 18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:14px 14px 0 0}' +
      '.bk-head.ok{background:#1f7a3d}.bk-body{padding:18px;line-height:1.5;font-size:15px}' +
      '.bk-body ul{margin:8px 0 8px 20px;padding:0}.bk-erro{color:#b3261e}.bk-aviso{color:#8a5a00}' +
      '.bk-body input[type=text]{width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d92b1f;border-radius:8px;margin-top:8px;font-size:15px}' +
      '.bk-foot{display:flex;gap:10px;justify-content:flex-end;padding:0 18px 18px}' +
      '.bk-foot button{padding:10px 18px;border-radius:999px;border:1.5px solid #d92b1f;background:#fff;color:#d92b1f;font-weight:600;cursor:pointer}' +
      '.bk-foot button.prim{background:#d92b1f;color:#fff}.bk-foot button:disabled{opacity:.45;cursor:not-allowed}';
    document.head.appendChild(s);
  }
  function modal(o) { // {titulo, html, ok(bool), confirmar:'PALAVRA', botoes:[{t,prim,fn}]}
    estilos();
    return new Promise(function (resolve) {
      var ov = document.createElement('div'); ov.className = 'bk-over';
      ov.innerHTML = '<div class="bk-box" role="dialog" aria-modal="true"><div class="bk-head' + (o.ok ? ' ok' : '') + '">' + esc(o.titulo) +
        '</div><div class="bk-body">' + o.html + (o.confirmar ? '<div style="margin-top:12px">Para confirmar, digite <b>' + esc(o.confirmar) + '</b>:<input type="text" autocomplete="off"></div>' : '') +
        '</div><div class="bk-foot"></div></div>';
      var foot = ov.querySelector('.bk-foot'), inp = ov.querySelector('input');
      (o.botoes || [{ t: 'Fechar' }]).forEach(function (b, i) {
        var el = document.createElement('button'); el.textContent = b.t; if (b.prim) el.className = 'prim';
        if (b.prim && o.confirmar) { el.disabled = true; inp.addEventListener('input', function () { el.disabled = inp.value.trim().toUpperCase() !== o.confirmar; }); }
        el.onclick = function () { ov.remove(); resolve(i); };
        foot.appendChild(el);
      });
      document.body.appendChild(ov);
      if (inp) inp.focus();
    });
  }
  function aguarde(msg) {
    estilos();
    var ov = document.createElement('div'); ov.className = 'bk-over';
    ov.innerHTML = '<div class="bk-box"><div class="bk-head">Aguarde</div><div class="bk-body">' + esc(msg) + '</div></div>';
    document.body.appendChild(ov);
    return function () { ov.remove(); };
  }

  /* ---------- Google Drive (via função backup-otica do Supabase) ---------- */
  // CONTRATO com a função: invoke('backup-otica', {body:{acao:'salvar'|'listar'|'ler', ...}})
  // Se a sua função usar outros nomes, ajuste só aqui.
  async function drive(c, acao, extra) {
    var r = await c.functions.invoke('backup-otica', { body: Object.assign({ acao: acao }, extra || {}) });
    if (r.error) {
      var det = '';
      try { var j = await r.error.context.json(); det = (j && (j.erro || j.error || j.message)) || ''; } catch (e) { }
      throw new Error('Falha ao falar com o Google Drive' + (det ? ': ' + det : '') + ' (' + r.error.message + ')');
    }
    var d = r.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { } }
    if (!d || d.ok === false) throw new Error('O Google Drive recusou o pedido' + (d && d.erro ? ': ' + d.erro : '.'));
    return d;
  }
  function listaDe(d) { return d.arquivos || d.lista || d.files || d.backups || []; }

  function escolherBackup(lista) {
    estilos();
    return new Promise(function (resolve) {
      var ov = document.createElement('div'); ov.className = 'bk-over';
      var opts = lista.map(function (a, i) {
        var dt = a.data || a.criado_em || a.modificado || a.date;
        return '<option value="' + i + '">' + esc(a.nome || a.name || a.id) + (dt ? ' — ' + esc(dataBR(dt)) : '') + '</option>';
      }).join('');
      ov.innerHTML = '<div class="bk-box" role="dialog" aria-modal="true"><div class="bk-head">Escolher backup</div>' +
        '<div class="bk-body"><p>Backups guardados no Google Drive (mais recentes primeiro):</p>' +
        '<select style="width:100%;padding:10px;border:1.5px solid #d92b1f;border-radius:8px;font-size:15px">' + opts + '</select></div>' +
        '<div class="bk-foot"><button>Cancelar</button><button class="prim">Continuar</button></div></div>';
      var bt = ov.querySelectorAll('button'), sel = ov.querySelector('select');
      bt[0].onclick = function () { ov.remove(); resolve(null); };
      bt[1].onclick = function () { var i = +sel.value; ov.remove(); resolve(lista[i]); };
      document.body.appendChild(ov);
    });
  }

  /* ---------- ações dos botões ---------- */
  async function acaoBackup() {
    if (estado.ocupado) return; estado.ocupado = true;
    var c = cliente(), fim = aguarde('Gerando backup e enviando ao Google Drive…');
    try {
      var bk = await montarBackup(c);
      var nome = 'backup-oticas-bamboo-' + stamp() + '.json';
      await drive(c, 'salvar', { nome: nome, conteudo: JSON.stringify(bk) });
      await registrarLog(c, 'backup', nome);
      fim();
      await modal({
        titulo: 'Backup concluído', ok: true,
        html: '<p>Arquivo salvo no Google Drive, na pasta <b>Backups Ótica Bamboo</b>:</p><p><b>' + esc(nome) + '</b></p><ul><li>Data/hora: ' + esc(dataBR(bk.criado_em)) +
          '</li><li>Registros do sistema: ' + bk.resumo.app_data + '</li><li>Usuários/permissões: ' + bk.resumo.perfis + '</li></ul>'
      });
    } catch (e) {
      fim();
      await modal({ titulo: 'Backup não concluído', html: '<p class="bk-erro">' + esc(e.message) + '</p><p>Nenhum dado foi alterado. Tente novamente.</p>' });
    }
    estado.ocupado = false;
  }

  async function acaoRestaurar() {
    if (estado.ocupado) return; estado.ocupado = true;
    var c = cliente(), fim = aguarde('Buscando backups no Google Drive…'), lista;
    try {
      lista = listaDe(await drive(c, 'listar')).filter(function (a) { return /\.json$/i.test(a.nome || a.name || ''); });
      lista.sort(function (x, y) { return String(y.nome || y.name).localeCompare(String(x.nome || x.name)); });
      lista = lista.slice(0, 60);
    } catch (e) {
      fim();
      await modal({ titulo: 'Não foi possível listar', html: '<p class="bk-erro">' + esc(e.message) + '</p>' });
      estado.ocupado = false; return;
    }
    fim();
    if (!lista.length) {
      await modal({ titulo: 'Nenhum backup', html: '<p>Não há backups na pasta do Google Drive.</p>' });
      estado.ocupado = false; return;
    }
    var item = await escolherBackup(lista);
    if (!item) { estado.ocupado = false; return; }
    fim = aguarde('Baixando o backup do Google Drive…');
    var texto;
    try {
      var d = await drive(c, 'ler', { id: item.id });
      texto = d.conteudo !== undefined ? d.conteudo : d.content;
      if (typeof texto !== 'string') texto = JSON.stringify(texto);
    } catch (e) {
      fim();
      await modal({ titulo: 'Não foi possível abrir o backup', html: '<p class="bk-erro">' + esc(e.message) + '</p>' });
      estado.ocupado = false; return;
    }
    fim();
    await processarBackup(texto);
  }

  async function processarBackup(texto) {
    var c = cliente(), fim = aguarde('Validando o backup…'), bk, atual;
    try {
      try { bk = JSON.parse(texto); } catch (e) { bk = null; }
      var v = await validar(bk);
      if (v.erros.length) {
        fim();
        await modal({ titulo: 'Backup inválido', html: '<p>A restauração foi cancelada. Nada foi alterado.</p><ul class="bk-erro"><li>' + v.erros.map(esc).join('</li><li>') + '</li></ul>' });
        estado.ocupado = false; return;
      }
      atual = await montarBackup(c);
      fim();
      var avisos = v.avisos.length ? '<p class="bk-aviso"><b>Atenção:</b></p><ul class="bk-aviso"><li>' + v.avisos.map(esc).join('</li><li>') + '</li></ul>' : '';
      var escolha = await modal({
        titulo: 'Confirmar restauração',
        html: '<p>Os dados <b>atuais</b> do sistema serão <b>substituídos</b> pelo backup abaixo:</p><ul>' +
          '<li>Backup feito em: <b>' + esc(dataBR(bk.criado_em)) + '</b> por ' + esc(bk.criado_por) + '</li>' +
          '<li>Registros no backup: ' + bk.resumo.app_data + ' (hoje: ' + atual.resumo.app_data + ')</li>' +
          '<li>Usuários/permissões no backup: ' + bk.resumo.perfis + '</li></ul>' + avisos +
          '<p>Antes de restaurar, o sistema salvará no Google Drive um backup de segurança dos dados atuais. Se algo falhar, tudo volta ao estado anterior.</p>',
        confirmar: 'RESTAURAR',
        botoes: [{ t: 'Cancelar' }, { t: 'Restaurar agora', prim: true }]
      });
      if (escolha !== 1) { estado.ocupado = false; return; }

      fim = aguarde('Salvando backup de segurança no Google Drive…');
      var nomeSeg = 'backup-seguranca-antes-da-restauracao-' + stamp() + '.json';
      await drive(c, 'salvar', { nome: nomeSeg, conteudo: JSON.stringify(atual) }); // se falhar, cancela tudo
      fim();
      fim = aguarde('Restaurando dados… não feche esta janela.');
      var r = await aplicar(c, bk, atual);
      await registrarLog(c, 'restauracao', 'backup de ' + bk.criado_em);
      fim();
      await modal({
        titulo: 'Restauração concluída', ok: true,
        html: '<p>Todos os dados foram restaurados e conferidos com sucesso.</p><ul><li>Registros restaurados: ' + r.gravadas +
          '</li><li>Registros antigos removidos: ' + r.removidas + '</li><li>Usuários/permissões atualizados: ' + r.perfis + '</li></ul>' + (r.perfisBloqueados ? '<p class="bk-aviso"><b>Atenção:</b> ' + r.perfisBloqueados + ' perfil(is) de usuário não puderam ser restaurados, pois o banco não permite essa alteração pelo sistema. Os dados (fichas, produtos, estoque, caixa) foram restaurados normalmente.</p>' : '') + '<p>A página será recarregada.</p>'
      });
      location.reload();
    } catch (e) {
      fim();
      await modal({ titulo: 'Restauração não concluída', html: '<p class="bk-erro">' + esc(e.message) + '</p><p>O sistema tentou voltar ao estado anterior. Confira seus dados.</p>' });
    }
    estado.ocupado = false;
  }

  /* ---------- botões na tela ---------- */
  function criarBotoes() {
    if (document.getElementById('bk-grupo')) return;
    estilos();
    var ref = document.getElementById('bNova') || Array.prototype.slice.call(document.querySelectorAll('button')).filter(function (b) { return /nova ficha/i.test(b.textContent); })[0];
    var grupo = document.createElement('span'); grupo.id = 'bk-grupo';
    function mk(txt, fn) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = txt;
      b.className = (ref ? ref.className : '') + ' bk-btn'; b.onclick = fn; return b;
    }
    grupo.appendChild(mk('Backup', acaoBackup));
    grupo.appendChild(document.createTextNode(' '));
    grupo.appendChild(mk('Restaurar Backup', acaoRestaurar));
    if (ref && ref.parentNode) { ref.parentNode.insertBefore(grupo, ref.nextSibling); }
    else { grupo.className = 'bk-fixo'; document.body.appendChild(grupo); }
  }
  function removerBotoes() { var g = document.getElementById('bk-grupo'); if (g) g.remove(); }

  async function verificarAdmin() {
    var c = cliente(); if (!c) return false;
    try {
      var s = await c.auth.getUser(); var u = s && s.data && s.data.user;
      if (!u) { estado.usuario = null; return false; }
      estado.usuario = u;
      var r = await c.from('perfis').select('papel,ativo').eq('user_id', u.id).maybeSingle();
      return !!(r.data && r.data.papel === 'admin' && r.data.ativo !== false);
    } catch (e) { return false; }
  }

  var ultimaVerificacao = 0;
  async function ciclo() {
    var agora = Date.now();
    if (agora - ultimaVerificacao > 15000) { // reconfere o papel a cada 15 s
      ultimaVerificacao = agora; estado.admin = await verificarAdmin();
    }
    if (estado.admin) criarBotoes(); else removerBotoes();
  }
  function iniciar() {
    ciclo(); setInterval(ciclo, 2000);
    var c = cliente();
    if (c && c.auth && c.auth.onAuthStateChange) c.auth.onAuthStateChange(function () { ultimaVerificacao = 0; setTimeout(ciclo, 300); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
