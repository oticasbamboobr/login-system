/* ============================================================
   backup.js — Backup e Restauração (Google Drive) · Óticas Bamboo Brasil
   Usa a Edge Function "backup-otica" do Supabase:
     acao "backup"    -> exporta os dados e salva no Google Drive
     acao "listar"    -> lista os backups registrados
     acao "restaurar" -> faz backup de segurança e restaura o escolhido
   Os botões aparecem só para usuários com papel "admin".
   ============================================================ */
(function () {
  'use strict';

  var CFG = {
    funcao: 'backup-otica',
    nomesCliente: ['sb', 'supabaseClient', 'supabase_client', '_supabase', 'supa', 'db', 'client']
  };
  var estado = { admin: false, usuario: null, ocupado: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dataBR(iso) {
    try { return new Date(iso).toLocaleString('pt-BR'); } catch (e) { return String(iso); }
  }
  function cliente() {
    if (window.BAMBOO_BACKUP_CLIENT) return window.BAMBOO_BACKUP_CLIENT;
    for (var i = 0; i < CFG.nomesCliente.length; i++) {
      try {
        var c = new Function('return typeof ' + CFG.nomesCliente[i] + '!=="undefined"?' + CFG.nomesCliente[i] + ':null')();
        if (c && typeof c.from === 'function' && c.auth) return c;
      } catch (e) { }
    }
    return null;
  }

  async function chamar(c, corpo) {
    var r = await c.functions.invoke(CFG.funcao, { body: corpo });
    if (r.error) {
      var det = '';
      try { var j = await r.error.context.json(); det = (j && (j.erro || j.error || j.message)) || ''; } catch (e) { }
      throw new Error(det || r.error.message);
    }
    var d = r.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { } }
    if (!d || d.ok === false) throw new Error((d && d.erro) || 'Resposta inválida do servidor.');
    return d;
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

  function escolherBackup(lista) {
    estilos();
    return new Promise(function (resolve) {
      var ov = document.createElement('div'); ov.className = 'bk-over';
      var opts = lista.map(function (a, i) {
        var kb = a.tamanho_bytes ? Math.round(a.tamanho_bytes / 1024) + ' KB' : '';
        var partes = [dataBR(a.criado_em), a.tipo, a.total_registros != null ? a.total_registros + ' registros' : '', kb].filter(Boolean);
        return '<option value="' + i + '">' + esc(partes.join(' · ')) + '</option>';
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

  async function acaoBackup() {
    if (estado.ocupado) return; estado.ocupado = true;
    var c = cliente(), fim = aguarde('Gerando backup e enviando ao Google Drive…');
    try {
      var r = await chamar(c, { acao: 'backup' });
      fim();
      await modal({
        titulo: 'Backup concluído', ok: true,
        html: '<p>Arquivo salvo no Google Drive, na pasta <b>Backups Ótica Bamboo</b>:</p><p><b>' + esc(r.nome) + '</b></p><ul><li>Registros salvos: ' + esc(r.total_registros) + '</li></ul>'
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
      lista = (await chamar(c, { acao: 'listar' })).backups || [];
    } catch (e) {
      fim();
      await modal({ titulo: 'Não foi possível listar', html: '<p class="bk-erro">' + esc(e.message) + '</p>' });
      estado.ocupado = false; return;
    }
    fim();
    if (!lista.length) {
      await modal({ titulo: 'Nenhum backup', html: '<p>Ainda não há backups registrados.</p>' });
      estado.ocupado = false; return;
    }
    var item = await escolherBackup(lista);
    if (!item) { estado.ocupado = false; return; }

    var escolha = await modal({
      titulo: 'Confirmar restauração',
      html: '<p>Os dados <b>atuais</b> do sistema serão <b>substituídos</b> pelo backup de <b>' + esc(dataBR(item.criado_em)) + '</b> (' + esc(item.tipo) + ', ' + esc(item.total_registros) + ' registros).</p>' +
        '<p>Antes de restaurar, o sistema salva automaticamente um backup de segurança dos dados atuais no Google Drive.</p>',
      confirmar: 'RESTAURAR',
      botoes: [{ t: 'Cancelar' }, { t: 'Restaurar agora', prim: true }]
    });
    if (escolha !== 1) { estado.ocupado = false; return; }

    fim = aguarde('Restaurando dados… não feche esta janela.');
    try {
      var r = await chamar(c, { acao: 'restaurar', drive_id: item.drive_id });
      fim();
      await modal({
        titulo: 'Restauração concluída', ok: true,
        html: '<p>Os dados foram restaurados.</p><p>Backup de segurança dos dados anteriores:<br><b>' + esc(r.backup_de_seguranca) + '</b></p><p>A página será recarregada.</p>'
      });
      location.reload();
    } catch (e) {
      fim();
      await modal({ titulo: 'Restauração não concluída', html: '<p class="bk-erro">' + esc(e.message) + '</p><p>Confira seus dados. O backup de segurança fica no Google Drive.</p>' });
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
