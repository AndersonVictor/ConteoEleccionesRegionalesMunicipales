import { api, local } from '../api.js';
import { seccionesParaUbigeo, SECCIONES } from '/shared/acta.js';
import { cargarUbigeo, enlazarUbigeo, selectoresUbigeo } from '../ubigeo.js';
import { html, iconos, titulo, toast } from '../ui.js';

export async function vistaNuevaMesa(app) {
  await cargarUbigeo();
  let ubigeo = local.get('ultimoUbigeo', '');
  let existente = null;

  const pintar = () => {
    const secciones = ubigeo.length === 6 ? seccionesParaUbigeo(ubigeo) : [];
    app.innerHTML = String(html`
      <div class="encabezado">
        <a class="btn-icono" href="#/mesas" aria-label="Volver">${iconos.atras}</a>
        <div class="titulos"><h1>Registrar mesa</h1><div class="sub">Datos del acta de tu mesa de sufragio</div></div>
      </div>
      <form id="form" class="stack-lg" novalidate>
        <div class="card stack">
          <label class="campo"><span>Número de mesa</span>
            <input class="input grande" name="numero" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="off" required>
            <div class="ayuda">Son 6 dígitos y figuran en el acta y en la lista de electores.</div></label>
          <div id="existente"></div>
        </div>
        <div class="card stack" id="datos-mesa">
          ${selectoresUbigeo(ubigeo)}
          <label class="campo"><span>Local de votación <small class="muted">(opcional)</small></span>
            <input class="input" name="local_votacion" placeholder="Ej. I.E. San Martín de Porres"></label>
          <label class="campo"><span>Electores hábiles de la mesa</span>
            <input class="input" name="electores_habiles" inputmode="numeric" value="300" required>
            <div class="ayuda">Está en la lista de electores (normalmente hasta 300).</div></label>
          ${secciones.length ? html`<div class="aviso">
            <b>Esta cédula tiene ${secciones.length} elecciones:</b>
            <div class="small" style="margin-top:4px">${secciones.map((s) => SECCIONES[s].titulo).join(' · ')}</div>
          </div>` : ''}
        </div>
        <button class="btn primario bloque" type="submit">Empezar a contar</button>
      </form>`);

    const form = app.querySelector('#form');
    enlazarUbigeo(app, (u) => {
      const valores = Object.fromEntries(new FormData(form));
      ubigeo = u;
      pintar();
      const nuevo = app.querySelector('#form');
      for (const [k, v] of Object.entries(valores)) if (nuevo[k]) nuevo[k].value = v;
    });

    form.numero.addEventListener('input', async (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      existente = null;
      app.querySelector('#existente').innerHTML = '';
      app.querySelector('#datos-mesa').hidden = false;
      if (e.target.value.length !== 6) return;
      try {
        const { mesa } = await api(`/mesas/${e.target.value}`);
        if (mesa && form.numero.value === mesa.numero) {
          existente = mesa;
          app.querySelector('#datos-mesa').hidden = true;
          app.querySelector('#existente').innerHTML = String(html`<div class="aviso ok">
            Esta mesa ya fue registrada: <b>${titulo(mesa.distrito)}</b>, ${titulo(mesa.provincia)} (${titulo(mesa.departamento)}),
            ${mesa.electores_habiles} electores hábiles${mesa.local_votacion ? `, ${mesa.local_votacion}` : ''}.
            Tu conteo será independiente del de otros personeros.</div>`);
        }
      } catch { /* sin conexión: se valida al enviar */ }
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(form));
      if (!/^\d{6}$/.test(datos.numero)) return toast('El número de mesa tiene 6 dígitos', { error: true });
      if (!existente && ubigeo.length !== 6) return toast('Selecciona el distrito de la mesa', { error: true });
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const { acta } = await api('/actas', {
          method: 'POST',
          body: existente ? { numero: datos.numero } : { ...datos, ubigeo, electores_habiles: Number(datos.electores_habiles) },
        });
        local.set('ultimoUbigeo', acta.mesa.ubigeo);
        location.hash = `#/acta/${acta.id}`;
      } catch (err) {
        toast(err.message, { error: true });
        btn.disabled = false;
      }
    };
  };
  pintar();
}
